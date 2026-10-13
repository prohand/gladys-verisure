// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// They carry the login steps a form cannot: Verisure sends a verification code
// by SMS (or e-mail) the first time this integration connects, and the code
// has to come back. The resolved message is shown under the button; a thrown
// error is shown too.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { STATUS_MESSAGES, statusOf } from './hub.js';
import { MfaRequiredError, VerisureError } from './verisure/errors.js';
import { MODE_LABELS, UNKNOWN_MODE } from './verisure/modes.js';

const logger = createLogger({ name: 'actions' });

/** A failure explained in both languages, never a stack trace. */
function explain(err) {
  if (err.code === 'NOT_CONFIGURED') {
    return STATUS_MESSAGES.not_configured;
  }
  if (err.code === 'NO_CHALLENGE') {
    return {
      en: 'Click "Send a code" first, then type the code you received.',
      fr: "Cliquez d'abord sur « Envoyer un code », puis saisissez le code reçu.",
    };
  }
  if (err.code === 'MFA_NOT_REQUIRED') {
    return {
      en: 'Verisure does not ask for a code: the connection works without it.',
      fr: 'Verisure ne demande pas de code : la connexion fonctionne sans.',
    };
  }
  const message = STATUS_MESSAGES[statusOf(err)];
  return {
    en: `${message.en} (${err.message})`,
    fr: `${message.fr} (${err.message})`,
  };
}

export const ACTIONS = {
  async test_connection(gladys, { hub }) {
    try {
      const installations = await hub.test();
      await hub.refreshNow({ forceInstallations: true });
      const names = installations.map((installation) => {
        const mode = hub.snapshot(installation.id)?.alarm?.mode ?? UNKNOWN_MODE;
        return {
          en: `${installation.name} (${MODE_LABELS[mode].en})`,
          fr: `${installation.name} (${MODE_LABELS[mode].fr})`,
        };
      });
      if (names.length === 0) {
        return {
          en: 'Connected, but this account has no installation.',
          fr: "Connecté, mais ce compte n'a aucune installation.",
        };
      }
      return {
        en: `Connected: ${names.map((name) => name.en).join(', ')}.`,
        fr: `Connecté : ${names.map((name) => name.fr).join(', ')}.`,
      };
    } catch (err) {
      logger.warn(`test_connection: ${err.message}`);
      if (err instanceof MfaRequiredError) {
        return STATUS_MESSAGES.mfa_required;
      }
      return explain(err);
    }
  },

  async send_code(gladys, { hub }) {
    try {
      const { channel, destination } = await hub.requestCode();
      if (channel === 'none') {
        await hub.refreshNow({ forceInstallations: true });
        return {
          en: 'This device is already validated: connected.',
          fr: 'Cet appareil est déjà validé : connecté.',
        };
      }
      const where = destination ? ` (${destination})` : '';
      return channel === 'email'
        ? {
            en: `Code sent by e-mail${where}: type it in "Validate the code".`,
            fr: `Code envoyé par e-mail${where} : saisissez-le dans « Valider le code ».`,
          }
        : {
            en: `Code sent by SMS${where}: type it in "Validate the code".`,
            fr: `Code envoyé par SMS${where} : saisissez-le dans « Valider le code ».`,
          };
    } catch (err) {
      logger.warn(`send_code: ${err.message}`);
      return explain(err);
    }
  },

  async validate_code(gladys, { fields, hub }) {
    const code = String(fields.code ?? '').replace(/\s+/g, '');
    if (!/^[0-9A-Za-z]{4,10}$/.test(code)) {
      throw new VerisureError('Invalid code format');
    }
    try {
      await hub.validateCode(code);
      return {
        en: 'Code accepted: the integration is connected to Verisure. Your devices are in the Discovery tab.',
        fr: "Code accepté : l'intégration est connectée à Verisure. Vos appareils sont dans l'onglet Découverte.",
      };
    } catch (err) {
      logger.warn(`validate_code: ${err.message}`);
      return explain(err);
    }
  },

  async forget_session(gladys, { hub }) {
    await hub.forgetSession();
    return {
      en: 'Session forgotten: the next connection will ask for a new code if Verisure requires one.',
      fr: "Session oubliée : la prochaine connexion demandera un nouveau code si Verisure l'exige.",
    };
  },
};
