import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import {
  buildDiscoveredDevices,
  buildStates,
  buildTransportEntries,
  DEVICE_BLUEPRINTS,
  findEntry,
  resolveInstallation,
} from '../src/devices/index.js';
import { platformId, runCommand } from '../src/devices/helpers.js';
import { CLOSED, OPEN } from '../src/devices/doorWindow.js';
import { createHub, STATUS } from '../src/hub.js';
import { RateLimitError } from '../src/verisure/errors.js';
import { MODES } from '../src/verisure/modes.js';
import { createFakeClient, memoryStore } from './helpers/fakeClient.js';

async function loadedHub(overrides, config = {}) {
  const client = createFakeClient(overrides);
  const hub = createHub({ store: memoryStore(), createClient: () => client });
  hub.configure(normalizeConfig({ username: 'u', password: 'p', ...config }));
  await hub.refreshNow();
  hub.stop();
  return { hub, client };
}

test('every blueprint exposes the required shape', () => {
  for (const blueprint of DEVICE_BLUEPRINTS) {
    for (const method of ['items', 'ids', 'build', 'states']) {
      assert.equal(typeof blueprint[method], 'function', `${blueprint.key}.${method}`);
    }
  }
});

test('one device per Verisure object, and Gladys accepts the list', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub();
  const devices = buildDiscoveredDevices(gladys, hub);
  // alarm + door + climate + plug + lock
  assert.equal(devices.length, 5);
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 5);
  const ids = devices.map((device) => device.external_id);
  assert.equal(new Set(ids).size, ids.length, 'external ids are unique');
});

test('every feature declares its bounds (NOT NULL in Gladys)', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub();
  for (const device of buildDiscoveredDevices(gladys, hub)) {
    for (const feature of device.features) {
      assert.equal(typeof feature.min, 'number', `${feature.external_id}.min`);
      assert.equal(typeof feature.max, 'number', `${feature.external_id}.max`);
    }
  }
});

test('the alarm offers the modes of its panel, labelled in the account language', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub();
  const [alarm] = buildDiscoveredDevices(gladys, hub);
  const [mode] = alarm.features;
  assert.equal(mode.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(mode.type, 'select');
  assert.deepEqual(
    mode.supported_options.map((option) => [option.value, option.label]),
    [
      [MODES.DISARMED, 'Désarmée'],
      [MODES.ARMED_HOME, 'Partielle (jour)'],
      [MODES.ARMED_AWAY, 'Totale'],
    ],
  );

  const english = await loadedHub({}, { platform: 'mypages' });
  const [englishAlarm] = buildDiscoveredDevices(gladys, english.hub);
  assert.equal(englishAlarm.features[0].supported_options[0].label, 'Disarmed');
});

test('a label with spaces gives a clean, stable external id', () => {
  assert.equal(platformId('123', '3KCR TP3W'), '123-3KCR-TP3W');
  assert.equal(platformId('123'), '123');
});

test('the states follow the snapshot, and Gladys accepts them', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub({
    doorWindows: [
      { id: 'A', name: 'Door', open: true },
      { id: 'B', name: 'Window', open: false },
    ],
  });
  const states = buildStates(gladys, hub);
  await gladys.publishStates(states);
  const alarm = states.find((state) => state.text !== undefined);
  assert.equal(alarm.text, MODES.DISARMED);
  const doors = states.filter((state) => state.device_feature_external_id.includes('door-window'));
  assert.deepEqual(
    doors.map((state) => state.state),
    [OPEN, CLOSED],
  );
});

test('a climate sensor without humidity only measures the temperature', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub({
    climates: [{ id: 'C', name: 'Garage', temperature: 12, humidity: null }],
  });
  const climate = buildDiscoveredDevices(gladys, hub).find((d) =>
    d.external_id.includes('climate'),
  );
  assert.deepEqual(
    climate.features.map((feature) => feature.category),
    [DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR],
  );
});

test('findEntry and resolveInstallation route an external id to its installation', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub();
  for (const device of buildDiscoveredDevices(gladys, hub)) {
    const entry = findEntry(gladys, hub, device.external_id);
    assert.ok(entry, device.external_id);
    assert.equal(resolveInstallation(gladys, hub, device.external_id).id, '12345');
  }
  assert.equal(findEntry(gladys, hub, 'ext:test-integration:nothing'), undefined);
  assert.equal(resolveInstallation(gladys, hub, undefined).id, '12345', 'the only one');
});

test('several installations: an empty choice resolves to none', async () => {
  const gladys = createFakeGladys();
  const { hub } = await loadedHub({
    installations: [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ],
  });
  assert.equal(resolveInstallation(gladys, hub, undefined), undefined);
});

test('the transport badge is cloud, degraded when throttled, unreachable otherwise', async () => {
  const gladys = createFakeGladys();
  const { hub, client } = await loadedHub();
  assert.ok(
    buildTransportEntries(gladys, hub).every(
      (entry) => entry.transport === DEVICE_TRANSPORTS.CLOUD && !entry.degraded,
    ),
  );
  client.state.fail = new RateLimitError();
  await hub.refreshNow();
  hub.stop();
  assert.equal(hub.status, STATUS.RATE_LIMITED);
  const throttled = buildTransportEntries(gladys, hub);
  assert.ok(throttled.every((entry) => entry.degraded === true && entry.message.en));
  await gladys.publishTransports(throttled);
});

test('a fast order answers the command with its own result or error', async () => {
  const done = [];
  await runCommand(Promise.resolve('ok'), {
    onDone: async (value) => done.push(value),
    onFailed: async () => done.push('failed'),
  });
  assert.deepEqual(done, ['ok']);
  await assert.rejects(
    runCommand(Promise.reject(new Error('open door')), {
      onDone: async () => {},
      onFailed: async () => {},
    }),
    /open door/,
  );
});

test('a slow order is acked at once, then confirmed or rolled back', async () => {
  const done = [];
  let finish;
  const slow = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  await runCommand(slow, {
    onDone: async (value) => done.push(value),
    onFailed: async (err) => done.push(`rolled back: ${err.message}`),
    waitMs: 5,
  });
  assert.deepEqual(done, [], 'acked before Verisure confirmed');
  finish.reject(new Error('refused'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(done, ['rolled back: refused']);
});
