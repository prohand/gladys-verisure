// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`, Gladys 5.1+).
//
// State vs event: the alarm mode, a door that is open, a temperature are device
// features published with publishState. The triggers say "this just happened,
// with these details", once per transition, never once per refresh:
//   - alarm_mode_changed: the mode changed from outside Gladys (keypad, badge,
//     app, remote control). Gladys's own orders never fire it — a scene that
//     sets the mode when the mode changes would otherwise loop;
//   - door_window_changed: a door/window detector opened or closed;
//   - connection_lost: the Verisure cloud stopped answering, or wants a new
//     verification code;
//   - alarm_triggered: a new alarm entry (intrusion, fire, panic, water,
//     tampering) in the installation's event log. The alarm mode does not
//     change during a break-in, so it needs its own source: the log.
// Keys and data keys are stored in users' scenes: never rename them.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  ALARM_MODE_CHANGED: 'alarm_mode_changed',
  DOOR_WINDOW_CHANGED: 'door_window_changed',
  CONNECTION_LOST: 'connection_lost',
  ALARM_TRIGGERED: 'alarm_triggered',
};

/** The kinds of alarm_triggered (manifest field `kind`), stored in users' scenes. */
export const ALARM_KINDS = ['intrusion', 'fire', 'sos', 'water', 'tampering'];

/** Every trigger the code fires (checked against the manifest by the tests). */
export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

/**
 * Events between two snapshots of ONE installation. The first snapshot after a
 * start has no "before": it fires nothing.
 * @param {{ alarmId: string, doorWindowId: (id: string) => string }} ids
 *   external ids of the installation's devices
 * @param {object | undefined} previous
 * @param {object} next
 * @returns {{ key: string, data: Record<string, string | number | boolean | null> }[]}
 */
export function diffSnapshots(ids, previous, next) {
  if (!previous) {
    return [];
  }
  const events = [];
  const before = previous.alarm?.mode;
  const after = next.alarm?.mode;
  if (before && after && before !== after && after !== 'unknown' && before !== 'unknown') {
    events.push({
      key: TRIGGERS.ALARM_MODE_CHANGED,
      data: {
        device: ids.alarmId,
        mode: after,
        previous_mode: before,
        changed_by: next.alarm.changedBy ?? null,
      },
    });
  }
  const wasOpen = new Map((previous.doorWindows ?? []).map((item) => [item.id, item.open]));
  for (const item of next.doorWindows ?? []) {
    if (wasOpen.has(item.id) && wasOpen.get(item.id) !== item.open) {
      events.push({
        key: TRIGGERS.DOOR_WINDOW_CHANGED,
        data: {
          device: ids.doorWindowId(item.id),
          state: item.open ? 'open' : 'closed',
          device_name: item.name,
        },
      });
    }
  }
  for (const entry of newAlarmEvents(previous.alarmEvents, next.alarmEvents)) {
    if (!entry.kind) {
      continue;
    }
    events.push({
      key: TRIGGERS.ALARM_TRIGGERED,
      data: {
        device: ids.alarmId,
        kind: entry.kind,
        zone: entry.zone ?? null,
        label: entry.label ?? null,
        time: entry.time ?? null,
      },
    });
  }
  return events;
}

/**
 * The entries of the event log that arrived since the previous read: the head
 * of the list (newest first) down to the first entry already seen. An entry
 * that shows up at the tail (the window sliding, a row deleted upstream) is
 * old news and never fires. `null` is "not read": no baseline, nothing new.
 * @param {object[] | null | undefined} before
 * @param {object[] | null | undefined} after
 * @returns {object[]}
 */
export function newAlarmEvents(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) {
    return [];
  }
  const seen = new Set(before.map((entry) => entry.id));
  const fresh = [];
  for (const entry of after) {
    if (seen.has(entry.id)) {
      break;
    }
    fresh.push(entry);
  }
  // Oldest first: the scenes run in the order things happened.
  return fresh.reverse();
}
