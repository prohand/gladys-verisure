// -----------------------------------------------------------------------------
// Alarm modes, as the integration speaks them.
//
// Both Verisure clouds have their own words (`ARMED_HOME` on one side, the
// panel letter `P` or the order `ARMDAY1` on the other). Gladys sees one
// vocabulary: these keys are the values of the alarm `mode` feature, of the
// scene trigger and action fields and of the widget. Users store them in their
// scenes: a published key is never renamed.
// -----------------------------------------------------------------------------

import { localize } from '../i18n.js';

export const MODES = {
  DISARMED: 'disarmed',
  // Partial, day: the perimeter of the living areas ("Partiel" in the app).
  ARMED_HOME: 'armed_home',
  // Partial, night (OWA panels only).
  ARMED_NIGHT: 'armed_night',
  // Total.
  ARMED_AWAY: 'armed_away',
  // Outdoor perimeter only, and the perimeter added to an indoor mode (OWA
  // panels with perimeter detectors only).
  PERIMETER: 'perimeter',
  ARMED_HOME_PERIMETER: 'armed_home_perimeter',
  ARMED_NIGHT_PERIMETER: 'armed_night_perimeter',
  ARMED_AWAY_PERIMETER: 'armed_away_perimeter',
};

/** Read when the cloud answers a state the integration does not know. */
export const UNKNOWN_MODE = 'unknown';

/** Display order, also the order of the select options. */
export const MODE_ORDER = [
  MODES.DISARMED,
  MODES.ARMED_HOME,
  MODES.ARMED_NIGHT,
  MODES.ARMED_AWAY,
  MODES.PERIMETER,
  MODES.ARMED_HOME_PERIMETER,
  MODES.ARMED_NIGHT_PERIMETER,
  MODES.ARMED_AWAY_PERIMETER,
];

export const MODE_LABELS = {
  [MODES.DISARMED]: { en: 'Disarmed', fr: 'Désarmée', de: 'Unscharf', es: 'Desconectada' },
  [MODES.ARMED_HOME]: {
    en: 'Partial (day)',
    fr: 'Partielle (jour)',
    de: 'Teilscharf (Tag)',
    es: 'Parcial (día)',
  },
  [MODES.ARMED_NIGHT]: {
    en: 'Partial (night)',
    fr: 'Partielle (nuit)',
    de: 'Teilscharf (Nacht)',
    es: 'Parcial (noche)',
  },
  [MODES.ARMED_AWAY]: { en: 'Total', fr: 'Totale', de: 'Vollscharf', es: 'Total' },
  [MODES.PERIMETER]: {
    en: 'Perimeter only',
    fr: 'Périmétrique seule',
    de: 'Nur Perimeter',
    es: 'Solo perimetral',
  },
  [MODES.ARMED_HOME_PERIMETER]: {
    en: 'Partial (day) + perimeter',
    fr: 'Partielle (jour) + périm.',
    de: 'Teilscharf (Tag) + Perimeter',
    es: 'Parcial (día) + perimetral',
  },
  [MODES.ARMED_NIGHT_PERIMETER]: {
    en: 'Partial (night) + perimeter',
    fr: 'Partielle (nuit) + périm.',
    de: 'Teilscharf (Nacht) + Perimeter',
    es: 'Parcial (noche) + perimetral',
  },
  [MODES.ARMED_AWAY_PERIMETER]: {
    en: 'Total + perimeter',
    fr: 'Totale + périmétrique',
    de: 'Vollscharf + Perimeter',
    es: 'Total + perimetral',
  },
  [UNKNOWN_MODE]: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

/**
 * Label of a mode in one language (English as the fallback).
 * @param {string} mode
 * @param {string} [language]
 */
export function modeLabel(mode, language = 'en') {
  return localize(MODE_LABELS[mode] ?? MODE_LABELS[UNKNOWN_MODE], language);
}

export function isKnownMode(mode) {
  return MODE_ORDER.includes(mode);
}

export function isArmed(mode) {
  return isKnownMode(mode) && mode !== MODES.DISARMED;
}
