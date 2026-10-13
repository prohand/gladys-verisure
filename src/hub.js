// -----------------------------------------------------------------------------
// The hub: one Verisure session, the last known state of every installation,
// and the refresh loop.
//
// Why a hub and not one call per device poll: Verisure answers a whole
// installation in one request, and rate-limits hard (the OWA firewall blocks a
// chatty client for hours). So the integration reads each installation once
// per `poll_interval`, keeps the answer here, and everything else (devices,
// widget, scene actions) reads this cache. Every call to Verisure goes through
// one queue: never two at once.
//
// The hub knows nothing about Gladys payloads: it notifies `onUpdate` after
// each read, `onEvents` with the scene events, and `onStatus` when the
// connection status changes. index.js turns that into Gladys calls.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hasCredentials } from './config.js';
import {
  AuthenticationError,
  MfaRequiredError,
  RateLimitError,
  VerisureError,
  needsUser,
} from './verisure/errors.js';
import { accountKey, createVerisureClient } from './verisure/index.js';

const logger = createLogger({ name: 'hub' });

// Installations rarely change: re-listed every 6 hours, or on a scan request.
const INSTALLATIONS_TTL_MS = 6 * 60 * 60 * 1000;
// Throttled by Verisure: wait a long while before knocking again.
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
// One failed read can be a hiccup; the connection is "lost" at the second.
const FAILURES_BEFORE_LOST = 2;

export const STATUS = {
  OK: 'ok',
  NOT_CONFIGURED: 'not_configured',
  MFA_REQUIRED: 'mfa_required',
  AUTH_FAILED: 'auth_failed',
  RATE_LIMITED: 'rate_limited',
  UNREACHABLE: 'unreachable',
};

export const STATUS_MESSAGES = {
  [STATUS.NOT_CONFIGURED]: {
    en: 'Enter your Verisure username and password.',
    fr: 'Renseignez votre identifiant et votre mot de passe Verisure.',
    de: 'Gib deinen Verisure-Benutzernamen und dein Passwort ein.',
    es: 'Introduzca su usuario y su contraseña de Verisure.',
  },
  [STATUS.MFA_REQUIRED]: {
    en: 'Verisure asks for a verification code: click "Send a code", then "Validate the code".',
    fr: 'Verisure demande un code de vérification : cliquez sur « Envoyer un code », puis « Valider le code ».',
    de: 'Verisure verlangt einen Bestätigungscode: Klicke auf „Code senden“ und dann auf „Code bestätigen“.',
    es: 'Verisure pide un código de verificación: pulse «Enviar un código» y después «Validar el código».',
  },
  [STATUS.AUTH_FAILED]: {
    en: 'Verisure refused the username or the password.',
    fr: "Verisure a refusé l'identifiant ou le mot de passe.",
    de: 'Verisure hat den Benutzernamen oder das Passwort abgelehnt.',
    es: 'Verisure ha rechazado el usuario o la contraseña.',
  },
  [STATUS.RATE_LIMITED]: {
    en: 'Verisure limits the requests for now: the integration waits before trying again.',
    fr: "Verisure limite les requêtes pour l'instant : l'intégration patiente avant de réessayer.",
    de: 'Verisure begrenzt die Anfragen derzeit: Die Integration wartet, bevor sie es erneut versucht.',
    es: 'Verisure limita las solicitudes por ahora: la integración espera antes de volver a intentarlo.',
  },
  [STATUS.UNREACHABLE]: {
    en: 'The Verisure cloud does not answer, see the integration logs.',
    fr: "Le cloud Verisure ne répond pas, consultez les logs de l'intégration.",
    de: 'Die Verisure-Cloud antwortet nicht, sieh in den Logs der Integration nach.',
    es: 'La nube de Verisure no responde, consulte los registros de la integración.',
  },
};

export function statusOf(error) {
  if (error instanceof MfaRequiredError) {
    return STATUS.MFA_REQUIRED;
  }
  if (error instanceof AuthenticationError) {
    return STATUS.AUTH_FAILED;
  }
  if (error instanceof RateLimitError) {
    return STATUS.RATE_LIMITED;
  }
  return STATUS.UNREACHABLE;
}

