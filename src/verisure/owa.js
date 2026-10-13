// -----------------------------------------------------------------------------
// Client of the "OWA" Verisure cloud (the "My Verisure" app, formerly
// Securitas Direct: France, Spain, Italy, Portugal, United Kingdom, Ireland,
// Latin America), a GraphQL API whose session travels in headers.
//
// Ported from the Home Assistant integration "Verisure OWA"
// (guerrerotook/securitas-direct-new-api), which documents what the official
// app sends:
//   - mkLoginToken (username + password) answers a short-lived JWT, the
//     `hash`, and a `refreshToken` that RefreshLogin trades for a new hash.
//     Both go in the JSON `auth` header of every call;
//   - a new "device" (this integration) must be validated once by a code sent
//     by SMS: mkValidateDevice answers the challenge and the masked phones,
//     mkSendOTP sends the code, mkValidateDevice again with the code (in the
//     `security` header) authorizes the device for good;
//   - every call about an installation carries its number, its panel and a
//     capabilities JWT obtained from the service list (Srv);
//   - the panel is slow: an order (arm, disarm, check) answers a reference,
//     whose status is polled until it is no longer `WAIT`;
//   - the API sits behind a WAF that blocks bursts for a long time: one call
//     at a time, no blind retries.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ArmingRefusedError,
  AuthenticationError,
  MfaRequiredError,
  RateLimitError,
  VerisureError,
} from './errors.js';
import { decodeJwt, request, sleep } from './http.js';
import { MODES, UNKNOWN_MODE } from './modes.js';

const logger = createLogger({ name: 'owa' });

export const API_URLS = {
  AR: 'https://customers.verisure.com.ar/owa-api/graphql',
  BR: 'https://customers.verisure.com.br/owa-api/graphql',
  CL: 'https://customers.verisure.cl/owa-api/graphql',
  ES: 'https://customers.verisure.es/owa-api/graphql',
  FR: 'https://customers.securitasdirect.fr/owa-api/graphql',
  GB: 'https://customers.verisure.co.uk/owa-api/graphql',
  IE: 'https://customers.verisure.ie/owa-api/graphql',
  IT: 'https://customers.verisure.it/owa-api/graphql',
  PE: 'https://customers.verisure.pe/owa-api/graphql',
  PT: 'https://customers.verisure.pt/owa-api/graphql',
};

// The app historically sent lang = country in lower case, with a few
// exceptions for the Spanish-speaking countries.
const LANGUAGES = { CL: 'es', PE: 'es', GB: 'en', IE: 'en' };

const CALLBY = 'OWA_10';
const ID_PREFIX = 'OWA_______________';
const ALARM_STATUS_SERVICE_ID = '11';
const ACCOUNT_BLOCKED = '60052';
const COMFORT_SERVICES = new Set(['CONFORT', 'COMFORTO', 'COMFORT']);

// The app this client introduces itself as (the API refuses unknown shapes).
const DEVICE = {
  brand: 'samsung',
  name: 'SM-S901U',
  osVersion: '12',
  version: '10.102.0',
};
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)' +
  ' Chrome/102.0.5005.124 Safari/537.36 Edg/102.0.1245.41';

// The operations that ARE the authentication: never preceded by a session
// check, and their auth header carries an empty hash.
const AUTH_OPERATIONS = new Set(['mkLoginToken', 'RefreshLogin', 'mkSendOTP', 'mkValidateDevice']);
const EMPTY_HASH_OPERATIONS = new Set(['mkValidateDevice', 'RefreshLogin', 'mkSendOTP']);

const POLL_DELAY_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

const DEVICE_FIELDS =
  '$idDevice: String!, $idDeviceIndigitall: String!, $deviceType: String!, $deviceVersion: String!, $deviceResolution: String!, $deviceName: String!, $deviceBrand: String!, $deviceOsVersion: String!, $uuid: String!';
const DEVICE_ARGS =
  'idDevice: $idDevice, idDeviceIndigitall: $idDeviceIndigitall, deviceType: $deviceType, deviceVersion: $deviceVersion, deviceResolution: $deviceResolution, deviceName: $deviceName, deviceBrand: $deviceBrand, deviceOsVersion: $deviceOsVersion, uuid: $uuid';

