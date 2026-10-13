import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_URLS, createOwaClient, planOrders, PROTO_TO_MODE } from '../src/verisure/owa.js';
import {
  ArmingRefusedError,
  AuthenticationError,
  MfaRequiredError,
  RateLimitError,
} from '../src/verisure/errors.js';
import { MODES } from '../src/verisure/modes.js';
import { fakeFetch, fakeJwt } from './helpers/fakeFetch.js';

const INSTALLATION = { id: '1234567', panel: 'SDVFAST', name: 'Maison' };
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

const capabilities = (caps = ['ARM', 'DARM', 'ARMDAY', 'ARMNIGHT']) =>
  fakeJwt({ exp: inAnHour(), installations: [{ ins: '1234567', cap: caps }] });

// A Verisure OWA cloud: each test overrides the operations it is about.
function cloud(overrides = {}) {
  return (call) => {
    const operation = call.body?.operationName;
    if (overrides[operation]) {
      return overrides[operation](call);
    }
    switch (operation) {
      case 'mkLoginToken':
        return {
          json: {
            data: {
              xSLoginToken: {
                res: 'OK',
                hash: fakeJwt({ exp: inAnHour() }),
                refreshToken: 'refresh-1',
                needDeviceAuthorization: false,
              },
            },
          },
        };
      case 'Srv':
        return {
          json: {
            data: {
              xSSrv: {
                installation: {
                  capabilities: capabilities(),
                  services: [{ request: 'CONFORT', active: true, attributes: { attributes: [] } }],
                  configRepoUser: { alarmPartitions: [] },
                },
              },
            },
          },
        };
      case 'mkInstallationList':
        return {
          json: {
            data: {
              xSInstallations: {
                installations: [
                  { numinst: '1234567', alias: 'Maison', panel: 'SDVFAST', city: 'Lyon' },
                ],
              },
            },
          },
        };
      case 'Status':
        return {
          json: { data: { xSStatus: { status: 'P', timestampUpdate: '2026-10-13T07:00:00Z' } } },
        };
      case 'Sentinel':
        return {
          json: {
            data: {
              xSComfort: {
                devices: [{ alias: 'Salon', zone: '5', status: { temperature: 21, humidity: 47 } }],
              },
            },
          },
        };
      default:
        return { json: { errors: [{ message: `unexpected ${operation}` }], data: null } };
    }
  };
}

const client = (extra = {}) =>
  createOwaClient({
    username: 'jean@example.fr',
    password: 'pw',
    country: 'FR',
    pollDelayMs: 0,
    ...extra,
  });

test('the panel letters map to the modes', () => {
  assert.equal(PROTO_TO_MODE.D, MODES.DISARMED);
  assert.equal(PROTO_TO_MODE.P, MODES.ARMED_HOME);
  assert.equal(PROTO_TO_MODE.Q, MODES.ARMED_NIGHT);
  assert.equal(PROTO_TO_MODE.T, MODES.ARMED_AWAY);
  assert.equal(PROTO_TO_MODE.A, MODES.ARMED_AWAY_PERIMETER);
  assert.equal(PROTO_TO_MODE.E, MODES.PERIMETER);
});

test('planOrders: arming from disarmed is one order', () => {
  assert.deepEqual(planOrders(MODES.DISARMED, MODES.ARMED_AWAY, false), [['ARM1']]);
  assert.deepEqual(planOrders(MODES.DISARMED, MODES.ARMED_HOME, false), [['ARMDAY1']]);
  assert.deepEqual(planOrders(MODES.DISARMED, MODES.ARMED_NIGHT, false), [['ARMNIGHT1']]);
});

test('planOrders: another interior mode needs a disarm first', () => {
  assert.deepEqual(planOrders(MODES.ARMED_HOME, MODES.ARMED_AWAY, false), [['DARM1'], ['ARM1']]);
});

test('planOrders: the perimeter is disarmed with the interior when the panel has one', () => {
  assert.deepEqual(planOrders(MODES.ARMED_AWAY, MODES.DISARMED, false), [['DARM1']]);
  assert.deepEqual(planOrders(MODES.ARMED_AWAY_PERIMETER, MODES.DISARMED, true), [
    ['DARM1DARMPERI', 'DARM1'],
  ]);
  assert.deepEqual(planOrders(MODES.PERIMETER, MODES.DISARMED, true), [['DARMPERI', 'DARM1']]);
  assert.deepEqual(planOrders(MODES.DISARMED, MODES.DISARMED, true), []);
});

