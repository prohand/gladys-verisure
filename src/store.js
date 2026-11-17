// -----------------------------------------------------------------------------
// The Verisure session, kept across restarts in /data.
//
// What is kept is what spares the user a new SMS code at every restart of the
// container: the "trusted device" cookies of mypages, the refresh token and
// the device identifiers of OWA. The password itself is never written here
// (it lives in the Gladys configuration). The file is readable by the
// container user only.
//
// /data is the one writable path of the container, but older Gladys versions
// created it owned by root, so the integration (user `node`) could not write
// to it (EACCES). Then a new OWA device id was drawn at every restart and
// Verisure asked for a new SMS code each time. In that case the session goes
// to a `backup`: a key of the Gladys configuration outside the config_schema
// (never shown in the UI, next to the password Gladys already keeps). The
// backup is used only while the file cannot be written, and emptied once it
// can again.
//
// Without a directory (tests, a run outside Docker) and without a backup, the
// session simply lives in memory.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_DATA_DIR = process.env.VERISURE_DATA_DIR || '/data';
const FILE_NAME = 'verisure-session.json';
// The Gladys configuration key of the backup. Users never type it, but it is
// stored: never rename it.
export const SESSION_BACKUP_KEY = 'session_backup';

function parse(text) {
  if (typeof text !== 'string' || text === '') {
    return null;
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {string | null} [dir] where to keep the file; null: no file
 * @param {{ backup?: { save: (text: string) => Promise<unknown> | unknown } }} [options]
 *   where to put the session when the file cannot be written
 */
export function createSessionStore(dir = DEFAULT_DATA_DIR, options = {}) {
  const path = dir ? join(dir, FILE_NAME) : null;
  const backup = options.backup ?? null;
  let memory = null;
  let backupText = ''; // what the backup holds, as last read or written
  let warned = false;

  const warnOnce = (err) => {
    if (!warned) {
      warned = true;
      const where = backup ? 'kept in the Gladys configuration' : 'kept in memory only';
      logger.warn(`Session file not writable (${err.code ?? err.message}): session ${where}`);
    }
  };

  function writeBackup(text) {
    if (!backup || text === backupText) {
      return;
    }
    backupText = text;
    // Fire and forget: save() is called from the Verisure clients, which must
    // not wait for Gladys. A failure is retried at the next save.
    Promise.resolve()
      .then(() => backup.save(text))
      .catch((err) => {
        backupText = null;
        logger.warn(`Cannot keep the session in the Gladys configuration: ${err.message}`);
      });
  }

  function writeFile(text) {
    if (!path) {
      return false;
    }
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, text, { mode: 0o600 });
      return true;
    } catch (err) {
      warnOnce(err);
      return false;
    }
  }

  return {
    /**
     * The value of the backup key read from the Gladys configuration, given
     * before the first load(). Used only when the file has no session.
     * @param {unknown} text
     */
    restore(text) {
      backupText = typeof text === 'string' ? text : '';
    },

    /** @returns {Record<string, any>} the saved session, `{}` when none */
    load() {
      if (memory) {
        return memory;
      }
      if (path) {
        try {
          memory = JSON.parse(readFileSync(path, 'utf8'));
        } catch (err) {
          if (err.code !== 'ENOENT') {
            warnOnce(err);
          }
        }
      }
      memory ??= parse(backupText) ?? {};
      return memory;
    },

    /** @param {Record<string, any>} session */
    save(session) {
      memory = session;
      const text = JSON.stringify(session);
      // The file holds it: a stale copy in Gladys would only be a secret more.
      writeBackup(writeFile(text) ? '' : text);
    },

    clear() {
      memory = {};
      writeBackup('');
      if (path) {
        try {
          rmSync(path, { force: true });
        } catch (err) {
          // Nothing could have been written there either.
          warnOnce(err);
        }
      }
    },
  };
}
