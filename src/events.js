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
//     verification code.
// Keys and data keys are stored in users' scenes: never rename them.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  ALARM_MODE_CHANGED: 'alarm_mode_changed',
  DOOR_WINDOW_CHANGED: 'door_window_changed',
  CONNECTION_LOST: 'connection_lost',
};

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
  return events;
}
