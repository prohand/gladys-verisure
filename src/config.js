// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of
// `gladys-assistant-integration.json`. This module only provides the defaults
// and normalizes the received object, so the rest of the code never deals with
// `undefined`, numbers typed as strings or a country in lower case.
// -----------------------------------------------------------------------------

/** The two Verisure clouds: they share the brand, not the API. */
export const PLATFORMS = {
  // "My Verisure" app, formerly Securitas Direct: France, Spain, Italy,
  // Portugal, United Kingdom, Ireland and Latin America.
  OWA: 'owa',
  // "Verisure" app (mypages.verisure.com): Nordics, Benelux, Germany...
  MYPAGES: 'mypages',
};

/** Countries served by the OWA platform (the API host depends on it). */
export const OWA_COUNTRIES = ['FR', 'ES', 'IT', 'PT', 'GB', 'IE', 'AR', 'BR', 'CL', 'PE'];

// Defaults: they MUST stay equal to the `default` values of the manifest
// `config_schema` (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  platform: PLATFORMS.OWA,
  country: 'FR',
  username: '',
  password: '',
  alarm_code: '',
  // Seconds between two reads of the Verisure cloud. Verisure rate-limits its
  // API hard (a blocked account stays blocked for hours): two minutes is the
  // pace its own apps keep in the background.
  poll_interval: 120,
  debug_logs: false,
};

export const POLL_INTERVAL_MIN = 60;
export const POLL_INTERVAL_MAX = 3600;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const platform = Object.values(PLATFORMS).includes(raw.platform)
    ? raw.platform
    : DEFAULT_CONFIG.platform;
  const country = String(raw.country ?? DEFAULT_CONFIG.country)
    .trim()
    .toUpperCase();
  const interval = Number(raw.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    platform,
    country: OWA_COUNTRIES.includes(country) ? country : DEFAULT_CONFIG.country,
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    alarm_code: String(raw.alarm_code ?? '').trim(),
    poll_interval: Number.isFinite(interval)
      ? Math.min(POLL_INTERVAL_MAX, Math.max(POLL_INTERVAL_MIN, Math.round(interval)))
      : DEFAULT_CONFIG.poll_interval,
    debug_logs: raw.debug_logs === true,
  };
}

/** True when the user filled in what a login needs. */
export function hasCredentials(config) {
  return config.username !== '' && config.password !== '';
}
