// -----------------------------------------------------------------------------
// Wiring: the SDK handlers on one side, the hub (src/hub.js) on the other.
//
// Kept out of index.js so the tests drive the whole integration against the
// fake Gladys of the SDK (test/app.test.js): index.js only creates the real
// client and connects.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ACTIONS } from './actions.js';
import { normalizeConfig } from './config.js';
import {
  buildDiscoveredDevices,
  buildStates,
  buildTransportEntries,
  findEntry,
} from './devices/index.js';
import { alarmIds } from './devices/alarm.js';
import { doorWindowIds } from './devices/doorWindow.js';
import { diffSnapshots, TRIGGERS } from './events.js';
import { createHub, STATUS, STATUS_MESSAGES } from './hub.js';
import { applyLogLevel } from './logging.js';
import { SCENE_ACTIONS } from './scenes.js';
import { createSessionStore } from './store.js';
import { WIDGETS, refreshWidgets } from './widgets.js';

const logger = createLogger({ name: 'app' });

// An unchanged value is re-sent every 30 minutes, so it stays recently dated in
// Gladys without spending the 300 states/minute of the host API.
const HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * Register every handler on `gladys` (before connect()).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ store?: object, createClient?: Function, clientOverrides?: object }} [options]
 */
export function createApp(gladys, options = {}) {
  const store = options.store ?? createSessionStore();
  let publishedSignature = null;

  // A Gladys call that fails (disconnected, refused) is logged, never fatal to
  // the refresh that triggered it.
  const safely = async (label, task) => {
    try {
      await task();
    } catch (err) {
      logger.error(`${label} failed: ${err.message}`);
    }
  };

  async function publishDevices(force = false) {
    const devices = buildDiscoveredDevices(gladys, hub);
    const signature = JSON.stringify(devices);
    // Re-published only when something changed (a new detector, a new
    // option): the list is the same at every refresh otherwise.
    if (force || signature !== publishedSignature) {
      await gladys.publishDiscoveredDevices(devices);
      publishedSignature = signature;
    }
  }

  async function publishStates() {
    const states = buildStates(gladys, hub);
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    }
  }

  async function publishTransports() {
    const entries = buildTransportEntries(gladys, hub);
    if (entries.length > 0) {
      await gladys.publishTransports(entries);
    }
  }

  async function reportStatus() {
    const ok = hub.status === STATUS.OK;
    await gladys.setConnectionStatus(ok, ok ? undefined : STATUS_MESSAGES[hub.status]);
  }

  // After an order: the new state now, and the widget re-pulled.
  async function afterChange() {
    await safely('publish states', publishStates);
    refreshWidgets(gladys);
  }

  const hub = createHub({
    store,
    createClient: options.createClient,
    clientOverrides: options.clientOverrides,
    async onUpdate() {
      await safely('publish devices', () => publishDevices());
      await safely('publish states', publishStates);
      await safely('publish transports', publishTransports);
      refreshWidgets(gladys);
    },
    async onEvents(installation, previous, next) {
      const ids = {
        alarmId: alarmIds(gladys, installation).device,
        doorWindowId: (itemId) => doorWindowIds(gladys, installation, itemId).device,
      };
      for (const event of diffSnapshots(ids, previous, next)) {
        logger.info(`Scene event ${event.key}`);
        await safely(`scene event ${event.key}`, () =>
          gladys.publishSceneEvent(event.key, event.data),
        );
      }
    },
    async onStatus(status, previous) {
      logger.info(`Verisure connection: ${previous} -> ${status}`);
      await safely('connection status', reportStatus);
      await safely('publish transports', publishTransports);
      if (previous === STATUS.OK && status !== STATUS.OK) {
        await safely('scene event connection_lost', () =>
          gladys.publishSceneEvent(TRIGGERS.CONNECTION_LOST, { reason: status }),
        );
      }
      refreshWidgets(gladys);
    },
  });

  // --- Discovery ---------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> reading Verisure');
    await hub.refreshNow({ forceInstallations: true });
    await publishDevices(true);
  });

  // --- Commands from the dashboard ---------------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    const entry = findEntry(gladys, hub, device.external_id);
    if (!entry || typeof entry.blueprint.setValue !== 'function') {
      throw new Error(`No command for ${device.external_id}`);
    }
    await entry.blueprint.setValue(gladys, {
      installation: entry.installation,
      item: entry.item,
      feature,
      value,
      hub,
    });
    refreshWidgets(gladys);
  });

  // --- Configuration screen buttons --------------------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(gladys, { fields, hub }));
  }

  // --- Scene actions -----------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(gladys, { fields, hub, onChange: afterChange }));
  }

  // --- Dashboard widgets -------------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, hub }));
    gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
      widget.action(gladys, { actionKey, params, settings, hub, onChange: afterChange }),
    );
  }

  // --- Configuration -----------------------------------------------------------
  async function applyConfig(raw) {
    const config = normalizeConfig(raw);
    applyLogLevel(config);
    const changed = hub.configure(config);
    if (changed) {
      publishedSignature = null;
    }
    // A read now: new credentials are tested at once, a new interval applies.
    await hub.start();
    await safely('connection status', reportStatus);
  }

  gladys.onConfigUpdated(async (raw) => {
    logger.info('onConfigUpdated -> new configuration');
    await applyConfig(raw);
  });

  // --- Connection lifecycle ----------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await applyConfig(await gladys.getConfig());
      // The nudges sent while Gladys was away were dropped.
      if (hub.status === STATUS.OK) {
        await safely('publish devices', () => publishDevices(true));
      }
      refreshWidgets(gladys);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        })
        .catch(() => {});
    }
  });

  // Nothing to publish while Gladys is away: the loop restarts on reconnection.
  gladys.on('disconnected', () => hub.stop());

  return { hub, stop: () => hub.stop() };
}
