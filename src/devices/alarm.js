// -----------------------------------------------------------------------------
// Device type: ALARM (one per Verisure installation).
//
// The alarm mode is a `text`/`select` feature: its options are the modes THIS
// panel supports (a perimeter-less panel has no perimeter mode), declared per
// device in `supported_options`. The value is the mode key of
// src/verisure/modes.js, stored as a string. Choosing an option in Gladys sends
// the order; the state is published once Verisure confirmed it.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { isKnownMode, MODE_LABELS, MODE_ORDER } from '../verisure/modes.js';
import { pick, platformId, runCommand } from './helpers.js';

const DEVICE_TYPE = 'alarm';
const logger = createLogger({ name: DEVICE_TYPE });

export const ALARM_FEATURE = { MODE: 'mode' };

export function alarmIds(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, platformId(installation.id));
}

export const alarm = {
  key: DEVICE_TYPE,

  /** One alarm per installation, whatever the snapshot holds. */
  items(installation) {
    return [installation];
  },

  ids(gladys, installation) {
    return alarmIds(gladys, installation);
  },

  build(gladys, installation, _item, { hub, config }) {
    const ids = alarmIds(gladys, installation);
    const supported = hub.supportedModes(installation.id);
    const modes = MODE_ORDER.filter((mode) => supported.includes(mode));
    return {
      name: `Verisure ${installation.name}`,
      external_id: ids.device,
      params: [{ name: 'installation', value: installation.id }],
      features: [
        {
          name: pick({ en: 'Alarm mode', fr: "Mode de l'alarme" }, config),
          external_id: ids.feature(ALARM_FEATURE.MODE),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
          read_only: false,
          has_feedback: true,
          // A string state has no history in Gladys.
          keep_history: false,
          min: 0,
          max: 0,
          supported_options: modes.map((mode, index) => ({
            value: mode,
            label: pick(MODE_LABELS[mode], config),
            sort_order: index,
          })),
        },
      ],
    };
  },

  states(gladys, installation, _item, { snapshot }) {
    const mode = snapshot?.alarm?.mode;
    if (!isKnownMode(mode)) {
      return [];
    }
    return [
      {
        device_feature_external_id: alarmIds(gladys, installation).feature(ALARM_FEATURE.MODE),
        text: mode,
      },
    ];
  },

  async setValue(gladys, { installation, feature, value, hub }) {
    const mode = String(value);
    if (!isKnownMode(mode)) {
      throw new Error(`Unknown alarm mode: ${mode}`);
    }
    logger.info(`${installation.name}: mode -> ${mode}`);
    await runCommand(hub.setAlarmMode(installation.id, mode), {
      onDone: (result) => gladys.publishState(feature.external_id, { text: result.mode }),
      onFailed: async (err) => {
        logger.warn(`${installation.name}: ${mode} refused (${err.message})`);
        const current = hub.snapshot(installation.id)?.alarm?.mode;
        if (isKnownMode(current)) {
          await gladys.publishState(feature.external_id, { text: current });
        }
      },
    });
  },
};