test('planOrders: interior + perimeter tries the spellings of every country', () => {
  assert.deepEqual(planOrders(MODES.DISARMED, MODES.ARMED_AWAY_PERIMETER, true), [
    ['ARMINTEXT1', 'ARM1PERI1', 'ARM1+PERI1'],
  ]);
  assert.deepEqual(planOrders(MODES.ARMED_AWAY, MODES.ARMED_AWAY_PERIMETER, true), [['PERI1']]);
});

test('planOrders: from an unknown state, disarming still works', () => {
  assert.deepEqual(planOrders('unknown', MODES.DISARMED, false), [['DARM1']]);
  assert.deepEqual(planOrders('unknown', MODES.DISARMED, true), [['DARM1DARMPERI', 'DARM1']]);
});

test('the API host follows the country', async (t) => {
  const { calls } = fakeFetch(t, cloud());
  await client({ country: 'ES' }).login();
  assert.equal(calls[0].url.href, API_URLS.ES);
});

test('login sends the credentials and the device identity, then uses the hash', async (t) => {
  const sessions = [];
  const { calls } = fakeFetch(t, cloud());
  const verisure = client({ onSession: (session) => sessions.push(session) });
  const installations = await verisure.listInstallations();
  assert.deepEqual(installations, [
    { id: '1234567', panel: 'SDVFAST', name: 'Maison', address: 'Lyon' },
  ]);

  const login = calls[0];
  assert.equal(login.body.operationName, 'mkLoginToken');
  assert.equal(login.body.variables.user, 'jean@example.fr');
  assert.equal(login.body.variables.country, 'FR');
  assert.equal(login.body.variables.lang, 'fr');
  assert.match(login.body.variables.idDevice, /^[0-9a-f]{16}$/);
  assert.match(login.body.query, /xSLoginToken/);

  const list = calls[1];
  const auth = JSON.parse(list.headers.auth);
  assert.equal(auth.user, 'jean@example.fr');
  assert.ok(auth.hash, 'the session hash travels in the auth header');
  assert.equal(sessions.at(-1).refreshToken, 'refresh-1', 'the refresh token is kept');
});

test('the device identity survives a restart', async (t) => {
  fakeFetch(t, cloud());
  const sessions = [];
  await client({ onSession: (session) => sessions.push(session) }).login();
  const saved = sessions.at(-1);
  const { calls } = fakeFetch(t, cloud());
  await client({ session: saved }).login();
  // With a refresh token saved, the session is renewed without the password.
  assert.equal(calls[0].body.operationName, 'RefreshLogin');
  assert.equal(calls[0].body.variables.idDevice, saved.deviceId);
  assert.equal(calls[0].body.variables.refreshToken, 'refresh-1');
});

test('a new device must be validated by SMS: send_code, then validate_code', async (t) => {
  let validated = false;
  const { calls } = fakeFetch(
    t,
    cloud({
      mkLoginToken: () =>
        validated
          ? cloud()({ body: { operationName: 'mkLoginToken' } })
          : { json: { data: { xSLoginToken: { needDeviceAuthorization: true } } } },
      mkValidateDevice: (call) => {
        if (!call.headers.security) {
          return {
            json: {
              errors: [
                {
                  message: 'Unauthorized',
                  data: {
                    'auth-otp-hash': 'otp-hash-1',
                    'auth-phones': [{ id: 7, phone: '*******789' }],
                  },
                },
              ],
              data: null,
            },
          };
        }
        const security = JSON.parse(call.headers.security);
        assert.deepEqual(security, { token: '654321', type: 'OTP', otpHash: 'otp-hash-1' });
        validated = true;
        return {
          json: {
            data: {
              xSValidateDevice: {
                res: 'OK',
                hash: fakeJwt({ exp: inAnHour() }),
                refreshToken: 'refresh-2',
              },
            },
          },
        };
      },
      mkSendOTP: (call) => {
        assert.deepEqual(call.body.variables, { recordId: 7, otpHash: 'otp-hash-1' });
        return { json: { data: { xSSendOtp: { res: 'OK' } } } };
      },
    }),
  );
  const verisure = client();
  await assert.rejects(verisure.login(), MfaRequiredError);
  assert.deepEqual(await verisure.requestCode(), { channel: 'sms', destination: '*******789' });
  await verisure.validateCode('654321');
  assert.equal(verisure.mfaPending, false);
  await verisure.listInstallations();
  const last = calls.at(-1);
  assert.equal(last.headers.security, undefined, 'a code is never sent twice');
  assert.equal(last.body.operationName, 'mkInstallationList');
});

