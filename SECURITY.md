# Security policy

This integration drives a burglar alarm: a flaw in it can disarm a house.
Security reports are handled first.

## Supported versions

Only the latest release of the Verisure integration receives security fixes.
Update the integration from Gladys before reporting a problem.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-verisure](https://github.com/prohand/gladys-verisure/security),
then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys, and the Verisure app you use
  ("My Verisure" or "Verisure");
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove passwords, codes, tokens, cookies, phone
  numbers and addresses first).

You should get a first answer within 7 days. The fix ships as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular:

- how the Verisure password, the alarm code and the session (cookies, refresh
  token, device identity kept in `/data/verisure-session.json`) are stored,
  sent and logged;
- who can arm or disarm the alarm through Gladys (dashboard, scenes, widget).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Verisure services, apps and panels (report to Verisure), and the
unofficial nature of the Verisure API this integration uses.

## What the integration does to protect you

- The password and the alarm code are `secret` fields of the Gladys
  configuration; they are never written to `/data` nor logged.
- The session file in `/data` is readable by the container user only (mode
  `0600`) and holds what spares a new SMS code at each restart: cookies, refresh
  token and the identifiers of this "device" for Verisure.
- The **Forget the session** button logs out from Verisure and deletes that
  file.
- The dashboard widget never shows a **Disarm** button unless its own settings
  allow it, and the server checks that setting again: a dashboard can hang on a
  wall where anyone can tap it.
- Verisure locks accounts that try too often: after a refused password or a
  required code, the integration stops trying until the configuration changes
  or a code is validated.

## Good practices for users

- Give Gladys a dedicated Verisure user with the least rights it needs, when
  your contract allows it.
- Do not allow disarming from a widget shown on a shared or public dashboard.
- Keep Gladys and the integration up to date.
