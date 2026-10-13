// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Each handler receives the RESOLVED `fields` (scene variables substituted,
// defaults applied, validated by the core) and resolves the declared scalar
// `outputs`. The rules that shape them:
//   - a scene action is never a condition: an alarm that refuses to arm (a
//     window left open) is an OUTPUT (`success: false` + `reason`), the scene
//     author gates the next actions on it. Throwing is kept for what the scene
//     cannot work around (cloud unreachable, alarm not found);
//   - an order given here never fires a scene trigger (see src/events.js):
//     a scene bound to the trigger would loop through the integration.
// Keys are stored in users' scenes: never rename them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { resolveInstallation } from './devices/index.js';
import { ArmingRefusedError } from './verisure/errors.js';
import { isKnownMode, UNKNOWN_MODE } from './verisure/modes.js';

const logger = createLogger({ name: 'scenes' });

function installationOf(gladys, hub, deviceExternalId) {
  const installation = resolveInstallation(gladys, hub, deviceExternalId);
  if (!installation) {
    throw new Error(
      deviceExternalId
        ? `Unknown Verisure alarm ${deviceExternalId}`
        : 'Several Verisure alarms: choose one in the action',
    );
  }
  return installation;
}

export const SCENE_ACTIONS = {
  // Ack awaited under the action's timeout_seconds (120 s in the manifest): an
  // OWA panel takes up to a minute to confirm.
  async set_alarm_mode(gladys, { fields, hub, onChange }) {
    const installation = installationOf(gladys, hub, fields.device);
    const mode = String(fields.mode ?? '');
    if (!isKnownMode(mode)) {
      throw new Error(`Unknown alarm mode: ${mode}`);
    }
    logger.info(`Scene action set_alarm_mode <- ${installation.name}: ${mode}`);
    const current = () => hub.snapshot(installation.id)?.alarm?.mode ?? UNKNOWN_MODE;
    try {
      const result = await hub.setAlarmMode(installation.id, mode, {
        force: fields.force === true,
      });
      await onChange?.();
      return { success: true, mode: result.mode, reason: '' };
    } catch (err) {
      if (err instanceof ArmingRefusedError || err.code === 'UNSUPPORTED_MODE') {
        return { success: false, mode: current(), reason: err.message };
      }
      throw err;
    }
  },

  // Ask the panel itself (OWA wakes it up, mypages reads the cloud), for a
  // scene that must act on the real state rather than the last refresh.
  async refresh_alarm(gladys, { fields, hub, onChange }) {
    const installation = installationOf(gladys, hub, fields.device);
    logger.info(`Scene action refresh_alarm <- ${installation.name}`);
    const mode = await hub.checkAlarm(installation.id);
    await onChange?.();
    return { mode };
  },
};