test('a wrong code is refused', async (t) => {
  fakeFetch(
    t,
    cloud({
      mkValidateDevice: () => ({
        json: {
          errors: [
            {
              message: 'Unauthorized',
              data: { 'auth-otp-hash': 'otp-hash-1', 'auth-phones': [{ id: 7, phone: '***' }] },
            },
          ],
          data: null,
        },
      }),
      mkSendOTP: () => ({ json: { data: { xSSendOtp: { res: 'OK' } } } }),
    }),
  );
  const verisure = client();
  await verisure.requestCode();
  await assert.rejects(verisure.validateCode('000000'), AuthenticationError);
});

test('validate_code before send_code explains what to do', async () => {
  await assert.rejects(client().validateCode('123456'), (err) => err.code === 'NO_CHALLENGE');
});

test('a blocked account is an authentication error', async (t) => {
  fakeFetch(
    t,
    cloud({
      mkLoginToken: () => ({
        json: { errors: [{ message: 'blocked', data: { err: '60052' } }], data: null },
      }),
    }),
  );
  await assert.rejects(client().login(), AuthenticationError);
});

test('the WAF block is a rate limit', async (t) => {
  fakeFetch(t, () => ({ status: 403, text: '<html>_Incapsula_Resource</html>' }));
  await assert.rejects(client().login(), RateLimitError);
});

test('fetchState reads the status without waking the panel, plus the comfort sensors', async (t) => {
  const { calls } = fakeFetch(t, cloud());
  const state = await client().fetchState(INSTALLATION);
  assert.equal(state.alarm.mode, MODES.ARMED_HOME);
  assert.equal(state.alarm.raw, 'P');
  assert.deepEqual(state.climates, [{ id: '5', name: 'Salon', temperature: 21, humidity: 47 }]);
  const operations = calls.map((call) => call.body.operationName);
  assert.deepEqual(operations, ['mkLoginToken', 'Srv', 'Status', 'Sentinel']);
  const status = calls[2];
  assert.equal(status.headers.numinst, '1234567');
  assert.equal(status.headers.panel, 'SDVFAST');
  assert.ok(status.headers['x-capabilities'], 'the capabilities token travels with the call');
});

test('the perimeter modes are offered only to panels with a perimeter', async (t) => {
  fakeFetch(t, cloud());
  const plain = client();
  await plain.fetchState(INSTALLATION);
  assert.ok(!plain.supportedModes(INSTALLATION).includes(MODES.PERIMETER));

  fakeFetch(
    t,
    cloud({
      Srv: () => ({
        json: {
          data: {
            xSSrv: {
              installation: {
                capabilities: capabilities(['ARM', 'PERI']),
                services: [],
                configRepoUser: { alarmPartitions: [] },
              },
            },
          },
        },
      }),
    }),
  );
  const withPerimeter = client();
  await withPerimeter.fetchState(INSTALLATION);
  assert.ok(withPerimeter.supportedModes(INSTALLATION).includes(MODES.ARMED_AWAY_PERIMETER));
});

// The panel answers WAIT, then the result.
function armCloud({ armResult, disarmResult, extra = {} }) {
  let armPolls = 0;
  return cloud({
    Status: () => ({ json: { data: { xSStatus: { status: 'D' } } } }),
    xSArmPanel: () => ({ json: { data: { xSArmPanel: { res: 'OK', referenceId: 'REF1' } } } }),
    ArmStatus: (call) => {
      armPolls += 1;
      if (armPolls === 1) {
        return { json: { data: { xSArmStatus: { res: 'WAIT' } } } };
      }
      return { json: { data: { xSArmStatus: armResult(call) } } };
    },
    xSDisarmPanel: () => ({
      json: { data: { xSDisarmPanel: { res: 'OK', referenceId: 'REF2' } } },
    }),
    DisarmStatus: () => ({ json: { data: { xSDisarmStatus: disarmResult?.() } } }),
    ...extra,
  });
}

