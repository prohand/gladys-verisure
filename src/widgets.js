// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// `alarm`: the mode of a Verisure alarm, who changed it and when, the open
// doors/windows, the cloud connection, and buttons to arm it. The content is
// declarative (the core renders it with its theme and translations).
//
// Security: a dashboard can hang on a wall where anyone can tap it, and the
// acting user of a widget button is anonymous. So arming is offered, but the
// Disarm button only shows when the widget instance enables it (setting
// `allow_disarm`, off by default), and the handler checks that setting again:
// `params` come from the content, `settings` from the instance.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { climateIds } from './devices/climate.js';
import { resolveInstallation } from './devices/index.js';
import { STATUS, STATUS_MESSAGES } from './hub.js';
import { ArmingRefusedError } from './verisure/errors.js';
import { supportedLanguage, textsOf } from './i18n.js';
import { MODE_LABELS, MODES, UNKNOWN_MODE, isKnownMode, modeLabel } from './verisure/modes.js';

const logger = createLogger({ name: 'widgets' });

export const ALARM_WIDGET = 'alarm';
// One action key per button (the core drops a button repeating a key): the key
// names the mode, so the handler never takes the mode from anywhere else.
const ACTION_PREFIX = 'mode_';
export const actionKeyOf = (mode) => `${ACTION_PREFIX}${mode}`;

const MODE_COLORS = {
  [MODES.DISARMED]: WIDGET_COLORS.SUCCESS,
  [MODES.ARMED_AWAY]: WIDGET_COLORS.DANGER,
  [MODES.ARMED_AWAY_PERIMETER]: WIDGET_COLORS.DANGER,
};

// The buttons, in the order they show (at most 4 per widget).
const BUTTONS = [
  {
    mode: MODES.ARMED_HOME,
    label: { en: 'Partial', fr: 'Partielle', de: 'Teilscharf', es: 'Parcial' },
    icon: 'shield',
    style: 'secondary',
  },
  {
    mode: MODES.ARMED_NIGHT,
    label: { en: 'Night', fr: 'Nuit', de: 'Nacht', es: 'Noche' },
    icon: 'moon',
    style: 'secondary',
  },
  {
    mode: MODES.ARMED_AWAY,
    label: { en: 'Total', fr: 'Totale', de: 'Vollscharf', es: 'Total' },
    icon: 'lock',
    style: 'primary',
  },
  {
    mode: MODES.DISARMED,
    label: { en: 'Disarm', fr: 'Désarmer', de: 'Unscharf schalten', es: 'Desarmar' },
    icon: 'unlock',
    style: 'danger',
  },
];

/** "5 min ago" in the viewer's language; the content TTL keeps it fresh. */
export function ago(isoDate, language = 'en', now = Date.now()) {
  const time = Date.parse(isoDate ?? '');
  if (Number.isNaN(time)) {
    return '—';
  }
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  const format = new Intl.RelativeTimeFormat(supportedLanguage(language), { numeric: 'auto' });
  if (minutes < 60) {
    return format.format(-minutes, 'minute');
  }
  if (minutes < 48 * 60) {
    return format.format(-Math.round(minutes / 60), 'hour');
  }
  return format.format(-Math.round(minutes / 1440), 'day');
}

const CLOUD_LABEL = {
  en: 'Verisure cloud',
  fr: 'Cloud Verisure',
  de: 'Verisure-Cloud',
  es: 'Nube Verisure',
};