export const QUERIES = {
  mkLoginToken: `mutation mkLoginToken($user: String!, $password: String!, $id: String!, $country: String!, $lang: String!, $callby: String!, ${DEVICE_FIELDS}) { xSLoginToken(user: $user, password: $password, country: $country, lang: $lang, callby: $callby, id: $id, ${DEVICE_ARGS}) { __typename res msg hash refreshToken legals changePassword needDeviceAuthorization mainUser } }`,
  RefreshLogin: `mutation RefreshLogin($refreshToken: String!, $id: String!, $country: String!, $lang: String!, $callby: String!, ${DEVICE_FIELDS}) { xSRefreshLogin(refreshToken: $refreshToken, id: $id, country: $country, lang: $lang, callby: $callby, ${DEVICE_ARGS}) { __typename res msg hash refreshToken legals changePassword needDeviceAuthorization mainUser } }`,
  mkValidateDevice:
    'mutation mkValidateDevice($idDevice: String, $idDeviceIndigitall: String, $uuid: String, $deviceName: String, $deviceBrand: String, $deviceOsVersion: String, $deviceVersion: String) { xSValidateDevice(idDevice: $idDevice, idDeviceIndigitall: $idDeviceIndigitall, uuid: $uuid, deviceName: $deviceName, deviceBrand: $deviceBrand, deviceOsVersion: $deviceOsVersion, deviceVersion: $deviceVersion) { res msg hash refreshToken legals } }',
  mkSendOTP:
    'mutation mkSendOTP($recordId: Int!, $otpHash: String!) { xSSendOtp(recordId: $recordId, otpHash: $otpHash) { res msg } }',
  mkInstallationList:
    'query mkInstallationList { xSInstallations { installations { numinst alias panel type name surname address city postcode province email phone } } }',
  Srv: 'query Srv($numinst: String!, $uuid: String) { xSSrv(numinst: $numinst, uuid: $uuid) { res msg language installation { numinst role alias status panel sim instIbs services { idService active visible bde isPremium codOper request minWrapperVersion unprotectActive unprotectDeviceStatus instDate genericConfig { total attributes { key value } } attributes { attributes { name value active } } } configRepoUser { alarmPartitions { id enterStates leaveStates } } capabilities } } }',
  Status:
    'query Status($numinst: String!) { xSStatus(numinst: $numinst) { status timestampUpdate wifiConnected exceptions { status deviceType alias } } }',
  CheckAlarm:
    'query CheckAlarm($numinst: String!, $panel: String!) { xSCheckAlarm(numinst: $numinst, panel: $panel) { res msg referenceId } }',
  CheckAlarmStatus:
    'query CheckAlarmStatus($numinst: String!, $idService: String!, $panel: String!, $referenceId: String!) { xSCheckAlarmStatus(numinst: $numinst, idService: $idService, panel: $panel, referenceId: $referenceId) { res msg status numinst protomResponse protomResponseDate } }',
  xSArmPanel:
    'mutation xSArmPanel($numinst: String!, $request: ArmCodeRequest!, $panel: String!, $currentStatus: String, $suid: String, $forceArmingRemoteId: String, $armAndLock: Boolean) { xSArmPanel(numinst: $numinst, request: $request, panel: $panel, currentStatus: $currentStatus, suid: $suid, forceArmingRemoteId: $forceArmingRemoteId, armAndLock: $armAndLock) { res msg referenceId } }',
  ArmStatus:
    'query ArmStatus($numinst: String!, $request: ArmCodeRequest, $panel: String!, $referenceId: String!, $counter: Int!, $forceArmingRemoteId: String, $armAndLock: Boolean) { xSArmStatus(numinst: $numinst, panel: $panel, referenceId: $referenceId, counter: $counter, request: $request, forceArmingRemoteId: $forceArmingRemoteId, armAndLock: $armAndLock) { res msg status protomResponse protomResponseDate numinst requestId error { code type allowForcing exceptionsNumber referenceId suid } } }',
  xSDisarmPanel:
    'mutation xSDisarmPanel($numinst: String!, $request: DisarmCodeRequest!, $panel: String!) { xSDisarmPanel(numinst: $numinst, request: $request, panel: $panel) { res msg referenceId } }',
  DisarmStatus:
    'query DisarmStatus($numinst: String!, $panel: String!, $referenceId: String!, $counter: Int!, $request: DisarmCodeRequest) { xSDisarmStatus(numinst: $numinst, panel: $panel, referenceId: $referenceId, counter: $counter, request: $request) { res msg status protomResponse protomResponseDate numinst requestId error { code type allowForcing exceptionsNumber referenceId } } }',
  xSGetExceptions:
    'query xSGetExceptions($numinst: String!, $panel: String!, $referenceId: String!, $counter: Int!, $suid: String) { xSGetExceptions(numinst: $numinst, panel: $panel, referenceId: $referenceId, counter: $counter, suid: $suid) { res msg exceptions { status deviceType alias } } }',
  Sentinel:
    'query Sentinel($numinst: String!) { xSComfort(numinst: $numinst) { res devices { alias status { temperature humidity airQualityCode } zone } } }',
};