test('setAlarmMode submits the order and polls its status', async (t) => {
  const { calls } = fakeFetch(
    t,
    armCloud({ armResult: () => ({ res: 'OK', protomResponse: 'T' }) }),
  );
  const verisure = client();
  await verisure.fetchState(INSTALLATION);
  assert.deepEqual(await verisure.setAlarmMode(INSTALLATION, MODES.ARMED_AWAY), {
    mode: MODES.ARMED_AWAY,
  });
  const submit = calls.find((call) => call.body.operationName === 'xSArmPanel');
  assert.equal(submit.body.variables.request, 'ARM1');
  assert.equal(submit.body.variables.currentStatus, 'D');
  const polls = calls.filter((call) => call.body.operationName === 'ArmStatus');
  assert.deepEqual(
    polls.map((call) => call.body.variables.counter),
    [1, 2],
  );
  assert.ok(polls.every((call) => call.body.variables.referenceId === 'REF1'));
});

test('an open door refuses the arming, with the zones and a way to force', async (t) => {
  fakeFetch(
    t,
    armCloud({
      armResult: () => ({
        res: 'ERROR',
        msg: 'error_mpj_exception',
        error: { type: 'NON_BLOCKING', allowForcing: true, referenceId: 'EXC1', suid: 'S1' },
      }),
      extra: {
        xSGetExceptions: () => ({
          json: {
            data: { xSGetExceptions: { res: 'OK', exceptions: [{ alias: 'Porte entrée' }] } },
          },
        }),
      },
    }),
  );
  const verisure = client();
  await verisure.fetchState(INSTALLATION);
  await assert.rejects(verisure.setAlarmMode(INSTALLATION, MODES.ARMED_AWAY), (err) => {
    assert.ok(err instanceof ArmingRefusedError);
    assert.equal(err.allowForcing, true);
    assert.deepEqual(err.details, ['Porte entrée']);
    return true;
  });
});

test('force re-submits the order with the exception reference', async (t) => {
  const { calls } = fakeFetch(
    t,
    armCloud({
      armResult: (call) =>
        call.body.variables.forceArmingRemoteId
          ? { res: 'OK', protomResponse: 'T' }
          : {
              res: 'ERROR',
              msg: 'error_mpj_exception',
              error: { type: 'NON_BLOCKING', allowForcing: true, referenceId: 'EXC1', suid: 'S1' },
            },
    }),
  );
  const verisure = client();
  await verisure.fetchState(INSTALLATION);
  const result = await verisure.setAlarmMode(INSTALLATION, MODES.ARMED_AWAY, { force: true });
  assert.equal(result.mode, MODES.ARMED_AWAY);
  const forced = calls.filter((call) => call.body.operationName === 'xSArmPanel').at(-1);
  assert.equal(forced.body.variables.forceArmingRemoteId, 'EXC1');
  assert.equal(forced.body.variables.suid, 'S1');
});

test('disarming polls the disarm status', async (t) => {
  const { calls } = fakeFetch(
    t,
    armCloud({
      armResult: () => ({ res: 'OK' }),
      disarmResult: () => ({ res: 'OK', protomResponse: 'D' }),
      extra: { Status: () => ({ json: { data: { xSStatus: { status: 'T' } } } }) },
    }),
  );
  const verisure = client();
  await verisure.fetchState(INSTALLATION);
  assert.deepEqual(await verisure.setAlarmMode(INSTALLATION, MODES.DISARMED), {
    mode: MODES.DISARMED,
  });
  const submit = calls.find((call) => call.body.operationName === 'xSDisarmPanel');
  assert.equal(submit.body.variables.request, 'DARM1');
});

test('checkAlarm asks the panel and reads its answer', async (t) => {
  fakeFetch(
    t,
    cloud({
      CheckAlarm: () => ({ json: { data: { xSCheckAlarm: { res: 'OK', referenceId: 'C1' } } } }),
      CheckAlarmStatus: (call) => {
        assert.equal(call.body.variables.idService, '11');
        return { json: { data: { xSCheckAlarmStatus: { res: 'OK', protomResponse: 'Q' } } } };
      },
    }),
  );
  assert.equal(await client().checkAlarm(INSTALLATION), MODES.ARMED_NIGHT);
});

test('a session the server declares dead is reopened once', async (t) => {
  let statusCalls = 0;
  const { calls } = fakeFetch(
    t,
    cloud({
      Status: () => {
        statusCalls += 1;
        return statusCalls === 1
          ? {
              json: { errors: [{ message: 'Invalid session', data: { status: 403 } }], data: null },
            }
          : { json: { data: { xSStatus: { status: 'D' } } } };
      },
    }),
  );
  const state = await client().fetchState(INSTALLATION);
  assert.equal(state.alarm.mode, MODES.DISARMED);
  assert.equal(calls.filter((call) => call.body.operationName === 'Srv').length, 2);
});
