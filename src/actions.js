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
import { textsOf } from './i18n.js';
import { modeLabel, UNKNOWN_MODE } from './verisure/modes.js';

const logger = createLogger({ name: 'actions' });

/** A failure explained in every language, never a stack trace. */
function explain(err) {
  if (err.code === 'NOT_CONFIGURED') {
    return STATUS_MESSAGES.not_configured;
  }
  if (err.code === 'NO_CHALLENGE') {
    return {
      en: 'Click "Send a code" first, then type the code you received.',
      fr: "Cliquez d'abord sur « Envoyer un code », puis saisissez le code reçu.",
      de: 'Klicke zuerst auf „Code senden“ und gib dann den erhaltenen Code ein.',
      es: 'Pulse primero «Enviar un código» y escriba después el código recibido.',
    };
  }
  if (err.code === 'MFA_NOT_REQUIRED') {
    return {
      en: 'Verisure does not ask for a code: the connection works without it.',
      fr: 'Verisure ne demande pas de code : la connexion fonctionne sans.',
      de: 'Verisure verlangt keinen Code: Die Verbindung funktioniert ohne.',
      es: 'Verisure no pide ningún código: la conexión funciona sin él.',
    };
  }
  const message = STATUS_MESSAGES[statusOf(err)];
  return textsOf((language) => `${message[language]} (${err.message})`);
}

export const ACTIONS = {
  async test_connection(gladys, { hub }) {
    try {
      const installations = await hub.test();
      await hub.refreshNow({ forceInstallations: true });
      const names = installations.map((installation) => {
        const mode = hub.snapshot(installation.id)?.alarm?.mode ?? UNKNOWN_MODE;
        return textsOf((language) => `${installation.name} (${modeLabel(mode, language)})`);
      });
      if (names.length === 0) {
        return {
          en: 'Connected, but this account has no installation.',
          fr: "Connecté, mais ce compte n'a aucune installation.",
          de: 'Verbunden, aber dieses Konto hat keine Installation.',
          es: 'Conectado, pero esta cuenta no tiene ninguna instalación.',
        };
      }
      const connected = {
        en: 'Connected: ',
        fr: 'Connecté : ',
        de: 'Verbunden: ',
        es: 'Conectado: ',
      };
      return textsOf(
        (language) => `${connected[language]}${names.map((name) => name[language]).join(', ')}.`,
      );
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
          de: 'Dieses Gerät ist bereits bestätigt: verbunden.',
          es: 'Este dispositivo ya está validado: conectado.',
        };
      }
      const where = destination ? ` (${destination})` : '';
      return channel === 'email'
        ? {
            en: `Code sent by e-mail${where}: type it in "Validate the code".`,
            fr: `Code envoyé par e-mail${where} : saisissez-le dans « Valider le code ».`,
            de: `Code per E-Mail gesendet${where}: Gib ihn unter „Code bestätigen“ ein.`,
            es: `Código enviado por correo electrónico${where}: escríbalo en «Validar el código».`,
          }
        : {
            en: `Code sent by SMS${where}: type it in "Validate the code".`,
            fr: `Code envoyé par SMS${where} : saisissez-le dans « Valider le code ».`,
            de: `Code per SMS gesendet${where}: Gib ihn unter „Code bestätigen“ ein.`,
            es: `Código enviado por SMS${where}: escríbalo en «Validar el código».`,
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
        en: 'Code accepted: the integration is connected to Verisure. Your devices are in the Discover tab.',
        fr: "Code accepté : l'intégration est connectée à Verisure. Vos appareils sont dans l'onglet Découverte.",
        de: 'Code akzeptiert: Die Integration ist mit Verisure verbunden. Deine Geräte findest du im Tab „Entdecken“.',
        es: 'Código aceptado: la integración está conectada a Verisure. Sus dispositivos están en la pestaña «Descubrir».',
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
      de: 'Sitzung vergessen: Die nächste Verbindung verlangt einen neuen Code, falls Verisure es erfordert.',
      es: 'Sesión olvidada: la próxima conexión pedirá un nuevo código si Verisure lo exige.',
    };
  },
};