// The panel answers its state as one letter: interior mode x perimeter (x
// annex, a separate building, kept out of the Gladys modes).
export const PROTO_TO_MODE = {
  D: MODES.DISARMED,
  E: MODES.PERIMETER,
  P: MODES.ARMED_HOME,
  Q: MODES.ARMED_NIGHT,
  B: MODES.ARMED_HOME_PERIMETER,
  C: MODES.ARMED_NIGHT_PERIMETER,
  T: MODES.ARMED_AWAY,
  A: MODES.ARMED_AWAY_PERIMETER,
  X: MODES.DISARMED,
  R: MODES.ARMED_HOME,
  S: MODES.ARMED_NIGHT,
  O: MODES.ARMED_AWAY,
};

// Each mode on two axes: what the interior detectors do, and the perimeter.
const AXES = {
  [MODES.DISARMED]: { interior: 'off', perimeter: false },
  [MODES.ARMED_HOME]: { interior: 'day', perimeter: false },
  [MODES.ARMED_NIGHT]: { interior: 'night', perimeter: false },
  [MODES.ARMED_AWAY]: { interior: 'total', perimeter: false },
  [MODES.PERIMETER]: { interior: 'off', perimeter: true },
  [MODES.ARMED_HOME_PERIMETER]: { interior: 'day', perimeter: true },
  [MODES.ARMED_NIGHT_PERIMETER]: { interior: 'night', perimeter: true },
  [MODES.ARMED_AWAY_PERIMETER]: { interior: 'total', perimeter: true },
};

const INTERIOR_ARM = { day: 'ARMDAY1', night: 'ARMNIGHT1', total: 'ARM1' };
// Interior + perimeter in one order; the spellings differ between countries,
// the first one the panel accepts wins. `A+B` is two orders in a row.
const COMBINED_ARM = {
  day: ['ARMDAY1PERI1', 'ARMDAY1+PERI1'],
  night: ['ARMNIGHT1PERI1', 'ARMNIGHT1+PERI1'],
  total: ['ARMINTEXT1', 'ARM1PERI1', 'ARM1+PERI1'],
};

/**
 * The orders that take the panel from one mode to another: a list of steps,
 * each step a list of alternative orders tried in turn. Changing the interior
 * mode of an armed panel needs a disarm first (the panel refuses a direct
 * day -> total).
 * @param {string} current mode now (UNKNOWN_MODE when unknown)
 * @param {string} target
 * @param {boolean} hasPerimeter
 * @returns {string[][]}
 */
export function planOrders(current, target, hasPerimeter) {
  const to = AXES[target];
  if (!to) {
    throw new VerisureError(`Unknown mode ${target}`, { code: 'UNSUPPORTED_MODE' });
  }
  // An unknown current state: disarming is unconditional, arming starts from
  // a clean panel.
  const from = AXES[current] ?? { interior: 'total', perimeter: hasPerimeter };
  const disarm = (state) => {
    if (state.interior === 'off' && !state.perimeter) {
      return [];
    }
    if (!hasPerimeter || !state.perimeter) {
      return [['DARM1']];
    }
    return state.interior === 'off' ? [['DARMPERI', 'DARM1']] : [['DARM1DARMPERI', 'DARM1']];
  };

  if (to.interior === 'off' && !to.perimeter) {
    return disarm(from);
  }
  const steps = [];
  let start = from;
  if (from.interior !== 'off' && from.interior !== to.interior) {
    steps.push(...disarm(from));
    start = AXES[MODES.DISARMED];
  }
  const interiorChanges = start.interior !== to.interior;
  const perimeterChanges = start.perimeter !== to.perimeter;
  if (interiorChanges && perimeterChanges && to.perimeter && to.interior !== 'off') {
    steps.push(COMBINED_ARM[to.interior]);
  } else {
    if (interiorChanges && to.interior !== 'off') {
      steps.push([INTERIOR_ARM[to.interior]]);
    }
    if (perimeterChanges) {
      steps.push(to.perimeter ? ['PERI1'] : ['DARMPERI', 'DARM1']);
    }
  }
  return steps;
}

