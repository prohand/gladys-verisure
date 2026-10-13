// -----------------------------------------------------------------------------
// Shared pieces of the device blueprints.
// -----------------------------------------------------------------------------

import { PLATFORMS } from '../config.js';

/**
 * Platform id of a device inside an installation, for gladys.externalIds().
 * Verisure labels can hold spaces ("3KCR TP3W"): only letters, digits, `_` and
 * `-` are kept, so the external id stays a clean token. Deterministic: the
 * same detector always gives the same id, the history of the device with it.
 * @param {string} installationId
 * @param {string} [itemId]
 */
export function platformId(installationId, itemId) {
  const clean = (value) => String(value).replace(/[^A-Za-z0-9_-]+/g, '-');
  return itemId === undefined ? clean(installationId) : `${clean(installationId)}-${clean(itemId)}`;
}

/**
 * Language of the texts Gladys stores as plain strings (device names, select
 * option labels): French for French accounts, English otherwise.
 */
export function storedLanguage(config) {
  return config?.platform === PLATFORMS.OWA && config?.country === 'FR' ? 'fr' : 'en';
}

/** Pick a text of a `{ en, fr }` object in the stored language. */
export function pick(texts, config) {
  return texts[storedLanguage(config)] ?? texts.en;
}

// How long a dashboard command waits for Verisure before answering Gladys. The
// core awaits a command ack a few seconds only, an OWA panel takes up to a
// minute to confirm: past this delay the order goes on in the background.
export const COMMAND_WAIT_MS = 3000;
const STILL_RUNNING = Symbol('still running');

/**
 * Run a Verisure order for a dashboard command. Settled within `waitMs`: its
 * result (or its error) is the command's. Slower: the command is acked at
 * once, `onDone` publishes the confirmed state later, `onFailed` puts the
 * previous state back so the dashboard does not keep a value that never was.
 * @param {Promise<any>} order
 * @param {{ onDone: (result: any) => Promise<void>, onFailed: (err: Error) => Promise<void>,
 *   waitMs?: number }} handlers
 */
export async function runCommand(order, { onDone, onFailed, waitMs = COMMAND_WAIT_MS }) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, waitMs, STILL_RUNNING);
  });
  const outcome = await Promise.race([
    order.then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    timeout,
  ]);
  clearTimeout(timer);
  if (outcome === STILL_RUNNING) {
    order.then(onDone, onFailed).catch(() => {});
    return;
  }
  if (outcome.error) {
    throw outcome.error;
  }
  await onDone(outcome.value);
}
