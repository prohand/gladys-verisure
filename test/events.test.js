import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, newAlarmEvents, TRIGGERS } from '../src/events.js';
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

const entry = (id, kind = 'intrusion', time = `2026-11-16 21:0${id}:00`) => ({
  id: String(id),
  time,
  code: kind ? '13' : '2',
  kind,
  label: kind ? 'Alarme' : 'Armement',
  zone: 'Salon',
});
const withLog = (alarmEvents) => ({ ...snapshot(MODES.ARMED_AWAY), alarmEvents });

test('a new alarm in the event log fires alarm_triggered, mode unchanged', () => {
  const events = diffSnapshots(ids, withLog([entry(1, null)]), withLog([entry(2), entry(1, null)]));
  assert.deepEqual(events, [
    {
      key: TRIGGERS.ALARM_TRIGGERED,
      data: {
        device: ids.alarmId,
        kind: 'intrusion',
        zone: 'Salon',
        label: 'Alarme',
        time: '2026-11-16 21:02:00',
      },
    },
  ]);
});

test('entries that are not alarms, or already seen, fire nothing', () => {
  const before = withLog([entry(1)]);
  assert.deepEqual(diffSnapshots(ids, before, withLog([entry(2, null), entry(1)])), []);
  assert.deepEqual(diffSnapshots(ids, before, withLog([entry(1)])), []);
});

test('an event log not read (null) is no baseline: nothing fires', () => {
  assert.deepEqual(diffSnapshots(ids, withLog(null), withLog([entry(2), entry(1)])), []);
  assert.deepEqual(diffSnapshots(ids, withLog([entry(1)]), withLog(null)), []);
});

test('an empty event log is a baseline: the first alarm of the month fires', () => {
  const events = diffSnapshots(ids, withLog([]), withLog([entry(1)]));
  assert.equal(events.length, 1);
});

test('only the head of the log is new: a row sliding in at the tail is old news', () => {
  assert.deepEqual(
    newAlarmEvents([entry(3), entry(2)], [entry(4), entry(3), entry(1)]).map((e) => e.id),
    ['4'],
  );
});

test('several new alarms fire oldest first', () => {
  assert.deepEqual(
    newAlarmEvents([entry(1)], [entry(3), entry(2), entry(1)]).map((e) => e.id),
    ['2', '3'],
  );
});