/** A 16-hex-character device id, like the app generates. */
const newDeviceId = () => randomBytes(8).toString('hex');

/**
 * @param {{ username: string, password: string, country: string,
 *   session?: Record<string, any>, onSession?: (session: object) => void,
 *   pollDelayMs?: number, pollTimeoutMs?: number }} options
 */
export function createOwaClient(options) {
  const { username, password } = options;
  const country = String(options.country || 'FR').toUpperCase();
  const url =
    API_URLS[country] ??
    `https://customers.securitasdirect.${country.toLowerCase()}/owa-api/graphql`;
  const lang = LANGUAGES[country] ?? country.toLowerCase();
  const pollDelayMs = options.pollDelayMs ?? POLL_DELAY_MS;
  const pollTimeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS;

  // What survives a restart: the identity of this "device" (validated once by
  // SMS) and the refresh token. The device ids must never change, or Verisure
  // asks for a new code.
  const saved = options.session ?? {};
  const session = {
    deviceId: saved.deviceId || newDeviceId(),
    indigitall: saved.indigitall || randomUUID(),
    refreshToken: saved.refreshToken || '',
  };
  session.uuid = saved.uuid || session.deviceId;
  const saveSession = () => options.onSession?.({ ...session });
  if (!saved.deviceId) {
    saveSession();
  }

  const apolloId = randomBytes(64).toString('hex');
  let hash = null;
  let hashExpiresAt = 0;
  let loginTimestamp = 0;
  let otpChallenge = null; // { otpHash, code } while a code is being checked
  let pendingOtpHash = null; // challenge received, code not typed yet
  let mfaPending = false;
  const installations = new Map(); // numinst -> { capabilities, expiresAt, caps, services, partitions, protom }

  const generateId = () => {
    const now = new Date();
    return (
      `${ID_PREFIX}${username}_______________${now.getFullYear()}${now.getMonth() + 1}` +
      `${now.getDate()}${now.getHours()}${now.getMinutes()}${now.getMilliseconds() * 1000}`
    );
  };

  const deviceVariables = () => ({
    idDevice: session.deviceId,
    idDeviceIndigitall: session.indigitall,
    deviceType: '',
    deviceVersion: DEVICE.version,
    deviceResolution: '',
    deviceName: DEVICE.name,
    deviceBrand: DEVICE.brand,
    deviceOsVersion: DEVICE.osVersion,
    uuid: session.uuid,
  });

  function headers(operation, installation) {
    const result = {
      'content-type': 'application/json; charset=utf-8',
      'User-Agent': USER_AGENT,
      app: JSON.stringify({ appVersion: DEVICE.version, origin: 'native' }),
      'X-APOLLO-OPERATION-ID': apolloId,
      'X-APOLLO-OPERATION-NAME': operation,
      extension: '{"mode":"full"}',
    };
    if (installation) {
      result.numinst = installation.id;
      result.panel = installation.panel;
      const state = installations.get(installation.id);
      if (state?.capabilities) {
        result['X-Capabilities'] = state.capabilities;
      }
    }
    const auth = {
      loginTimestamp,
      user: username,
      id: generateId(),
      country,
      lang,
      callby: CALLBY,
    };
    if (EMPTY_HASH_OPERATIONS.has(operation)) {
      result.auth = JSON.stringify({ ...auth, hash: '', refreshToken: '' });
    } else if (hash) {
      result.auth = JSON.stringify({ ...auth, hash });
    }
    if (otpChallenge) {
      result.security = JSON.stringify({
        token: otpChallenge.code,
        type: 'OTP',
        otpHash: otpChallenge.otpHash,
      });
    }
    return result;
  }

  // One HTTP call. The JSON body is returned even on an HTTP error: GraphQL
  // explains the failure there.
  async function send(operation, variables, installation) {
    const response = await request(url, {
      method: 'POST',
      headers: headers(operation, installation),
      body: { operationName: operation, variables, query: QUERIES[operation] },
    });
    // The operation and its outcome only: variables and headers carry secrets.
    logger.debug(
      `${operation} -> HTTP ${response.status}` +
        (firstError(response.json) ? ` (${firstError(response.json).message})` : ''),
    );
    if (response.status === 403 && response.text.includes('_Incapsula_Resource')) {
      throw new RateLimitError('The Verisure firewall blocks this connection for now', {
        status: 403,
      });
    }
    if (response.status === 429) {
      throw new RateLimitError(undefined, { status: 429 });
    }
    if (response.json === undefined) {
      throw new VerisureError(`${operation} failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    return response.json;
  }

  const firstError = (json) => (Array.isArray(json?.errors) ? json.errors[0] : undefined);
  const errorCode = (json) => {
    const code = firstError(json)?.data?.err;
    return code === undefined ? undefined : String(code);
  };

  function setHash(value) {
    hash = value;
    const payload = decodeJwt(value);
    // Without a readable expiry, renew after 10 minutes (the token lives ~15).
    hashExpiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 10 * 60_000;
    loginTimestamp = Date.now();
  }

  async function login() {
    if (!password) {
      throw new AuthenticationError('No password configured');
    }
    const json = await send('mkLoginToken', {
      user: username,
      password,
      id: generateId(),
      country,
      lang,
      callby: CALLBY,
      ...deviceVariables(),
    });
    const data = json?.data?.xSLoginToken;
    if (errorCode(json) === ACCOUNT_BLOCKED) {
      throw new AuthenticationError('The Verisure account is blocked', { code: ACCOUNT_BLOCKED });
    }
    if (data?.needDeviceAuthorization) {
      mfaPending = true;
      throw new MfaRequiredError();
    }
    if (!data || firstError(json)) {
      throw new AuthenticationError(firstError(json)?.message ?? 'Login refused', {
        code: errorCode(json),
      });
    }
    mfaPending = false;
    if (data.refreshToken) {
      session.refreshToken = data.refreshToken;
      saveSession();
    }
    if (!data.hash) {
      throw new AuthenticationError(data.msg || 'Login refused');
    }
    setHash(data.hash);
  }

  async function refreshLogin() {
    const json = await send('RefreshLogin', {
      refreshToken: session.refreshToken,
      id: generateId(),
      country,
      lang,
      callby: CALLBY,
      ...deviceVariables(),
    });
    const data = json?.data?.xSRefreshLogin;
    if (data?.res !== 'OK' || !data.hash) {
      return false;
    }
    setHash(data.hash);
    if (data.refreshToken) {
      session.refreshToken = data.refreshToken;
      saveSession();
    }
    return true;
  }

  async function ensureAuth() {
    if (hash && Date.now() + 60_000 < hashExpiresAt) {
      return;
    }
    if (session.refreshToken) {
      try {
        if (await refreshLogin()) {
          return;
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          throw err;
        }
        logger.debug(`Refresh refused (${err.message}), logging in again`);
      }
    }
    await login();
  }

  async function ensureCapabilities(installation) {
    const state = installations.get(installation.id);
    if (state?.capabilities && Date.now() + 60_000 < state.expiresAt) {
      return state;
    }
    const json = await send('Srv', { numinst: installation.id, uuid: session.uuid }, installation);
    const data = json?.data?.xSSrv?.installation;
    if (!data?.capabilities) {
      throw new VerisureError(firstError(json)?.message ?? 'No capabilities for this installation');
    }
    const payload = decodeJwt(data.capabilities) ?? {};
    const entry = (payload.installations ?? []).find(
      (item) => String(item.ins) === String(installation.id),
    );
    const next = {
      ...state,
      capabilities: data.capabilities,
      expiresAt: payload.exp ? payload.exp * 1000 : Date.now() + 10 * 60_000,
      caps: new Set(entry?.cap ?? []),
      services: data.services ?? [],
      partitions: data.configRepoUser?.alarmPartitions ?? [],
    };
    installations.set(installation.id, next);
    return next;
  }

  // An installation call: valid session and capabilities, and one new login
  // when the server says the session died anyway.
  async function call(operation, variables, installation, retried = false) {
    if (!AUTH_OPERATIONS.has(operation)) {
      await ensureAuth();
      if (installation) {
        await ensureCapabilities(installation);
      }
    }
    const json = await send(operation, variables, installation);
    const error = firstError(json);
    const empty = !json?.data || Object.values(json.data).every((value) => value === null);
    if (error && empty) {
      if (error.data?.status === 403 && !retried) {
        hash = null;
        if (installation) {
          installations.delete(installation.id);
        }
        return call(operation, variables, installation, true);
      }
      throw new VerisureError(error.message ?? `${operation} failed`, {
        code: errorCode(json),
        status: error.data?.status,
      });
    }
    return json.data;
  }

  // Order submitted, reference received: poll its status until the panel
  // answers something other than WAIT.
  async function poll(operation, buildVariables, installation, field) {
    const deadline = Date.now() + pollTimeoutMs;
    for (let counter = 1; ; counter += 1) {
      if (counter > 1) {
        if (Date.now() > deadline) {
          throw new VerisureError('The alarm did not answer in time', { code: 'TIMEOUT' });
        }
        await sleep(pollDelayMs);
      }
      let result;
      try {
        result = (await call(operation, buildVariables(counter), installation))?.[field];
      } catch (err) {
        if (err.status === 409) {
          continue;
        }
        throw err;
      }
      if (result && result.res !== 'WAIT') {
        return result;
      }
    }
  }

  function hasPerimeter(installation) {
    const state = installations.get(installation.id);
    if (!state) {
      return false;
    }
    if (state.caps?.has('PERI')) {
      return true;
    }
    for (const service of state.services ?? []) {
      if (service.request === 'PERI' && service.active) {
        return true;
      }
      if ((service.attributes?.attributes ?? []).some((attr) => attr.name === 'PERI')) {
        return true;
      }
    }
    return (state.partitions ?? []).some(
      (partition) => partition?.id === '02' && partition.enterStates?.length,
    );
  }

  function rememberProtom(installation, letter) {
    if (letter) {
      const state = installations.get(installation.id) ?? {};
      installations.set(installation.id, { ...state, protom: letter });
    }
  }

  async function openZones(installation, referenceId, suid) {
    if (!referenceId && !suid) {
      return [];
    }
    try {
      const result = await poll(
        'xSGetExceptions',
        (counter) => ({
          numinst: installation.id,
          panel: installation.panel,
          referenceId,
          counter,
          suid,
        }),
        installation,
        'xSGetExceptions',
      );
      return (result.exceptions ?? []).map((item) => item.alias).filter(Boolean);
    } catch (err) {
      logger.debug(`Cannot read the open zones: ${err.message}`);
      return [];
    }
  }

  // One order (`ARM1`, `DARM1`...), submitted then polled to its end. Answers
  // the panel letter.
  async function runOrder(installation, order, { force = false } = {}) {
    const current = installations.get(installation.id)?.protom ?? '';
    const base = { numinst: installation.id, panel: installation.panel };
    if (order.startsWith('DARM')) {
      const submit = await call(
        'xSDisarmPanel',
        { ...base, request: order, currentStatus: current },
        installation,
      );
      const referenceId = submit?.xSDisarmPanel?.referenceId;
      const result = await poll(
        'DisarmStatus',
        (counter) => ({ ...base, request: order, currentStatus: current, referenceId, counter }),
        installation,
        'xSDisarmStatus',
      );
      if (result.res === 'ERROR' && result.error?.type !== 'NON_BLOCKING') {
        throw new VerisureError(result.msg || 'The alarm refused to disarm', { code: result.msg });
      }
      rememberProtom(installation, result.protomResponse);
      return result.protomResponse;
    }

    let forcing = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const extra = forcing ? { forceArmingRemoteId: forcing.referenceId, suid: forcing.suid } : {};
      const submit = await call(
        'xSArmPanel',
        { ...base, request: order, currentStatus: current, armAndLock: false, ...extra },
        installation,
      );
      const referenceId = submit?.xSArmPanel?.referenceId;
      const result = await poll(
        'ArmStatus',
        (counter) => ({
          ...base,
          request: order,
          referenceId,
          counter,
          armAndLock: false,
          ...(forcing ? { forceArmingRemoteId: forcing.referenceId } : {}),
        }),
        installation,
        'xSArmStatus',
      );
      if (result.res !== 'ERROR') {
        rememberProtom(installation, result.protomResponse);
        return result.protomResponse;
      }
      const error = result.error ?? {};
      const openZone =
        ['NON_BLOCKING', 'ZONE'].includes(error.type) ||
        (result.msg === 'error_mpj_exception' &&
          (error.allowForcing || Number(error.exceptionsNumber) > 0));
      if (!openZone) {
        throw new VerisureError(result.msg || 'The alarm refused to arm', { code: result.msg });
      }
      const canForce = Boolean(error.allowForcing && (error.referenceId || error.suid));
      if (force && canForce && !forcing) {
        forcing = { referenceId: error.referenceId, suid: error.suid };
        continue;
      }
      const zones = await openZones(installation, error.referenceId, error.suid);
      throw new ArmingRefusedError(
        zones.length ? `Open: ${zones.join(', ')}` : 'A door or a window is open',
        { allowForcing: canForce, details: zones, code: 'OPEN_ZONE' },
      );
    }
    throw new ArmingRefusedError('The alarm refused the forced arming', { code: 'OPEN_ZONE' });
  }

  return {
    platform: 'owa',

    get mfaPending() {
      return mfaPending;
    },

    async login() {
      hash = null;
      await ensureAuth();
    },

    async requestCode() {
      const json = await send('mkValidateDevice', {
        idDevice: session.deviceId,
        idDeviceIndigitall: session.indigitall,
        uuid: session.uuid,
        deviceName: DEVICE.name,
        deviceBrand: DEVICE.brand,
        deviceOsVersion: DEVICE.osVersion,
        deviceVersion: DEVICE.version,
      });
      const challenge = firstError(json)?.data;
      if (!challenge?.['auth-otp-hash']) {
        // Already validated: nothing to send.
        if (json?.data?.xSValidateDevice?.hash) {
          setHash(json.data.xSValidateDevice.hash);
          mfaPending = false;
          return { channel: 'none' };
        }
        throw new VerisureError(firstError(json)?.message ?? 'No verification challenge');
      }
      const phones = challenge['auth-phones'] ?? [];
      if (phones.length === 0) {
        throw new VerisureError('No phone number on this Verisure account');
      }
      pendingOtpHash = challenge['auth-otp-hash'];
      const sent = await send('mkSendOTP', { recordId: phones[0].id, otpHash: pendingOtpHash });
      if (sent?.data?.xSSendOtp?.res !== 'OK') {
        throw new VerisureError(firstError(sent)?.message ?? 'Verisure could not send the code');
      }
      return { channel: 'sms', destination: phones[0].phone };
    },

    async validateCode(code) {
      if (!pendingOtpHash) {
        throw new VerisureError('Ask for a code first', { code: 'NO_CHALLENGE' });
      }
      otpChallenge = { otpHash: pendingOtpHash, code: String(code).trim() };
      let json;
      try {
        json = await send('mkValidateDevice', {
          idDevice: session.deviceId,
          idDeviceIndigitall: session.indigitall,
          uuid: session.uuid,
          deviceName: DEVICE.name,
          deviceBrand: DEVICE.brand,
          deviceOsVersion: DEVICE.osVersion,
          deviceVersion: DEVICE.version,
        });
      } finally {
        // A code is used once: never replay it in a later header.
        otpChallenge = null;
      }
      const data = json?.data?.xSValidateDevice;
      if (!data || firstError(json)?.data?.['auth-otp-hash']) {
        throw new AuthenticationError('Verisure refused the verification code');
      }
      pendingOtpHash = null;
      mfaPending = false;
      if (data.refreshToken) {
        session.refreshToken = data.refreshToken;
        saveSession();
      }
      if (data.hash) {
        setHash(data.hash);
      } else {
        // The device is authorized, the session comes from a regular login.
        await login();
      }
    },

    async listInstallations() {
      const data = await call('mkInstallationList', {});
      return (data?.xSInstallations?.installations ?? []).map((item) => ({
        id: String(item.numinst),
        panel: item.panel,
        name: item.alias || String(item.numinst),
        address: [item.address, item.city].filter(Boolean).join(', '),
      }));
    },

    supportedModes(installation) {
      const modes = [MODES.DISARMED, MODES.ARMED_HOME, MODES.ARMED_NIGHT, MODES.ARMED_AWAY];
      if (hasPerimeter(installation)) {
        modes.push(
          MODES.PERIMETER,
          MODES.ARMED_HOME_PERIMETER,
          MODES.ARMED_NIGHT_PERIMETER,
          MODES.ARMED_AWAY_PERIMETER,
        );
      }
      return modes;
    },

    async fetchState(installation) {
      // xSStatus reads what the cloud knows, without waking the panel.
      const data = await call('Status', { numinst: installation.id }, installation);
      const status = data?.xSStatus ?? {};
      rememberProtom(installation, status.status);
      const services = installations.get(installation.id)?.services ?? [];
      const climates = services.some(
        (service) => COMFORT_SERVICES.has(service.request) && service.active,
      )
        ? await readComfort(installation)
        : [];
      return {
        alarm: {
          mode: PROTO_TO_MODE[status.status] ?? UNKNOWN_MODE,
          raw: status.status ?? null,
          changedAt: status.timestampUpdate ?? null,
          changedBy: null,
          changedVia: null,
        },
        doorWindows: [],
        climates,
        smartPlugs: [],
        locks: [],
      };
    },

    // Asks the panel itself (slower, wakes it up): the "refresh" of the app.
    async checkAlarm(installation) {
      const base = { numinst: installation.id, panel: installation.panel };
      const submit = await call('CheckAlarm', base, installation);
      const referenceId = submit?.xSCheckAlarm?.referenceId;
      const result = await poll(
        'CheckAlarmStatus',
        () => ({ ...base, referenceId, idService: ALARM_STATUS_SERVICE_ID }),
        installation,
        'xSCheckAlarmStatus',
      );
      rememberProtom(installation, result.protomResponse);
      return PROTO_TO_MODE[result.protomResponse] ?? UNKNOWN_MODE;
    },

    async setAlarmMode(installation, mode, { force = false } = {}) {
      await ensureAuth();
      await ensureCapabilities(installation);
      const current = PROTO_TO_MODE[installations.get(installation.id)?.protom] ?? UNKNOWN_MODE;
      const steps = planOrders(current, mode, hasPerimeter(installation));
      let letter = installations.get(installation.id)?.protom;
      for (const alternatives of steps) {
        let lastError;
        let done = false;
        for (const alternative of alternatives) {
          try {
            for (const order of alternative.split('+')) {
              letter = await runOrder(installation, order, { force });
            }
            done = true;
            break;
          } catch (err) {
            // A refusal (open door), a block or a lost session is the answer;
            // only an order this panel does not know moves to the next spelling.
            if (
              err instanceof ArmingRefusedError ||
              err instanceof RateLimitError ||
              err instanceof AuthenticationError
            ) {
              throw err;
            }
            lastError = err;
            logger.debug(`Order ${alternative} refused (${err.message})`);
          }
        }
        if (!done) {
          throw lastError;
        }
      }
      return { mode: PROTO_TO_MODE[letter] ?? mode };
    },

    async setSmartPlug() {
      throw new VerisureError('Smart plugs are not available on this Verisure platform');
    },

    async setLock() {
      throw new VerisureError('Smart locks are not available on this Verisure platform yet');
    },

    async logout() {
      try {
        if (hash) {
          await request(url, {
            method: 'POST',
            headers: headers('Logout'),
            body: { operationName: 'Logout', variables: {}, query: 'mutation Logout { xSLogout }' },
          });
        }
      } finally {
        hash = null;
        session.refreshToken = '';
        saveSession();
      }
    },
  };

  async function readComfort(installation) {
    try {
      const data = await call('Sentinel', { numinst: installation.id }, installation);
      return (data?.xSComfort?.devices ?? [])
        .filter((device) => device?.zone !== undefined && device?.status)
        .map((device) => ({
          id: String(device.zone),
          name: device.alias || `Sentinel ${device.zone}`,
          temperature: toNumber(device.status.temperature),
          humidity: toNumber(device.status.humidity),
        }));
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof AuthenticationError) {
        throw err;
      }
      logger.debug(`Comfort sensors unavailable: ${err.message}`);
      return [];
    }
  }
}

function toNumber(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : number;
}
