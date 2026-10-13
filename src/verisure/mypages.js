// -----------------------------------------------------------------------------
// Client of the "mypages" Verisure cloud (the "Verisure" app: Nordics, Benelux,
// Germany...), a GraphQL API behind cookie authentication.
//
// Ported from python-verisure (the library of the Home Assistant core
// integration), which documents what the official app sends:
//   - POST /auth/login with HTTP Basic credentials sets the session cookies
//     (`vid`, `vs-access`, `vs-refresh`). With two-factor authentication on,
//     the answer carries a `stepUpToken` instead: POST /auth/mfa?type=phone
//     sends the code, POST /auth/mfa/validate checks it, and POST /auth/trust
//     returns a `vs-trust-*` cookie that spares the code at the next logins;
//   - the access cookie lives about 15 minutes, GET /auth/token renews it;
//   - POST /graphql takes one operation or a list of operations;
//   - two hosts serve the API: on a 5xx (or the `SYS_00004` maintenance
//     answer) the other one is tried, and remembered.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AuthenticationError,
  ArmingRefusedError,
  MfaRequiredError,
  RateLimitError,
  VerisureError,
} from './errors.js';
import { cookieHeader, mergeCookies, request, sleep } from './http.js';
import { MODES, UNKNOWN_MODE } from './modes.js';

const logger = createLogger({ name: 'mypages' });

export const BASE_URLS = ['https://automation01.verisure.com', 'https://automation02.verisure.com'];

// The application id python-verisure presents; the API refuses requests
// without one.
const APPLICATION_ID = 'PS_PYTHON';

const RATE_LIMIT_MARKERS = [
  'aut_00021',
  'acc_00002',
  'toomanystepuptokens',
  'too many step up tokens',
  'request limit',
  'rate limit',
  'too many requests',
];

// Arm-state change: the mutation answers a transaction id, the result is
// polled until the panel confirms (or refuses).
const POLL_ATTEMPTS = 30;
const POLL_DELAY_MS = 1000;

const ARM_OPERATIONS = {
  [MODES.ARMED_AWAY]: { operation: 'armAway', field: 'armStateArmAway', future: 'ARMED_AWAY' },
  [MODES.ARMED_HOME]: { operation: 'armHome', field: 'armStateArmHome', future: 'ARMED_HOME' },
  [MODES.DISARMED]: { operation: 'disarm', field: 'armStateDisarm', future: 'DISARMED' },
};

const STATUS_TO_MODE = {
  DISARMED: MODES.DISARMED,
  ARMED_HOME: MODES.ARMED_HOME,
  ARMED_AWAY: MODES.ARMED_AWAY,
};

// GraphQL documents, as python-verisure sends them (trimmed of the fields the
// integration does not read).
const QUERIES = {
  installations:
    'query fetchAllInstallations($email: String!) { account(email: $email) { installations { giid alias address { street city postalNumber } } } }',
  armState:
    'query ArmState($giid: String!) { installation(giid: $giid) { armState { type statusType date name changedVia } } }',
  doorWindow:
    'query DoorWindow($giid: String!) { installation(giid: $giid) { doorWindows { device { deviceLabel } type area state wired reportTime } } }',
  climate:
    'query Climate($giid: String!) { installation(giid: $giid) { climates { device { deviceLabel area gui { label } } humidityEnabled humidityValue temperatureValue temperatureTimestamp } } }',
  smartPlugs:
    'query SmartPlug($giid: String!) { installation(giid: $giid) { smartplugs { device { deviceLabel area } currentState icon isHazardous } } }',
  smartLocks:
    'query SmartLock($giid: String!) { installation(giid: $giid) { smartLocks { lockStatus doorState lockMethod eventTime device { deviceLabel area } } } }',
  armAway:
    'mutation armAway($giid: String!, $code: String!, $forceArm: Boolean) { armStateArmAway(giid: $giid, code: $code, forceArm: $forceArm) }',
  armHome:
    'mutation armHome($giid: String!, $code: String!, $forceArm: Boolean) { armStateArmHome(giid: $giid, code: $code, forceArm: $forceArm) }',
  disarm:
    'mutation disarm($giid: String!, $code: String!) { armStateDisarm(giid: $giid, code: $code) }',
  pollArmState:
    'query pollArmState($giid: String!, $transactionId: String, $futureState: ArmStateStatusTypes!) { installation(giid: $giid) { armStateChangePollResult(transactionId: $transactionId, futureState: $futureState) { result createTime } } }',
  setSmartPlug:
    'mutation UpdateState($giid: String!, $deviceLabel: String!, $state: Boolean!) { SmartPlugSetState(giid: $giid, input: [{deviceLabel: $deviceLabel, state: $state}]) }',
  lock: 'mutation DoorLock($giid: String!, $deviceLabel: String!, $input: LockDoorInput!) { DoorLock(giid: $giid, deviceLabel: $deviceLabel, input: $input) }',
  unlock:
    'mutation DoorUnlock($giid: String!, $deviceLabel: String!, $input: LockDoorInput!) { DoorUnlock(giid: $giid, deviceLabel: $deviceLabel, input: $input) }',
  pollLockState:
    'query pollLockState($giid: String!, $transactionId: String, $deviceLabel: String!, $futureState: DoorLockState!) { installation(giid: $giid) { doorLockStateChangePollResult(transactionId: $transactionId, deviceLabel: $deviceLabel, futureState: $futureState) { result createTime } } }',
};

