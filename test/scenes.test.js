import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { alarmIds } from '../src/devices/alarm.js';
import { createHub } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { VerisureError } from '../src/verisure/errors.js';
import { MODES } from '../src/verisure/modes.js';
import { createFakeClient, memoryStore } from './helpers/fakeClient.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declaredOutputs = (key) =>
  manifest.scene_actions.find((action) => action.key === key).outputs.map((output) => output.key);

async function setup(overrides) {
  const gladys = createFakeGladys();
  const client = createFakeClient(overrides);
  const hub = createHub({ store: memoryStore(), createClient: () => client });
  hub.configure(normalizeConfig({ username: 'u', password: 'p' }));
  await hub.refreshNow();
  hub.stop();
  return { gladys, hub, client };
}

const assertDeclared = (key, outputs) => {
  for (const name of Object.keys(outputs)) {
    assert.ok(declaredOutputs(key).includes(name), `output "${name}" is not declared`);
  }
};

test('set_alarm_mode arms the chosen alarm and returns the declared outputs', async () => {
  const { gladys, hub, client } = await setup();
  let changed = 0;
  const device = alarmIds(gladys, hub.installations[0]).device;
  const outputs = await SCENE_ACTIONS.set_alarm_mode(gladys, {
    fields: { device, mode: MODES.ARMED_AWAY, force: false },
    hub,
    onChange: () => {
      changed += 1;
    },
  });
  assert.deepEqual(outputs, { success: true, mode: MODES.ARMED_AWAY, reason: '' });
  assertDeclared('set_alarm_mode', outputs);
  assert.deepEqual(client.calls.at(-1), ['setAlarmMode', '12345', MODES.ARMED_AWAY, false]);
  assert.equal(changed, 1, 'the new state is published');
});

test('without a device, the only alarm of the account is used', async () => {
  const { gladys, hub } = await setup();
  const outputs = await SCENE_ACTIONS.set_alarm_mode(gladys, {
    fields: { mode: MODES.ARMED_HOME },
    hub,
  });
  assert.equal(outputs.mode, MODES.ARMED_HOME);
});

test('a refusal is an output the scene can test, not a failure', async () => {
  const { gladys, hub } = await setup({ refuseArming: true });
  const outputs = await SCENE_ACTIONS.set_alarm_mode(gladys, {
    fields: { mode: MODES.ARMED_AWAY },
    hub,
  });
  assert.equal(outputs.success, false);
  assert.equal(outputs.mode, MODES.DISARMED, 'the mode the alarm kept');
  assert.match(outputs.reason, /Entrée/);
});

test('force arms despite an open door', async () => {
  const { gladys, hub } = await setup({ refuseArming: true });
  const outputs = await SCENE_ACTIONS.set_alarm_mode(gladys, {
    fields: { mode: MODES.ARMED_AWAY, force: true },
    hub,
  });
  assert.equal(outputs.success, true);
});

test('a mode this panel does not have is a refusal too', async () => {
  const { gladys, hub } = await setup();
  const outputs = await SCENE_ACTIONS.set_alarm_mode(gladys, {
    fields: { mode: MODES.PERIMETER },
    hub,
  });
  assert.equal(outputs.success, false);
});

test('a cloud failure fails the action (the scene logs it and goes on)', async () => {
  const { gladys, hub, client } = await setup();
  client.setAlarmMode = async () => {
    throw new VerisureError('Cannot reach Verisure');
  };
  await assert.rejects(
    SCENE_ACTIONS.set_alarm_mode(gladys, { fields: { mode: MODES.ARMED_AWAY }, hub }),
    /Cannot reach/,
  );
});

test('an unknown device fails the action', async () => {
  const { gladys, hub } = await setup();
  await assert.rejects(
    SCENE_ACTIONS.set_alarm_mode(gladys, {
      fields: { device: 'ext:test-integration:alarm:nope', mode: MODES.ARMED_AWAY },
      hub,
    }),
    /Unknown Verisure alarm/,
  );
});

test('refresh_alarm asks the alarm and returns its mode', async () => {
  const { gladys, hub, client } = await setup({ alarm: { mode: MODES.ARMED_HOME } });
  const outputs = await SCENE_ACTIONS.refresh_alarm(gladys, { fields: {}, hub });
  assert.deepEqual(outputs, { mode: MODES.ARMED_HOME });
  assertDeclared('refresh_alarm', outputs);
  assert.ok(client.calls.some(([name]) => name === 'checkAlarm'));
});
