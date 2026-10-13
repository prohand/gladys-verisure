// -----------------------------------------------------------------------------
// The Verisure session, kept across restarts in /data.
//
// What is kept is what spares the user a new SMS code at every restart of the
// container: the "trusted device" cookies of mypages, the refresh token and
// the device identifiers of OWA. The password itself is never written here
// (it lives in the Gladys configuration). The file is readable by the
// container user only.
//
// /data is the one writable path of the container: when it is missing (tests,
// a run outside Docker) the session simply lives in memory.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_DATA_DIR = process.env.VERISURE_DATA_DIR || '/data';
const FILE_NAME = 'verisure-session.json';

/**
 * @param {string | null} [dir] where to keep the file; null keeps it in memory
 */
export function createSessionStore(dir = DEFAULT_DATA_DIR) {
  const path = dir ? join(dir, FILE_NAME) : null;
  let memory = null;
  let warned = false;

  const warnOnce = (err) => {
    if (!warned) {
      warned = true;
      logger.warn(`Session kept in memory only (${err.code ?? err.message})`);
    }
  };

  return {
    /** @returns {Record<string, any>} the saved session, `{}` when none */
    load() {
      if (memory) {
        return memory;
      }
      if (!path) {
        return {};
      }
      try {
        memory = JSON.parse(readFileSync(path, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          warnOnce(err);
        }
        memory = {};
      }
      return memory;
    },

    /** @param {Record<string, any>} session */
    save(session) {
      memory = session;
      if (!path) {
        return;
      }
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
      } catch (err) {
        warnOnce(err);
      }
    },

    clear() {
      memory = {};
      if (path) {
        rmSync(path, { force: true });
      }
    },
  };
}
