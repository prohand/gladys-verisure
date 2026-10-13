import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, TRIGGERS } from '../src/events.js';
import { MODES } from '../src/verisure/modes.js';

const ids = { alarmId: 'ext:t:alarm:1', doorWindowId: (id) => `ext:t:door-window:1-${id}` };

const snapshot = (mode, doors = []) => ({
  alarm: { mode, changedBy: 'Alice' },
  doorWindows: doors.map(([id, open]) => ({ id, name: `Door ${id}`, open })),
});

test('the first snapshot fires nothing: there is no "before"', () => {
  assert.deepEqual(diffSnapshots(ids, undefined, snapshot(MODES.ARMED_AWAY)), []);
});

test('a mode change fires alarm_mode_changed with the old and new modes', () => {
  const events = diffSnapshots(ids, snapshot(MODES.DISARMED), snapshot(MODES.ARMED_AWAY));
  assert.deepEqual(events, [
    {
      key: TRIGGERS.ALARM_MODE_CHANGED,
      data: {
        device: ids.alarmId,
        mode: MODES.ARMED_AWAY,
        previous_mode: MODES.DISARMED,
        changed_by: 'Alice',
      },
    },
  ]);
});

test('the same mode, or an unknown one, fires nothing', () => {
  assert.deepEqual(diffSnapshots(ids, snapshot(MODES.DISARMED), snapshot(MODES.DISARMED)), []);
  assert.deepEqual(diffSnapshots(ids, snapshot('unknown'), snapshot(MODES.DISARMED)), []);
  assert.deepEqual(diffSnapshots(ids, snapshot(MODES.DISARMED), snapshot('unknown')), []);
});

test('a door that moves fires door_window_changed; a new detector does not', () => {
  const events = diffSnapshots(
    ids,
    snapshot(MODES.DISARMED, [['A', false]]),
    snapshot(MODES.DISARMED, [
      ['A', true],
      ['B', true],
    ]),
  );
  assert.deepEqual(events, [
    {
      key: TRIGGERS.DOOR_WINDOW_CHANGED,
      data: { device: ids.doorWindowId('A'), state: 'open', device_name: 'Door A' },
    },
  ]);
});

test('event data stays flat: primitives only', () => {
  const events = diffSnapshots(
    ids,
    snapshot(MODES.DISARMED, [['A', true]]),
    snapshot(MODES.ARMED_HOME, [['A', false]]),
  );
  for (const { data } of events) {
    for (const value of Object.values(data)) {
      assert.ok(value === null || typeof value !== 'object');
    }
  }
});
