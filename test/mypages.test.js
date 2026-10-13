import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMyPagesClient, normalizeState } from '../src/verisure/mypages.js';
import {
  ArmingRefusedError,
  AuthenticationError,
  MfaRequiredError,
  RateLimitError,
  VerisureError,
} from '../src/verisure/errors.js';
import { MODES } from '../src/verisure/modes.js';
import { fakeFetch } from './helpers/fakeFetch.js';

const INSTALLATION = { id: '123456789', name: 'Hus' };

const OVERVIEW = {
  armState: {
    statusType: 'ARMED_HOME',
    date: '2026-10-13T07:00:00.000Z',
    name: 'Anna',
    changedVia: 'CODE',
  },
  doorWindows: [
    { device: { deviceLabel: '3KCR TP3W' }, type: 'DOOR', area: 'Entrance', state: 'OPEN' },
    { device: { deviceLabel: '3KCR TP3X' }, type: 'WINDOW', area: 'Kitchen', state: 'CLOSE' },
  ],
  climates: [
    {
      device: { deviceLabel: 'CL1', area: 'Living room', gui: { label: 'SMOKE' } },
      humidityEnabled: true,
      humidityValue: 45,
      temperatureValue: 21.3,
    },
    {
      device: { deviceLabel: 'CL2', area: 'Garage' },
      humidityEnabled: false,
      humidityValue: null,
      temperatureValue: 12,
    },
  ],
  smartplugs: [{ device: { deviceLabel: 'SP1', area: 'Lamp' }, currentState: 'ON' }],
  smartLocks: [
    {
      device: { deviceLabel: 'LK1', area: 'Front door' },
      lockStatus: 'LOCKED',
      doorState: 'CLOSE',
    },
  ],
};

// A Verisure cloud that logs in at once and answers the overview.
function cloud(overrides = {}) {
  return (call) => {
    const path = call.url.pathname;
    if (overrides[path]) {
      return overrides[path](call);
    }
    if (path === '/auth/login') {
      return { json: {}, cookies: ['vid=V1; Path=/', 'vs-access=A1; Path=/', 'vs-refresh=R1'] };
    }
    if (path === '/graphql') {
      const operations = Array.isArray(call.body) ? call.body : [call.body];
      return {
        json: operations.map((op) => {
          if (op.operationName === 'fetchAllInstallations') {
            return {
              data: {
                account: {
                  installations: [
                    {
                      giid: '123456789',
                      alias: 'Hus',
                      address: { street: 'Gata 1', city: 'Lund' },
                    },
                  ],
                },
              },
            };
          }
          return { data: { installation: OVERVIEW } };
        }),
      };
    }
    return { status: 404, text: 'not found' };
  };
}

const client = (session) =>
  createMyPagesClient({
    username: 'anna@example.com',
    password: 'pw',
    code: '1234',
    session,
    onSession: () => {},
    pollDelayMs: 0,
  });

test('normalizeState turns the GraphQL answer into the common state', () => {
  const state = normalizeState(OVERVIEW);
  assert.deepEqual(state.alarm, {
    mode: MODES.ARMED_HOME,
    raw: 'ARMED_HOME',
    changedAt: '2026-10-13T07:00:00.000Z',
    changedBy: 'Anna',
    changedVia: 'CODE',
  });
  assert.deepEqual(
    state.doorWindows.map((item) => [item.id, item.open]),
    [
      ['3KCR TP3W', true],
      ['3KCR TP3X', false],
    ],
  );
  assert.equal(state.climates[0].humidity, 45);
  assert.equal(state.climates[1].humidity, null, 'humidity disabled on this detector');
  assert.equal(state.smartPlugs[0].on, true);
  assert.equal(state.locks[0].locked, true);
});

test('an unknown arm state reads as unknown, an empty answer as nothing', () => {
  const state = normalizeState({ armState: { statusType: 'SOMETHING' } });
  assert.equal(state.alarm.mode, 'unknown');
  assert.deepEqual(state.doorWindows, []);
});

