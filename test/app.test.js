// -----------------------------------------------------------------------------
// The whole integration, wired to the fake Gladys of the SDK and to a fake
// Verisure client: what Gladys receives, from the connection to the scenes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { TRIGGERS } from '../src/events.js';
import { VerisureError } from '../src/verisure/errors.js';
import { MODES } from '../src/verisure/modes.js';
import { createFakeClient, memoryStore } from './helpers/fakeClient.js';

const CONFIG = { username: 'jean@example.fr', password: 'pw', platform: 'owa', country: 'FR' };

async function start(t, { config = CONFIG, client = createFakeClient() } = {}) {
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, { store: memoryStore(), createClient: () => client });
  t.after(() => app.stop());
  await gladys.connect();
  return { gladys, app, client };
}

const alarmOf = (gladys) =>
  gladys.fake.discoveredDevices.find((device) => device.external_id.includes(':alarm:'));

test('on connection: devices, states, cloud badges and a connected status', async (t) => {
  const { gladys } = await start(t);
  assert.equal(gladys.fake.discoveredDevices.length, 5);
  const alarm = alarmOf(gladys);
  assert.equal(gladys.fake.lastState(alarm.features[0].external_id), MODES.DISARMED);
  assert.ok(gladys.fake.transports.length > 0);
  assert.ok(gladys.fake.transports.every((entry) => entry.transport === 'cloud'));
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('without credentials, the Configuration screen says what is missing', async (t) => {
  const { gladys, client } = await start(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /identifiant/);
  assert.deepEqual(client.calls, []);
});

test('choosing a mode on the dashboard arms the alarm', async (t) => {
  const { gladys, client } = await start(t);
  const alarm = alarmOf(gladys);
  const [feature] = alarm.features;
  const ack = await gladys.fake.setValue(alarm, feature, MODES.ARMED_AWAY);
  assert.deepEqual(ack, { success: true });
  assert.equal(client.state.alarm.mode, MODES.ARMED_AWAY);
  assert.equal(gladys.fake.lastState(feature.external_id), MODES.ARMED_AWAY);
});

test('a smart plug is switched from the dashboard', async (t) => {
  const { gladys, client } = await start(t);
  const plug = gladys.fake.discoveredDevices.find((d) => d.external_id.includes(':plug:'));
  const ack = await gladys.fake.setValue(plug, plug.features[0], 1);
  assert.deepEqual(ack, { success: true });
  assert.equal(client.state.smartPlugs[0].on, true);
});

test('a command on a read-only device is refused', async (t) => {
  const { gladys } = await start(t);
  const door = gladys.fake.discoveredDevices.find((d) => d.external_id.includes(':door-window:'));
  const ack = await gladys.fake.setValue(door, door.features[0], 1);
  assert.equal(ack.success, false);
});

test('a mode changed at the keypad fires alarm_mode_changed, a Gladys order does not', async (t) => {
  const { gladys, app, client } = await start(t);
  const alarm = alarmOf(gladys);
  await gladys.fake.setValue(alarm, alarm.features[0], MODES.ARMED_HOME);
  await app.hub.refreshNow();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'own order: no event');

  client.state.alarm = { mode: MODES.DISARMED, changedBy: 'Alice' };
  await app.hub.refreshNow();
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: TRIGGERS.ALARM_MODE_CHANGED,
      data: {
        device: alarm.external_id,
        mode: MODES.DISARMED,
        previous_mode: MODES.ARMED_HOME,
        changed_by: 'Alice',
      },
    },
  ]);
});

test('a lost connection fires connection_lost once and turns the badges off', async (t) => {
  const { gladys, app, client } = await start(t);
  client.state.fail = new VerisureError('down');
  await app.hub.refreshNow();
  await app.hub.refreshNow();
  await app.hub.refreshNow();
  const lost = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.CONNECTION_LOST);
  assert.deepEqual(lost, [{ key: TRIGGERS.CONNECTION_LOST, data: { reason: 'unreachable' } }]);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
});

test('the scene action answers its outputs to Gladys', async (t) => {
  const { gladys } = await start(t);
  const ack = await gladys.fake.sceneAction('set_alarm_mode', { mode: MODES.ARMED_AWAY });
  assert.deepEqual(ack, {
    success: true,
    data: { outputs: { success: true, mode: MODES.ARMED_AWAY, reason: '' } },
  });
});

test('the widget content and its buttons go through Gladys', async (t) => {
  const { gladys, client } = await start(t);
  const content = await gladys.fake.widgetGet('alarm', { language: 'fr' });
  assert.equal(content.success, true);
  const button = content.data.content.components.find((c) => c.type === 'button');
  const ack = await gladys.fake.widgetAction('alarm', button.action.key, button.action.params);
  assert.equal(ack.success, true);
  assert.notEqual(client.state.alarm.mode, MODES.DISARMED);
  assert.ok(gladys.fake.widgetRefreshes.includes('alarm'));
});

test('the code steps: test, send, validate', async (t) => {
  const client = createFakeClient({ mfa: true });
  const { gladys } = await start(t, { client });
  assert.match(gladys.fake.connectionStatus.message.fr, /code/);

  const tested = await gladys.fake.action('test_connection');
  assert.match(tested.data.message.fr, /Envoyer un code/);
  assert.match(tested.data.message.de, /Code senden/);
  assert.match(tested.data.message.es, /Enviar un código/);
  const sent = await gladys.fake.action('send_code');
  assert.match(sent.data.message.fr, /SMS \(\*+789\)/);
  assert.match(sent.data.message.de, /SMS gesendet \(\*+789\)/);
  const validated = await gladys.fake.action('validate_code', { code: '123 456' });
  assert.match(validated.data.message.fr, /Code accepté/);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(gladys.fake.discoveredDevices.length, 5);
});

test('a malformed code is refused before reaching Verisure', async (t) => {
  const { gladys, client } = await start(t);
  const ack = await gladys.fake.action('validate_code', { code: 'abc' });
  assert.equal(ack.success, false);
  assert.ok(!client.calls.some(([name]) => name === 'validateCode'));
});

test('test_connection lists the installations and their mode', async (t) => {
  const { gladys } = await start(t);
  const ack = await gladys.fake.action('test_connection');
  assert.equal(ack.data.message.fr, 'Connecté : Maison (Désarmée).');
  assert.equal(ack.data.message.de, 'Verbunden: Maison (Unscharf).');
  assert.equal(ack.data.message.es, 'Conectado: Maison (Desarmada).');
});

test('new credentials make a new client and a new read', async (t) => {
  const clients = [createFakeClient(), createFakeClient({ alarm: { mode: MODES.ARMED_AWAY } })];
  const gladys = createFakeGladys({ config: CONFIG });
  const app = createApp(gladys, { store: memoryStore(), createClient: () => clients.shift() });
  t.after(() => app.stop());
  await gladys.connect();
  await gladys.fake.configUpdated({ ...CONFIG, username: 'paul@example.fr' });
  const alarm = alarmOf(gladys);
  assert.equal(gladys.fake.lastState(alarm.features[0].external_id), MODES.ARMED_AWAY);
});

test('a scan request re-reads Verisure and re-publishes the devices', async (t) => {
  const { gladys, client } = await start(t);
  const before = client.calls.filter(([name]) => name === 'listInstallations').length;
  await gladys.fake.scanRequest();
  const after = client.calls.filter(([name]) => name === 'listInstallations').length;
  assert.equal(after, before + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 3);
});
