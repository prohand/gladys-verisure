import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { buildDiscoveredDevices } from '../src/devices/index.js';
import { createHub } from '../src/hub.js';
import { MODES } from '../src/verisure/modes.js';
import { actionKeyOf, ago, ALARM_WIDGET, WIDGETS } from '../src/widgets.js';
import { createFakeClient, memoryStore } from './helpers/fakeClient.js';

const widget = WIDGETS[ALARM_WIDGET];

async function setup(overrides) {
  const gladys = createFakeGladys();
  const client = createFakeClient(overrides);
  const hub = createHub({ store: memoryStore(), createClient: () => client });
  hub.configure(normalizeConfig({ username: 'u', password: 'p' }));
  await hub.refreshNow();
  hub.stop();
  return { gladys, hub, client };
}

const buttonsOf = (content) => content.components.filter((c) => c.type === 'button');

test('the alarm content is rendered exactly as sent', async () => {
  const { gladys, hub } = await setup();
  const content = await widget.get(gladys, { settings: {}, language: 'fr', hub });
  assert.deepEqual(validateWidgetContent(content), []);
});

test('without data the widget explains why, still valid', async () => {
  const gladys = createFakeGladys();
  const hub = createHub({ store: memoryStore(), createClient: () => createFakeClient() });
  hub.configure(normalizeConfig());
  const content = await widget.get(gladys, { settings: {}, language: 'en', hub });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(buttonsOf(content).length, 0);
});

test('the Disarm button only shows when the widget instance allows it', async () => {
  const { gladys, hub } = await setup({ alarm: { mode: MODES.ARMED_AWAY } });
  const locked = await widget.get(gladys, { settings: {}, language: 'en', hub });
  assert.ok(!buttonsOf(locked).some((b) => b.action.key === actionKeyOf(MODES.DISARMED)));
  const open = await widget.get(gladys, { settings: { allow_disarm: true }, language: 'en', hub });
  assert.ok(buttonsOf(open).some((b) => b.action.key === actionKeyOf(MODES.DISARMED)));
  assert.deepEqual(validateWidgetContent(open), []);
});

test('every button asks for confirmation and names a supported mode', async () => {
  const { gladys, hub } = await setup();
  const content = await widget.get(gladys, { settings: { allow_disarm: true }, hub });
  for (const button of buttonsOf(content)) {
    assert.equal(button.action.confirm, true);
    const mode = button.action.key.replace('mode_', '');
    assert.ok(hub.supportedModes('12345').includes(mode));
    assert.notEqual(mode, MODES.DISARMED, 'no button for the current mode');
  }
});

test('the live tile is bound to a published temperature feature', async () => {
  const { gladys, hub } = await setup();
  const features = new Set(
    buildDiscoveredDevices(gladys, hub).flatMap((d) => d.features.map((f) => f.external_id)),
  );
  const content = await widget.get(gladys, { settings: {}, hub });
  const tiles = content.components.filter((c) => c.device_feature);
  assert.equal(tiles.length, 1);
  assert.ok(features.has(tiles[0].device_feature));
});

test('a button arms the alarm and answers a short toast', async () => {
  const { gladys, hub, client } = await setup();
  let changed = 0;
  const toast = await widget.action(gladys, {
    actionKey: actionKeyOf(MODES.ARMED_AWAY),
    params: { installation: '12345' },
    settings: {},
    hub,
    onChange: () => {
      changed += 1;
    },
  });
  assert.equal(client.state.alarm.mode, MODES.ARMED_AWAY);
  assert.equal(changed, 1);
  assert.ok(toast.en.length <= 200 && toast.fr.length <= 200);
});

test('disarming is refused when the instance does not allow it', async () => {
  const { gladys, hub, client } = await setup({ alarm: { mode: MODES.ARMED_AWAY } });
  await assert.rejects(
    widget.action(gladys, {
      actionKey: actionKeyOf(MODES.DISARMED),
      params: { installation: '12345' },
      settings: { allow_disarm: false },
      hub,
    }),
    /not allowed/,
  );
  assert.equal(client.state.alarm.mode, MODES.ARMED_AWAY);
});

test('an open door is a toast, not an error', async () => {
  const { gladys, hub } = await setup({ refuseArming: true });
  const toast = await widget.action(gladys, {
    actionKey: actionKeyOf(MODES.ARMED_AWAY),
    params: { installation: '12345' },
    settings: {},
    hub,
  });
  assert.match(toast.fr, /Entrée/);
});

test('an unknown action fails', async () => {
  const { gladys, hub } = await setup();
  await assert.rejects(
    widget.action(gladys, { actionKey: 'nope', params: {}, settings: {}, hub }),
    /Unknown widget action/,
  );
});

test('ago() says how long ago, in the viewer language', () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  assert.equal(ago('2026-10-13T09:55:00Z', 'en', now), '5 minutes ago');
  assert.equal(ago('2026-10-13T07:00:00Z', 'fr', now), 'il y a 3 heures');
  assert.equal(ago(null, 'fr', now), '—');
});
