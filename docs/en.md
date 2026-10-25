# Verisure

Drive your Verisure alarm from Gladys: arm, disarm, follow its detectors, and
react in your scenes.

The integration goes through the **Verisure cloud** ("Cloud" badge on the
devices): it needs Internet access, and the data refreshes every 2 minutes by
default. Unofficial API: Verisure can change it without notice.

## Which Verisure app?

Two Verisure clouds exist, with different accounts and features. Pick the one
of the app you use:

| App             | Countries                                                                               | What Gladys sees                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **My Verisure** | France, Spain, Italy, Portugal, United Kingdom, Ireland, Argentina, Brazil, Chile, Peru | The alarm (all its modes, perimeter included) and the comfort sensors (temperature, humidity)                          |
| **Verisure**    | Sweden, Norway, Denmark, Finland, Belgium, Netherlands, Germany...                      | The alarm (disarmed, partial, total), door/window detectors, temperature/humidity sensors, smart plugs and smart locks |

## Configuration

The integration requires **Gladys 5.3.0 or later**.

1. Open the **Configuration** tab of the integration.
2. Pick your **Verisure app** and, for My Verisure, your **country**.
3. Type the **username** and the **password** of your app.
4. Verisure app only: type the **alarm code** (the keypad one). It arms,
   disarms and drives the locks. My Verisure does not need it.
5. Save, then click **Test the connection**.

### The verification code (first connection)

At the first connection, Verisure asks to validate this new "device":

1. click **Send a code**: Verisure sends a code by SMS (or e-mail);
2. type the code in **Validate the code**, then click the button.

Done once: the session is kept in the `/data` folder of the integration, a
restart does not ask for a new code. If Verisure asks again later (password
changed, session expired), the connection status of the Configuration screen
says so, and your scenes can know it with the **The Verisure connection is
lost** trigger.

### The other settings

- **Refresh interval**: 120 seconds by default, 60 at least. Verisure blocks
  accounts that ask too often (sometimes for hours): do not lower it without a
  reason.
- **Detailed logs**: logs every exchange with Verisure (never the password,
  the codes or the tokens), to diagnose a problem.

### The buttons

- **Test the connection**: logs in, lists your installations and their mode.
- **Send a code** / **Validate the code**: the SMS validation above.
- **Forget the session**: logs out from Verisure and deletes the kept session.
  The next connection may ask for a code again.

## Devices

Once connected, open the **Discover** tab and add the devices with
**Add to Gladys**:

- **Verisure _installation name_**: the **alarm mode**, a select. The modes
  offered are the ones of your panel: Disarmed, Partial (day), Partial (night)
  and Total, plus the perimeter modes when your installation has outdoor
  detectors. Choosing a mode sends the order; the value changes once Verisure
  confirmed it (from a few seconds to a minute and a half).
- **Door/window detectors** (Verisure app): open / closed.
- **Temperature and humidity sensors**.
- **Smart plugs** and **locks** (Verisure app).

When the alarm refuses to arm (a door or a window open), the order fails and
Gladys shows the error.

## Scenes

The integration adds its own cards to the scene editor (Gladys 5.1 or later),
under the **Integrations** category.

### Triggers

- **Verisure alarm mode changed**: armed or disarmed from the keypad, a badge,
  the app or a remote. Filter on the alarm and the new mode. The following
  actions can read `{{triggerEvent.data.mode}}`,
  `{{triggerEvent.data.previous_mode}}` and `{{triggerEvent.data.changed_by}}`
  (who changed it, when Verisure tells). Gladys's own orders never fire it, to
  avoid loops.
- **A Verisure door/window detector moved** (Verisure app): filter on the
  detector and the state (opened, closed).
- **The Verisure connection is lost**: Verisure stopped answering, refused the
  login, throttles the requests or asks for a new code. Ideal to send yourself
  a message.

The mode values: `disarmed`, `armed_home` (partial day), `armed_night` (partial
night), `armed_away` (total), `perimeter`, `armed_home_perimeter`,
`armed_night_perimeter`, `armed_away_perimeter`.

### Actions

- **Set the Verisure alarm mode**: pick the alarm (empty = the only one of the
  account) and the mode. Tick **Arm even with a door or window open** to force
  when the panel allows it. Outputs for the following actions: `success`
  (true / false), `mode` (the alarm mode) and `reason` (why it was refused,
  e.g. the door left open). A refusal does not stop the scene: test `success`
  in a condition.
- **Read the Verisure alarm now**: asks the alarm its real state without
  waiting for the next refresh. Output: `mode`.

## Dashboard

In **Dashboard → Edit → New widget**, add the **Verisure alarm** widget: alarm
mode (green disarmed, orange partial, red total), last change (who, how long
ago), open doors and windows, connection, temperature, and buttons to arm (every
tap asks for a confirmation).

The **Disarm** button only shows when you tick **Show a Disarm button** in the
widget settings. Beware: anyone who sees that dashboard can then disarm your
alarm. Do not tick it on a shared dashboard or one shown in the entrance.

## Troubleshooting

- **"Verisure asks for a verification code"**: follow
  [the code validation](#the-verification-code-first-connection).
- **"Verisure refused the username or the password"**: check them in the
  Verisure app, and the app chosen (My Verisure or Verisure). The integration
  stops trying until the configuration changes, so your account is not
  blocked.
- **"Verisure limits the requests"**: the integration waits 15 minutes before
  trying again. Raise the refresh interval if it happens again.
- **The alarm code is missing** (Verisure app): fill it in to arm, disarm and
  drive the locks.
- For the details, turn the **detailed logs** on and read the integration logs
  from Gladys.
