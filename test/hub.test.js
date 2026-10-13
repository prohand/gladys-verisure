import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createHub, STATUS } from '../src/hub.js';
import { RateLimitError, VerisureError } from '../src/verisure/errors.js';
import { MODES } from '../src/verisure/modes.js';
import { createFakeClient, memoryStore } from './helpers/fakeClient.js';

const CONFIG = normalizeConfig({ username: 'jean@example.fr', password: 'pw' });

function setup(clientOverrides) {
  const client = createFakeClient(clientOverrides);
  const record = { updates: 0, events: [], statuses: [] };
  const hub = createHub({
    store: memoryStore(),
    createClient: () => client,
    onUpdate: () => {
      record.updates += 1;
    },
    onEvents: (installation, previous, next) => record.events.push({ previous, next }),
    onStatus: (status, previous) => record.statuses.push([previous, status]),
  });
  return { hub, client, record };
}

test('without credentials the hub reports not_configured and reads nothing', async () => {
  const { hub, client } = setup();
  hub.configure(normalizeConfig());
  await hub.start();
  hub.stop();
  assert.equal(hub.status, STATUS.NOT_CONFIGURED);
  assert.deepEqual(client.calls, []);
});

test('a read lists the installations, keeps their state and notifies', async () => {
  const { hub, record } = setup();
  hub.configure(CONFIG);
  await hub.start();
  hub.stop();
  assert.equal(hub.status, STATUS.OK);
  assert.deepEqual(record.statuses, [[STATUS.NOT_CONFIGURED, STATUS.OK]]);
  assert.equal(record.updates, 1);
  assert.equal(hub.installations.length, 1);
  assert.equal(hub.snapshot('12345').alarm.mode, MODES.DISARMED);
  assert.deepEqual(hub.supportedModes('12345'), [
    MODES.DISARMED,
    MODES.ARMED_HOME,
    MODES.ARMED_AWAY,
  ]);
  assert.ok(hub.lastSuccessAt);
});

test('the installations are listed once, not at every refresh', async () => {
  const { hub, client } = setup();
  hub.configure(CONFIG);
  await hub.refreshNow();
  await hub.refreshNow();
  hub.stop();
  assert.equal(client.calls.filter(([name]) => name === 'listInstallations').length, 1);
  assert.equal(client.calls.filter(([name]) => name === 'fetchState').length, 2);
});

test('a code required stops the loop until the user acts', async () => {
  const { hub, client } = setup({ mfa: true });
  hub.configure(CONFIG);
  await hub.start();
  assert.equal(hub.status, STATUS.MFA_REQUIRED);
  await hub.validateCode('123456');
  hub.stop();
  assert.deepEqual(client.calls.at(-3), ['validateCode', '123456']);
  assert.equal(hub.status, STATUS.OK);
});

test('one failed read is a hiccup, the second one loses the connection', async () => {
  const { hub, client, record } = setup();
  hub.configure(CONFIG);
  await hub.refreshNow();
  client.state.fail = new VerisureError('boom');
  await hub.refreshNow();
  assert.equal(hub.status, STATUS.OK);
  await hub.refreshNow();
  hub.stop();
  assert.equal(hub.status, STATUS.UNREACHABLE);
  assert.deepEqual(record.statuses.at(-1), [STATUS.OK, STATUS.UNREACHABLE]);
});

test('a rate limit is reported at once', async () => {
  const { hub, client } = setup();
  hub.configure(CONFIG);
  await hub.refreshNow();
  client.state.fail = new RateLimitError();
  await hub.refreshNow();
  hub.stop();
  assert.equal(hub.status, STATUS.RATE_LIMITED);
});

test('an order given by Gladys updates the cache, so the next read sees no transition', async () => {
  const { hub, record } = setup();
  hub.configure(CONFIG);
  await hub.refreshNow();
  await hub.setAlarmMode('12345', MODES.ARMED_AWAY);
  assert.equal(hub.snapshot('12345').alarm.mode, MODES.ARMED_AWAY);
  await hub.refreshNow();
  hub.stop();
  const last = record.events.at(-1);
  assert.equal(last.previous.alarm.mode, last.next.alarm.mode);
});

test('a mode the panel does not support is refused before calling Verisure', async () => {
  const { hub, client } = setup();
  hub.configure(CONFIG);
  await hub.refreshNow();
  hub.stop();
  await assert.rejects(hub.setAlarmMode('12345', MODES.ARMED_NIGHT), /not available/);
  assert.ok(!client.calls.some(([name]) => name === 'setAlarmMode'));
});

test('the same account keeps its client; another account gets a new one', () => {
  let created = 0;
  const hub = createHub({
    store: memoryStore(),
    createClient: () => {
      created += 1;
      return createFakeClient();
    },
  });
  assert.equal(hub.configure(CONFIG), true);
  assert.equal(hub.configure({ ...CONFIG, poll_interval: 600 }), false);
  assert.equal(hub.configure({ ...CONFIG, username: 'other@example.fr' }), true);
  assert.equal(created, 2);
});

test('Verisure is never called twice at once', async () => {
  const { hub, client } = setup();
  let running = 0;
  let overlap = false;
  const original = client.fetchState;
  client.fetchState = async (installation) => {
    running += 1;
    overlap ||= running > 1;
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return original(installation);
  };
  hub.configure(CONFIG);
  await Promise.all([hub.refreshNow(), hub.refreshNow(), hub.checkAlarm('12345').catch(() => {})]);
  hub.stop();
  assert.equal(overlap, false);
});
