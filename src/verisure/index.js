// -----------------------------------------------------------------------------
// One entry point for both Verisure clouds.
//
// The two clients expose the same methods (login, requestCode, validateCode,
// listInstallations, supportedModes, fetchState, checkAlarm, setAlarmMode,
// setSmartPlug, setLock, logout) and the same state shape (see normalizeState
// in mypages.js), so nothing above this folder knows which cloud it talks to.
// -----------------------------------------------------------------------------

import { PLATFORMS } from '../config.js';
import { createMyPagesClient } from './mypages.js';
import { createOwaClient } from './owa.js';

/** Identifies the account a saved session belongs to. */
export function accountKey(config) {
  const region = config.platform === PLATFORMS.OWA ? `:${config.country}` : '';
  return `${config.platform}${region}:${config.username.toLowerCase()}`;
}

/**
 * @param {ReturnType<typeof normalizeConfig>} config
 * @param {ReturnType<typeof createSessionStore>} store
 * @param {object} [overrides] test hooks (poll delays)
 */
export function createVerisureClient(config, store, overrides = {}) {
  const account = accountKey(config);
  const saved = store.load();
  // A session saved for another account (or platform) is worthless here.
  const session = saved.account === account ? saved.session : undefined;
  const onSession = (next) => store.save({ account, session: next });
  const common = {
    username: config.username,
    password: config.password,
    session,
    onSession,
    ...overrides,
  };
  if (config.platform === PLATFORMS.MYPAGES) {
    return createMyPagesClient({ ...common, code: config.alarm_code });
  }
  return createOwaClient({ ...common, country: config.country });
}