test('the first call logs in with Basic credentials, then sends the session cookies', async (t) => {
  const { calls } = fakeFetch(t, cloud());
  const installations = await client().listInstallations();
  assert.deepEqual(installations, [{ id: '123456789', name: 'Hus', address: 'Gata 1, Lund' }]);
  const [login, graphql] = calls;
  assert.equal(login.url.pathname, '/auth/login');
  const basic = Buffer.from('anna@example.com:pw').toString('base64');
  assert.equal(login.headers.authorization, `Basic ${basic}`);
  assert.equal(login.headers.application_id, 'PS_PYTHON');
  assert.match(graphql.headers.cookie, /vs-access=A1/);
});

test('fetchState reads the whole installation in one request', async (t) => {
  const { calls } = fakeFetch(t, cloud());
  const state = await client().fetchState(INSTALLATION);
  assert.equal(state.alarm.mode, MODES.ARMED_HOME);
  const graphql = calls.filter((call) => call.url.pathname === '/graphql');
  assert.equal(graphql.length, 1);
  assert.deepEqual(
    graphql[0].body.map((op) => op.operationName),
    ['ArmState', 'DoorWindow', 'Climate', 'SmartPlug', 'SmartLock'],
  );
  assert.ok(graphql[0].body.every((op) => op.variables.giid === INSTALLATION.id));
});

test('a step-up answer asks for a code; send_code and validate_code trust the device', async (t) => {
  const sessions = [];
  let trusted = false;
  fakeFetch(
    t,
    cloud({
      '/auth/login': (call) =>
        trusted && /vs-trust-1=T/.test(call.headers.cookie ?? '')
          ? { json: {}, cookies: ['vs-access=A2'] }
          : { json: { stepUpToken: 'x' }, cookies: ['vs-stepup=S1'] },
      '/auth/mfa': (call) => {
        assert.equal(call.url.searchParams.get('type'), 'phone');
        assert.match(call.headers.cookie, /vs-stepup=S1/);
        return { json: {} };
      },
      '/auth/mfa/validate': (call) => {
        assert.deepEqual(call.body, { token: '123456' });
        return { json: {}, cookies: ['vs-access=A1', 'vid=V1'] };
      },
      '/auth/trust': () => {
        trusted = true;
        return { json: { trustTokenValue: 'T' }, cookies: ['vs-trust-1=T'] };
      },
    }),
  );
  const verisure = createMyPagesClient({
    username: 'anna@example.com',
    password: 'pw',
    onSession: (session) => sessions.push(session),
  });
  await assert.rejects(verisure.login(), MfaRequiredError);
  assert.equal(verisure.mfaPending, true);
  assert.deepEqual(await verisure.requestCode(), { channel: 'sms' });
  await verisure.validateCode(' 123456 ');
  assert.equal(verisure.mfaPending, false);
  assert.equal(sessions.at(-1).cookies['vs-trust-1'], 'T', 'the trust cookie is saved');

  // After a restart, the saved trust cookie spares the code.
  const restarted = createMyPagesClient({
    username: 'anna@example.com',
    password: 'pw',
    session: { cookies: { 'vs-trust-1': 'T' } },
  });
  await restarted.login();
});

test('a refused password is an authentication error, not a retry', async (t) => {
  fakeFetch(t, cloud({ '/auth/login': () => ({ status: 401, text: 'nope' }) }));
  await assert.rejects(client().login(), AuthenticationError);
});

test('an expired session is renewed through /auth/token, once', async (t) => {
  let graphqlCalls = 0;
  const { calls } = fakeFetch(
    t,
    cloud({
      '/graphql': () => {
        graphqlCalls += 1;
        return graphqlCalls === 1
          ? { status: 401, text: 'expired' }
          : { json: [{ data: { installation: OVERVIEW } }] };
      },
      '/auth/token': (call) => {
        assert.match(call.headers.cookie, /vs-refresh=R0/);
        assert.doesNotMatch(call.headers.cookie, /vs-access/, 'only the refresh cookies');
        return { json: {}, cookies: ['vs-access=A9'] };
      },
    }),
  );
  const state = await client({
    cookies: { 'vs-access': 'A0', vid: 'V0', 'vs-refresh': 'R0' },
  }).fetchState(INSTALLATION);
  assert.equal(state.alarm.mode, MODES.ARMED_HOME);
  assert.match(calls.at(-1).headers.cookie, /vs-access=A9/);
});

