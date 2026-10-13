// -----------------------------------------------------------------------------
// Device type: SMART PLUG (mypages platform) — an on/off relay driven through
// the Verisure cloud.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { pick, platformId } from './helpers.js';

const DEVICE_TYPE = 'plug';
const logger = createLogger({ name: DEVICE_TYPE });

export function smartPlugIds(gladys, installation, itemId) {
  return gladys.externalIds(DEVICE_TYPE, platformId(installation.id, itemId));
}

export const smartPlug = {
  key: DEVICE_TYPE,

  items(installation, snapshot) {
    return snapshot?.smartPlugs ?? [];
  },

  ids(gladys, installation, item) {
    return smartPlugIds(gladys, installation, item.id);
  },

  build(gladys, installation, item, { config }) {
    const ids = smartPlugIds(gladys, installation, item.id);
    return {
      name: item.name,
      external_id: ids.device,
      params: [{ name: 'installation', value: installation.id }],
      features: [
        {
          name: pick({ en: 'On/Off', fr: 'Marche/Arrêt' }, config),
          external_id: ids.feature('on-off'),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          min: 0,
          max: 1,
        },
      ],
    };
  },

  states(gladys, installation, item) {
    return [
      {
        device_feature_external_id: smartPlugIds(gladys, installation, item.id).feature('on-off'),
        state: item.on ? 1 : 0,
      },
    ];
  },

  async setValue(gladys, { installation, item, feature, value, hub }) {
    const on = Number(value) === 1;
    logger.info(`${item.name}: ${on ? 'on' : 'off'}`);
    await hub.setSmartPlug(installation.id, item.id, on);
    await gladys.publishState(feature.external_id, on ? 1 : 0);
  },
};
