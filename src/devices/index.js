// -----------------------------------------------------------------------------
// Device registry.
//
// Every device type lives in its own file and exposes the same shape:
//   - key                                   : short identifier (logs, tests)
//   - items(installation, snapshot)         : the Verisure objects of this type
//   - ids(gladys, installation, item)       : its external ids
//   - build(gladys, installation, item, ctx): the discovery payload
//   - states(gladys, installation, item, ctx): the states to publish
//   - setValue(gladys, {...})  (optional)   : run a user command
//
// The devices come from the hub's cache (src/hub.js): Verisure is read once per
// installation and refresh, never once per device.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { STATUS, STATUS_MESSAGES } from '../hub.js';
import { alarm } from './alarm.js';
import { climate } from './climate.js';
import { doorWindow } from './doorWindow.js';
import { lock } from './lock.js';
import { smartPlug } from './smartPlug.js';

export const DEVICE_BLUEPRINTS = [alarm, doorWindow, climate, smartPlug, lock];

/** Every (blueprint, installation, item) the hub currently knows. */
export function listEntries(hub) {
  const entries = [];
  for (const installation of hub.installations) {
    const snapshot = hub.snapshot(installation.id);
    if (!snapshot) {
      continue;
    }
    for (const blueprint of DEVICE_BLUEPRINTS) {
      for (const item of blueprint.items(installation, snapshot)) {
        entries.push({ blueprint, installation, item, snapshot });
      }
    }
  }
  return entries;
}

const contextOf = (hub, entry) => ({ hub, config: hub.config, snapshot: entry.snapshot });

/** The discovery payload: every device of every installation. */
export function buildDiscoveredDevices(gladys, hub) {
  return listEntries(hub).map((entry) =>
    entry.blueprint.build(gladys, entry.installation, entry.item, contextOf(hub, entry)),
  );
}

/** The states of every device, in the publishStates format. */
export function buildStates(gladys, hub) {
  return listEntries(hub).flatMap((entry) =>
    entry.blueprint.states(gladys, entry.installation, entry.item, contextOf(hub, entry)),
  );
}

/** The entry owning a device external_id, or undefined. */
export function findEntry(gladys, hub, deviceExternalId) {
  return listEntries(hub).find(
    (entry) =>
      entry.blueprint.ids(gladys, entry.installation, entry.item).device === deviceExternalId,
  );
}

/**
 * The installation an external id points at: the alarm device of a scene or
 * widget select, or any of its devices. Without one, the only installation of
 * the account (the common case), else undefined.
 */
export function resolveInstallation(gladys, hub, deviceExternalId) {
  if (deviceExternalId) {
    return findEntry(gladys, hub, deviceExternalId)?.installation;
  }
  return hub.installations.length === 1 ? hub.installations[0] : undefined;
}

/**
 * The cloud badge of every device: `cloud` while Verisure answers (with the
 * degraded dot when it throttles us: the values shown are getting old),
 * `unreachable` otherwise.
 */
export function buildTransportEntries(gladys, hub) {
  const status = hub.status;
  return listEntries(hub).map((entry) => {
    const external_id = entry.blueprint.ids(gladys, entry.installation, entry.item).device;
    if (status === STATUS.OK) {
      return { external_id, transport: DEVICE_TRANSPORTS.CLOUD };
    }
    if (status === STATUS.RATE_LIMITED) {
      return {
        external_id,
        transport: DEVICE_TRANSPORTS.CLOUD,
        degraded: true,
        message: STATUS_MESSAGES[STATUS.RATE_LIMITED],
      };
    }
    return { external_id, transport: DEVICE_TRANSPORTS.UNREACHABLE };
  });
}