test('a 5xx moves to the second host, and it is remembered', async (t) => {
  const { calls } = fakeFetch(t, (call) =>
    call.url.host === 'automation01.verisure.com' ? { status: 503, text: 'down' } : cloud()(call),
  );
  const verisure = client();
  await verisure.listInstallations();
  await verisure.listInstallations();
  const hosts = calls.map((call) => call.url.host);
  assert.equal(hosts[0], 'automation01.verisure.com');
  assert.ok(
    hosts.slice(1).every((host) => host === 'automation02.verisure.com'),
    hosts.join(),
  );
});

test('a rate-limit answer stops at once', async (t) => {
  fakeFetch(
    t,
    cloud({ '/auth/login': () => ({ status: 200, text: '{"errorCode":"AUT_00021"}' }) }),
  );
  await assert.rejects(client().login(), RateLimitError);
});

test('setAlarmMode sends the code and polls until the panel confirms', async (t) => {
  let polls = 0;
  const { calls } = fakeFetch(
    t,
    cloud({
      '/graphql': (call) => {
        if (call.body.operationName === 'armAway') {
          return { json: { data: { armStateArmAway: 'TX1' } } };
        }
        polls += 1;
        const result = polls < 3 ? null : 'OK';
        return {
          json: { data: { installation: { armStateChangePollResult: { result } } } },
        };
      },
    }),
  );
  const result = await client().setAlarmMode(INSTALLATION, MODES.ARMED_AWAY);
  assert.deepEqual(result, { mode: MODES.ARMED_AWAY });
  const arm = calls.find((call) => call.body?.operationName === 'armAway');
  assert.deepEqual(arm.body.variables, { giid: INSTALLATION.id, code: '1234', forceArm: false });
  const poll = calls.at(-1).body;
  assert.equal(poll.variables.transactionId, 'TX1');
  assert.equal(poll.variables.futureState, 'ARMED_AWAY');
});

test('a refused order is an ArmingRefusedError that may be forced', async (t) => {
  fakeFetch(
    t,
    cloud({
      '/graphql': (call) =>
        call.body.operationName === 'armHome'
          ? { json: { data: { armStateArmHome: 'TX2' } } }
          : {
              json: {
                data: { installation: { armStateChangePollResult: { result: 'FAILED' } } },
              },
            },
    }),
  );
  await assert.rejects(client().setAlarmMode(INSTALLATION, MODES.ARMED_HOME), (err) => {
    assert.ok(err instanceof ArmingRefusedError);
    assert.equal(err.allowForcing, true);
    return true;
  });
});

test('arming without an alarm code fails before calling Verisure', async (t) => {
  const { calls } = fakeFetch(t, cloud());
  const verisure = createMyPagesClient({ username: 'a', password: 'b' });
  await assert.rejects(verisure.setAlarmMode(INSTALLATION, MODES.ARMED_AWAY), (err) => {
    assert.ok(err instanceof VerisureError);
    assert.equal(err.code, 'CODE_REQUIRED');
    return true;
  });
  assert.equal(calls.length, 0);
});

test('a mode the mypages panels do not have is refused', async () => {
  await assert.rejects(client().setAlarmMode(INSTALLATION, MODES.ARMED_NIGHT), /does not exist/);
  assert.deepEqual(client().supportedModes(), [MODES.DISARMED, MODES.ARMED_HOME, MODES.ARMED_AWAY]);
});

test('smart plugs and locks are driven by their device label', async (t) => {
  const { calls } = fakeFetch(
    t,
    cloud({
      '/graphql': (call) => {
        const name = call.body.operationName;
        if (name === 'UpdateState') {
          return { json: { data: { SmartPlugSetState: true } } };
        }
        if (name === 'DoorLock') {
          return { json: { data: { DoorLock: 'TX3' } } };
        }
        return {
          json: { data: { installation: { doorLockStateChangePollResult: { result: 'OK' } } } },
        };
      },
    }),
  );
  const verisure = client();
  await verisure.setSmartPlug(INSTALLATION, 'SP1', true);
  await verisure.setLock(INSTALLATION, 'LK1', true);
  const plug = calls.find((call) => call.body?.operationName === 'UpdateState');
  assert.deepEqual(plug.body.variables, { giid: INSTALLATION.id, deviceLabel: 'SP1', state: true });
  const lockCall = calls.find((call) => call.body?.operationName === 'DoorLock');
  assert.deepEqual(lockCall.body.variables.input, { code: '1234' });
});
