// -----------------------------------------------------------------------------
// Device type: SMART LOCK (mypages platform). Locking and unlocking need the
// alarm code of the configuration, like in the Verisure app.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { pick, platformId, runCommand } from './helpers.js';

const DEVICE_TYPE = 'lock';
const logger = createLogger({ name: DEVICE_TYPE });

// Gladys lock/binary: 1 = locked, 0 = unlocked.
const LOCKED = 1;
const UNLOCKED = 0;

export function lockIds(gladys, installation, itemId) {
  return gladys.externalIds(DEVICE_TYPE, platformId(installation.id, itemId));
}

export const lock = {
  key: DEVICE_TYPE,

  items(installation, snapshot) {
    return snapshot?.locks ?? [];
  },

  ids(gladys, installation, item) {
    return lockIds(gladys, installation, item.id);
  },

  build(gladys, installation, item, { config }) {
    const ids = lockIds(gladys, installation, item.id);
    return {
      name: item.name,
      external_id: ids.device,
      params: [{ name: 'installation', value: installation.id }],
      features: [
        {
          name: pick({ en: 'Lock', fr: 'Verrou' }, config),
          external_id: ids.feature('lock'),
          category: DEVICE_FEATURE_CATEGORIES.LOCK,
          type: DEVICE_FEATURE_TYPES.LOCK.BINARY,
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
        device_feature_external_id: lockIds(gladys, installation, item.id).feature('lock'),
        state: item.locked ? LOCKED : UNLOCKED,
      },
    ];
  },

  async setValue(gladys, { installation, item, feature, value, hub }) {
    const locked = Number(value) === LOCKED;
    logger.info(`${item.name}: ${locked ? 'lock' : 'unlock'}`);
    await runCommand(hub.setLock(installation.id, item.id, locked), {
      onDone: () => gladys.publishState(feature.external_id, locked ? LOCKED : UNLOCKED),
      onFailed: async (err) => {
        logger.warn(`${item.name}: ${locked ? 'lock' : 'unlock'} failed (${err.message})`);
        await gladys.publishState(feature.external_id, item.locked ? LOCKED : UNLOCKED);
      },
    });
  },
};
