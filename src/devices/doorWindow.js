// -----------------------------------------------------------------------------
// Device type: DOOR / WINDOW DETECTOR (mypages platform).
//
// Gladys reads an opening sensor like a contact: 1 = closed (contact made),
// 0 = open. The scene trigger door_window_changed (src/events.js) says when one
// moved.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { pick, platformId } from './helpers.js';

const DEVICE_TYPE = 'door-window';

export const CLOSED = 1;
export const OPEN = 0;

export function doorWindowIds(gladys, installation, itemId) {
  return gladys.externalIds(DEVICE_TYPE, platformId(installation.id, itemId));
}

export const doorWindow = {
  key: DEVICE_TYPE,

  items(installation, snapshot) {
    return snapshot?.doorWindows ?? [];
  },

  ids(gladys, installation, item) {
    return doorWindowIds(gladys, installation, item.id);
  },

  build(gladys, installation, item, { config }) {
    const ids = doorWindowIds(gladys, installation, item.id);
    return {
      name: item.name,
      external_id: ids.device,
      params: [{ name: 'installation', value: installation.id }],
      features: [
        {
          name: pick({ en: 'Opening', fr: 'Ouverture' }, config),
          external_id: ids.feature('opening'),
          category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          read_only: true,
          has_feedback: false,
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
        device_feature_external_id: doorWindowIds(gladys, installation, item.id).feature('opening'),
        state: item.open ? OPEN : CLOSED,
      },
    ];
  },
};
