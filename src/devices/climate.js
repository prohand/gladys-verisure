// -----------------------------------------------------------------------------
// Device type: CLIMATE SENSOR — temperature and humidity measured by the
// Verisure detectors (smoke detectors and climate sensors on mypages, the
// "Sentinel" comfort sensors on OWA).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { pick, platformId } from './helpers.js';

const DEVICE_TYPE = 'climate';

const FEATURE = { TEMPERATURE: 'temperature', HUMIDITY: 'humidity' };

export function climateIds(gladys, installation, itemId) {
  return gladys.externalIds(DEVICE_TYPE, platformId(installation.id, itemId));
}

export const climate = {
  key: DEVICE_TYPE,

  items(installation, snapshot) {
    return snapshot?.climates ?? [];
  },

  ids(gladys, installation, item) {
    return climateIds(gladys, installation, item.id);
  },

  build(gladys, installation, item, { config }) {
    const ids = climateIds(gladys, installation, item.id);
    const features = [
      {
        name: pick({ en: 'Temperature', fr: 'Température' }, config),
        external_id: ids.feature(FEATURE.TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: -40,
        max: 80,
      },
    ];
    // Some detectors measure the temperature only.
    if (item.humidity !== null && item.humidity !== undefined) {
      features.push({
        name: pick({ en: 'Humidity', fr: 'Humidité' }, config),
        external_id: ids.feature(FEATURE.HUMIDITY),
        category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 100,
      });
    }
    return {
      name: item.name,
      external_id: ids.device,
      params: [{ name: 'installation', value: installation.id }],
      features,
    };
  },

  states(gladys, installation, item) {
    const ids = climateIds(gladys, installation, item.id);
    const states = [];
    if (item.temperature !== null && item.temperature !== undefined) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.TEMPERATURE),
        state: item.temperature,
      });
    }
    if (item.humidity !== null && item.humidity !== undefined) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.HUMIDITY),
        state: Math.round(item.humidity),
      });
    }
    return states;
  },
};