// The GraphQL body of an operation: its name must be the one its document
// declares, or the server refuses it.
function gqlBody(key, variables) {
  const query = QUERIES[key];
  const [, operationName] = /^(?:query|mutation)\s+(\w+)/.exec(query);
  return { operationName, variables, query };
}

const isTrustCookie = (name) => name.startsWith('vs-trust');
const isRefreshCookie = (name) => name === 'vid' || name === 'vs-refresh';

function signalsRateLimit(text) {
  const lower = String(text ?? '').toLowerCase();
  return RATE_LIMIT_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * @param {{ username: string, password: string, code?: string,
 *   session?: Record<string, any>, onSession?: (session: object) => void,
 *   pollDelayMs?: number }} options `session` is what `onSession` saved last time
 */
export function createMyPagesClient(options) {
  const { username, password } = options;
  const alarmCode = options.code ?? '';
  const pollDelayMs = options.pollDelayMs ?? POLL_DELAY_MS;
  const jar = { ...(options.session?.cookies ?? {}) };
  let baseUrls = [...BASE_URLS];
  let mfaPending = false;

  const saveSession = () => options.onSession?.({ cookies: { ...jar } });

  // One HTTP call, on the host that answered last, then on the other one.
  async function send(path, init = {}) {
    let lastError = new VerisureError('Verisure did not answer');
    for (let attempt = 0; attempt < baseUrls.length; attempt += 1) {
      const base = baseUrls[0];
      let response;
      try {
        response = await request(`${base}${path}`, init);
        // The path and the status only: headers and bodies carry secrets.
        logger.debug(`${init.method ?? 'GET'} ${path} -> HTTP ${response.status}`);
      } catch (err) {
        lastError = err;
        baseUrls = [...baseUrls.slice(1), base];
        continue;
      }
      if (response.status === 429 || signalsRateLimit(response.text)) {
        throw new RateLimitError('Verisure refuses more requests for now', {
          status: response.status,
        });
      }
      if (response.status >= 500 || response.text.includes('SYS_00004')) {
        lastError = new VerisureError(`Verisure answered HTTP ${response.status}`, {
          status: response.status,
        });
        baseUrls = [...baseUrls.slice(1), base];
        continue;
      }
      return response;
    }
    throw lastError;
  }

  function baseHeaders(extra = {}) {
    return { APPLICATION_ID, Accept: 'application/json', ...extra };
  }

  async function login() {
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const trusted = cookieHeader(jar, isTrustCookie);
    const response = await send('/auth/login', {
      method: 'POST',
      headers: baseHeaders({
        Authorization: `Basic ${basic}`,
        ...(trusted ? { Cookie: trusted } : {}),
      }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError('Verisure refused the username or the password', {
        status: response.status,
      });
    }
    if (response.status >= 400) {
      throw new VerisureError(`Login failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    mergeCookies(jar, response.cookies);
    if (response.text.includes('stepUpToken')) {
      mfaPending = true;
      throw new MfaRequiredError();
    }
    mfaPending = false;
    saveSession();
  }

  async function refreshAccess() {
    const response = await send('/auth/token', {
      headers: baseHeaders({ Cookie: cookieHeader(jar, isRefreshCookie) }),
    });
    if (response.status >= 400) {
      return false;
    }
    mergeCookies(jar, response.cookies);
    saveSession();
    return true;
  }

  const isAuthFailure = ({ status, json }) => {
    if (status === 401 || status === 403) {
      return true;
    }
    const errors = Array.isArray(json) ? json.map((result) => result?.errors) : json?.errors;
    return /UNAUTHORIZED|AUT_0000|not authenticated/i.test(JSON.stringify(errors ?? ''));
  };

  // POST /graphql, renewing the session once when it expired.
  async function graphql(body) {
    if (!jar['vs-access']) {
      await login();
    }
    const post = () =>
      send('/graphql', {
        method: 'POST',
        headers: baseHeaders({ 'Content-Type': 'application/json', Cookie: cookieHeader(jar) }),
        body,
      });
    let response = await post();
    if (isAuthFailure(response)) {
      logger.debug('Session expired, renewing it');
      if (!(await refreshAccess())) {
        await login();
      }
      response = await post();
      if (isAuthFailure(response)) {
        throw new AuthenticationError('Verisure refused the session', { status: response.status });
      }
    }
    if (response.status >= 400 || response.json === undefined) {
      throw new VerisureError(`GraphQL call failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    return response.json;
  }

  // One operation: its `data`, or the first GraphQL error as an exception.
  async function operation(key, variables) {
    const json = await graphql(gqlBody(key, variables));
    const result = Array.isArray(json) ? json[0] : json;
    if (result?.errors?.length && !result.data) {
      throw new VerisureError(result.errors[0].message ?? 'GraphQL error', {
        code: result.errors[0].data?.errorCode,
      });
    }
    return result?.data ?? {};
  }

  // Several read operations in one call; an operation the installation does
  // not support (no lock, no plug) answers an error, which empties its part
  // instead of failing the whole read.
  async function batch(giid, names) {
    const json = await graphql(names.map((name) => gqlBody(name, { giid })));
    const results = Array.isArray(json) ? json : [json];
    const installation = {};
    results.forEach((result, index) => {
      if (result?.errors?.length) {
        logger.debug(`${names[index]}: ${result.errors[0].message}`);
      }
      Object.assign(installation, result?.data?.installation ?? {});
    });
    return installation;
  }

  async function pollResult(queryName, variables, path) {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(pollDelayMs);
      }
      const data = await operation(queryName, variables);
      const result = data?.installation?.[path]?.result;
      if (result && result !== 'NO_DATA') {
        return result;
      }
    }
    return null;
  }

  function requireCode() {
    if (!alarmCode) {
      throw new VerisureError('The alarm code is missing from the configuration', {
        code: 'CODE_REQUIRED',
      });
    }
    return alarmCode;
  }

  return {
    platform: 'mypages',

    get mfaPending() {
      return mfaPending;
    },

    async login() {
      await login();
    },

    async requestCode() {
      if (!mfaPending) {
        try {
          await login();
        } catch (err) {
          if (!(err instanceof MfaRequiredError)) {
            throw err;
          }
        }
        if (!mfaPending) {
          throw new VerisureError('This account does not ask for a verification code', {
            code: 'MFA_NOT_REQUIRED',
          });
        }
      }
      for (const type of ['phone', 'email']) {
        const response = await send(`/auth/mfa?type=${type}`, {
          method: 'POST',
          headers: baseHeaders({ Cookie: cookieHeader(jar) }),
        });
        if (response.status === 200) {
          mergeCookies(jar, response.cookies);
          return { channel: type === 'phone' ? 'sms' : 'email' };
        }
      }
      throw new VerisureError('Verisure could not send a verification code');
    },

    async validateCode(code) {
      const validate = await send('/auth/mfa/validate', {
        method: 'POST',
        headers: baseHeaders({ 'Content-Type': 'application/json', Cookie: cookieHeader(jar) }),
        body: { token: String(code).trim() },
      });
      if (validate.status >= 400) {
        throw new AuthenticationError('Verisure refused the verification code', {
          status: validate.status,
        });
      }
      mergeCookies(jar, validate.cookies);
      // Trust this "device": the next logins skip the code.
      const trust = await send('/auth/trust', {
        method: 'POST',
        headers: baseHeaders({ Cookie: cookieHeader(jar) }),
      });
      mergeCookies(jar, trust.cookies);
      mfaPending = false;
      saveSession();
    },

    async listInstallations() {
      const data = await operation('installations', { email: username });
      return (data?.account?.installations ?? []).map((item) => ({
        id: String(item.giid),
        name: item.alias || String(item.giid),
        address: [item.address?.street, item.address?.city].filter(Boolean).join(', '),
      }));
    },

    supportedModes() {
      return [MODES.DISARMED, MODES.ARMED_HOME, MODES.ARMED_AWAY];
    },

    async fetchState(installation) {
      const data = await batch(installation.id, [
        'armState',
        'doorWindow',
        'climate',
        'smartPlugs',
        'smartLocks',
      ]);
      return normalizeState(data);
    },

    // The cloud is the source of truth here: a check is a plain read.
    async checkAlarm(installation) {
      const data = await batch(installation.id, ['armState']);
      return normalizeState(data).alarm.mode;
    },

    async setAlarmMode(installation, mode, { force = false } = {}) {
      const order = ARM_OPERATIONS[mode];
      if (!order) {
        throw new VerisureError(`The ${mode} mode does not exist on this alarm`, {
          code: 'UNSUPPORTED_MODE',
        });
      }
      const variables = { giid: installation.id, code: requireCode() };
      if (mode !== MODES.DISARMED) {
        variables.forceArm = force;
      }
      const data = await operation(order.operation, variables);
      const transactionId = data?.[order.field];
      if (!transactionId) {
        throw new VerisureError('Verisure did not accept the order');
      }
      const result = await pollResult(
        'pollArmState',
        { giid: installation.id, transactionId, futureState: order.future },
        'armStateChangePollResult',
      );
      if (result === 'OK') {
        return { mode };
      }
      if (result === null) {
        throw new VerisureError('The alarm did not confirm the order in time', {
          code: 'TIMEOUT',
        });
      }
      throw new ArmingRefusedError(`The alarm refused the order (${result})`, {
        code: result,
        allowForcing: mode !== MODES.DISARMED && !force,
      });
    },

    async setSmartPlug(installation, plugId, on) {
      await operation('setSmartPlug', {
        giid: installation.id,
        deviceLabel: plugId,
        state: Boolean(on),
      });
    },

    async setLock(installation, lockId, locked) {
      const name = locked ? 'lock' : 'unlock';
      const data = await operation(name, {
        giid: installation.id,
        deviceLabel: lockId,
        input: { code: requireCode() },
      });
      const transactionId = data?.[locked ? 'DoorLock' : 'DoorUnlock'];
      const result = await pollResult(
        'pollLockState',
        {
          giid: installation.id,
          transactionId,
          deviceLabel: lockId,
          futureState: locked ? 'LOCKED' : 'UNLOCKED',
        },
        'doorLockStateChangePollResult',
      );
      if (result !== 'OK') {
        throw new VerisureError(`The lock did not confirm the order (${result ?? 'timeout'})`);
      }
    },

    async logout() {
      try {
        await send('/auth/logout', {
          method: 'DELETE',
          headers: baseHeaders({ Cookie: cookieHeader(jar) }),
        });
      } finally {
        for (const name of Object.keys(jar)) {
          delete jar[name];
        }
        saveSession();
      }
    },
  };
}

/**
 * The `installation` object of the read operations, in the shape the rest of
 * the integration uses for both clouds.
 */
export function normalizeState(installation) {
  const armState = installation.armState ?? {};
  return {
    alarm: {
      mode: STATUS_TO_MODE[armState.statusType] ?? UNKNOWN_MODE,
      raw: armState.statusType ?? null,
      changedAt: armState.date ?? null,
      changedBy: armState.name ?? null,
      changedVia: armState.changedVia ?? null,
    },
    doorWindows: (installation.doorWindows ?? [])
      .filter((item) => item?.device?.deviceLabel)
      .map((item) => ({
        id: item.device.deviceLabel,
        name: item.area || item.device.deviceLabel,
        kind: item.type ?? null,
        open: item.state === 'OPEN',
      })),
    climates: (installation.climates ?? [])
      .filter((item) => item?.device?.deviceLabel)
      .map((item) => ({
        id: item.device.deviceLabel,
        name: item.device.area || item.device.deviceLabel,
        temperature: toNumber(item.temperatureValue),
        humidity: item.humidityEnabled ? toNumber(item.humidityValue) : null,
      })),
    smartPlugs: (installation.smartplugs ?? [])
      .filter((item) => item?.device?.deviceLabel)
      .map((item) => ({
        id: item.device.deviceLabel,
        name: item.device.area || item.device.deviceLabel,
        on: item.currentState === 'ON',
      })),
    locks: (installation.smartLocks ?? [])
      .filter((item) => item?.device?.deviceLabel)
      .map((item) => ({
        id: item.device.deviceLabel,
        name: item.device.area || item.device.deviceLabel,
        locked: item.lockStatus === 'LOCKED',
        doorOpen: item.doorState === 'OPEN',
      })),
  };
}

function toNumber(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : number;
}