function connectionRow(hub) {
  if (hub.status === STATUS.OK) {
    return {
      label: CLOUD_LABEL,
      icon: 'cloud',
      value: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  const short = {
    [STATUS.MFA_REQUIRED]: {
      en: 'Code required',
      fr: 'Code requis',
      de: 'Code erforderlich',
      es: 'Código requerido',
    },
    [STATUS.AUTH_FAILED]: {
      en: 'Login refused',
      fr: 'Connexion refusée',
      de: 'Anmeldung verweigert',
      es: 'Inicio de sesión rechazado',
    },
    [STATUS.RATE_LIMITED]: { en: 'Throttled', fr: 'Limité', de: 'Gedrosselt', es: 'Limitado' },
    [STATUS.UNREACHABLE]: {
      en: 'Unreachable',
      fr: 'Injoignable',
      de: 'Nicht erreichbar',
      es: 'Inaccesible',
    },
    [STATUS.NOT_CONFIGURED]: {
      en: 'Not configured',
      fr: 'Non configuré',
      de: 'Nicht konfiguriert',
      es: 'Sin configurar',
    },
  }[hub.status];
  return {
    label: CLOUD_LABEL,
    icon: 'cloud-off',
    value: short ?? MODE_LABELS[UNKNOWN_MODE],
    color: hub.status === STATUS.RATE_LIMITED ? WIDGET_COLORS.WARNING : WIDGET_COLORS.DANGER,
  };
}

function emptyContent(hub) {
  const message = STATUS_MESSAGES[hub.status] ?? {
    en: 'Choose the alarm in the widget settings.',
    fr: "Choisissez l'alarme dans les réglages du widget.",
    de: 'Wählen Sie die Alarmanlage in den Widget-Einstellungen.',
    es: 'Elija la alarma en la configuración del widget.',
  };
  return {
    ttl_seconds: 60,
    components: [
      { type: 'text', variant: 'body', text: message },
      { type: 'status', items: [connectionRow(hub)] },
    ],
  };
}

export const WIDGETS = {
  [ALARM_WIDGET]: {
    async get(gladys, { settings = {}, language = 'en', hub }) {
      const installation = resolveInstallation(gladys, hub, settings.device);
      const snapshot = installation && hub.snapshot(installation.id);
      if (!snapshot) {
        return emptyContent(hub);
      }
      const mode = snapshot.alarm?.mode ?? UNKNOWN_MODE;
      const items = [
        {
          label: { en: 'Alarm', fr: 'Alarme', de: 'Alarmanlage', es: 'Alarma' },
          icon: mode === MODES.DISARMED ? 'unlock' : 'shield',
          value: MODE_LABELS[mode] ?? MODE_LABELS[UNKNOWN_MODE],
          color:
            MODE_COLORS[mode] ??
            (isKnownMode(mode) ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL),
        },
        {
          label: {
            en: 'Last change',
            fr: 'Dernier changement',
            de: 'Letzte Änderung',
            es: 'Último cambio',
          },
          icon: 'clock',
          value: [snapshot.alarm?.changedBy, ago(snapshot.alarm?.changedAt, language)]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 40),
          color: WIDGET_COLORS.NEUTRAL,
        },
      ];
      if (snapshot.doorWindows.length > 0) {
        const open = snapshot.doorWindows.filter((item) => item.open);
        items.push({
          label: {
            en: 'Doors & windows',
            fr: 'Portes et fenêtres',
            de: 'Türen & Fenster',
            es: 'Puertas y ventanas',
          },
          icon: 'home',
          value:
            open.length === 0
              ? {
                  en: 'All closed',
                  fr: 'Tout est fermé',
                  de: 'Alles geschlossen',
                  es: 'Todo cerrado',
                }
              : open
                  .map((item) => item.name)
                  .join(', ')
                  .slice(0, 40),
          color: open.length === 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
        });
      }
      items.push(connectionRow(hub));

      const components = [];
      // Live tile: follows the published temperature, no refresh needed.
      const [firstClimate] = snapshot.climates.filter((item) => item.temperature !== null);
      if (firstClimate) {
        components.push({
          type: 'value',
          label: firstClimate.name.slice(0, 24),
          icon: 'thermometer',
          device_feature: climateIds(gladys, installation, firstClimate.id).feature('temperature'),
        });
      }
      components.push({ type: 'status', items });

      const supported = hub.supportedModes(installation.id);
      for (const button of BUTTONS) {
        const allowed =
          supported.includes(button.mode) &&
          button.mode !== mode &&
          (button.mode !== MODES.DISARMED || settings.allow_disarm === true);
        if (allowed) {
          components.push({
            type: 'button',
            label: button.label,
            icon: button.icon,
            style: button.style,
            action: {
              key: actionKeyOf(button.mode),
              params: { installation: installation.id },
              confirm: true,
            },
          });
        }
      }
      return { ttl_seconds: 60, components };
    },

    async action(gladys, { actionKey, params = {}, settings = {}, hub, onChange }) {
      logger.info(`onWidgetAction <- ${ALARM_WIDGET}.${actionKey}`);
      const wanted = String(actionKey).startsWith(ACTION_PREFIX)
        ? actionKey.slice(ACTION_PREFIX.length)
        : null;
      if (!isKnownMode(wanted)) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      if (wanted === MODES.DISARMED && settings.allow_disarm !== true) {
        throw new Error('Disarming is not allowed from this widget');
      }
      if (!hub.findInstallation(params.installation)) {
        throw new Error('Unknown alarm');
      }
      try {
        const { mode } = await hub.setAlarmMode(params.installation, wanted);
        await onChange?.();
        const prefix = { en: 'Alarm: ', fr: 'Alarme : ', de: 'Alarmanlage: ', es: 'Alarma: ' };
        return textsOf((language) => `${prefix[language]}${modeLabel(mode, language)}`);
      } catch (err) {
        if (err instanceof ArmingRefusedError) {
          const prefix = {
            en: 'Not armed: ',
            fr: 'Non armée : ',
            de: 'Nicht scharf geschaltet: ',
            es: 'No armada: ',
          };
          return textsOf((language) => `${prefix[language]}${err.message}`.slice(0, 200));
        }
        throw err;
      }
    },
  },
};

/**
 * Freshness nudge: the widget shows the cache of the hub, so every refresh
 * that changed something re-pulls it (rate-limited core-side, dropped while
 * disconnected: also sent after every reconnection).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