/**
 * @param {{ store: object, createClient?: typeof createVerisureClient,
 *   onUpdate?: () => Promise<void> | void,
 *   onEvents?: (installation: object, previous: object, next: object) => Promise<void> | void,
 *   onStatus?: (status: string, previous: string) => Promise<void> | void,
 *   clientOverrides?: object }} options
 */
export function createHub(options) {
  const createClient = options.createClient ?? createVerisureClient;
  let config = null;
  let client = null;
  let account = null;
  let installations = [];
  let installationsReadAt = 0;
  const snapshots = new Map();
  const modes = new Map();
  let status = STATUS.NOT_CONFIGURED;
  let lastError = null;
  let lastSuccessAt = null;
  let failures = 0;
  let timer = null;
  let running = false;
  let queue = Promise.resolve();

  // Every Verisure call, one after the other.
  function serialize(task) {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  }

  async function setStatus(next, error = null) {
    lastError = error;
    const previous = status;
    status = next;
    if (previous !== next) {
      await options.onStatus?.(next, previous);
    }
  }

  function requireClient() {
    if (!client) {
      throw new VerisureError('The integration is not configured yet', { code: 'NOT_CONFIGURED' });
    }
    return client;
  }

  async function readInstallations(force) {
    if (
      !force &&
      installations.length > 0 &&
      Date.now() - installationsReadAt < INSTALLATIONS_TTL_MS
    ) {
      return;
    }
    const list = await client.listInstallations();
    installations = list;
    installationsReadAt = Date.now();
    for (const id of snapshots.keys()) {
      if (!list.some((installation) => installation.id === id)) {
        snapshots.delete(id);
        modes.delete(id);
      }
    }
  }

  async function readAll(forceInstallations) {
    await readInstallations(forceInstallations);
    for (const installation of installations) {
      const next = await client.fetchState(installation);
      const previous = snapshots.get(installation.id);
      snapshots.set(installation.id, next);
      modes.set(installation.id, client.supportedModes(installation));
      await options.onEvents?.(installation, previous, next);
    }
  }

  /**
   * One read of every installation. Resolves the delay before the next one.
   * @param {{ forceInstallations?: boolean }} [opts]
   */
  async function refresh({ forceInstallations = false } = {}) {
    if (!client) {
      await setStatus(STATUS.NOT_CONFIGURED);
      return null;
    }
    try {
      await serialize(() => readAll(forceInstallations));
      failures = 0;
      lastSuccessAt = new Date().toISOString();
      await setStatus(STATUS.OK);
      await options.onUpdate?.();
      return config.poll_interval * 1000;
    } catch (err) {
      failures += 1;
      const next = statusOf(err);
      logger.warn(`Verisure read failed (${err.name}): ${err.message}`);
      // A hiccup keeps the previous status until it repeats; a refused login
      // or a blocked account is known at once.
      if (needsUser(err) || next === STATUS.RATE_LIMITED || failures >= FAILURES_BEFORE_LOST) {
        await setStatus(next, err);
      }
      if (needsUser(err)) {
        // Retrying the password on a loop would lock the account: wait for
        // the user (a new configuration or a validated code restarts the loop).
        return null;
      }
      return next === STATUS.RATE_LIMITED ? RATE_LIMIT_BACKOFF_MS : config.poll_interval * 1000;
    }
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = null;
    if (running && delay !== null) {
      timer = setTimeout(loop, delay);
      timer.unref?.();
    }
  }

  async function loop() {
    schedule(await refresh());
  }

  return {
    get status() {
      return status;
    },
    get lastError() {
      return lastError;
    },
    get lastSuccessAt() {
      return lastSuccessAt;
    },
    get installations() {
      return installations;
    },
    get config() {
      return config;
    },

    snapshot(installationId) {
      return snapshots.get(installationId);
    },

    supportedModes(installationId) {
      return modes.get(installationId) ?? [];
    },

    findInstallation(installationId) {
      return installations.find((installation) => installation.id === installationId);
    },

    /**
     * Apply a (new) configuration. Same account: the session is kept. Another
     * account, or credentials changed: a new client, the cache emptied.
     */
    configure(nextConfig) {
      const nextAccount = hasCredentials(nextConfig)
        ? `${accountKey(nextConfig)}:${nextConfig.password}:${nextConfig.alarm_code}`
        : null;
      config = nextConfig;
      if (nextAccount === account) {
        return false;
      }
      account = nextAccount;
      client = nextAccount
        ? createClient(nextConfig, options.store, options.clientOverrides)
        : null;
      installations = [];
      installationsReadAt = 0;
      snapshots.clear();
      modes.clear();
      failures = 0;
      return true;
    },

    /** Start (or restart) the loop: a read now, then every poll_interval. */
    async start() {
      running = true;
      await loop();
    },

    stop() {
      running = false;
      schedule(null);
    },

    async refreshNow(opts) {
      const delay = await refresh(opts);
      schedule(delay);
      return status;
    },

    /** Log in and list the installations, for the "Test" button. */
    async test() {
      const verisure = requireClient();
      return serialize(async () => {
        await verisure.login();
        await readInstallations(true);
        return installations;
      });
    },

    async requestCode() {
      const verisure = requireClient();
      return serialize(() => verisure.requestCode());
    },

    async validateCode(code) {
      const verisure = requireClient();
      await serialize(() => verisure.validateCode(code));
      // Session open: read everything now and restart the loop.
      running = true;
      return this.refreshNow({ forceInstallations: true });
    },

    async forgetSession() {
      const current = client;
      try {
        if (current) {
          await serialize(() => current.logout());
        }
      } finally {
        options.store.clear();
        account = null;
        if (config) {
          this.configure(config);
        }
      }
    },

    async setAlarmMode(installationId, mode, { force = false } = {}) {
      const verisure = requireClient();
      const installation = this.findInstallation(installationId);
      if (!installation) {
        throw new VerisureError(`Unknown installation ${installationId}`);
      }
      const supported = this.supportedModes(installationId);
      if (supported.length > 0 && !supported.includes(mode)) {
        throw new VerisureError(`The ${mode} mode is not available on this alarm`, {
          code: 'UNSUPPORTED_MODE',
        });
      }
      const result = await serialize(() => verisure.setAlarmMode(installation, mode, { force }));
      // Known at once: the next read sees no transition, so no scene event
      // fires for an order Gladys gave itself.
      const snapshot = snapshots.get(installationId);
      if (snapshot) {
        snapshot.alarm = {
          ...snapshot.alarm,
          mode: result.mode,
          changedAt: new Date().toISOString(),
          changedBy: 'Gladys',
          changedVia: 'gladys',
        };
      }
      return result;
    },

    async checkAlarm(installationId) {
      const verisure = requireClient();
      const installation = this.findInstallation(installationId);
      if (!installation) {
        throw new VerisureError(`Unknown installation ${installationId}`);
      }
      const mode = await serialize(() => verisure.checkAlarm(installation));
      const snapshot = snapshots.get(installationId);
      if (snapshot) {
        const previous = structuredClone(snapshot);
        snapshot.alarm = { ...snapshot.alarm, mode };
        await options.onEvents?.(installation, previous, snapshot);
      }
      return mode;
    },

    async setSmartPlug(installationId, plugId, on) {
      const verisure = requireClient();
      const installation = this.findInstallation(installationId);
      await serialize(() => verisure.setSmartPlug(installation, plugId, on));
      const plug = snapshots.get(installationId)?.smartPlugs.find((item) => item.id === plugId);
      if (plug) {
        plug.on = Boolean(on);
      }
    },

    async setLock(installationId, lockId, locked) {
      const verisure = requireClient();
      const installation = this.findInstallation(installationId);
      await serialize(() => verisure.setLock(installation, lockId, locked));
      const lock = snapshots.get(installationId)?.locks.find((item) => item.id === lockId);
      if (lock) {
        lock.locked = Boolean(locked);
      }
    },
  };
}
