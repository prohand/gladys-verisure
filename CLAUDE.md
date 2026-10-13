# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one
runtime dependency: `@gladysassistant/integration-sdk`) for **Verisure** alarm
systems. It talks to the Verisure **cloud** only (manifest
`"transports": ["cloud"]`), through the unofficial APIs of the two Verisure
apps:

- **OWA** — "My Verisure", formerly Securitas Direct (France, Spain, Italy,
  Portugal, UK, Ireland, Latin America). Ported from the Home Assistant
  integration `guerrerotook/securitas-direct-new-api`.
- **mypages** — "Verisure" (Nordics, Benelux, Germany...). Ported from
  `persandstrom/python-verisure`, the library of the Home Assistant core
  integration.

It started from the official template
[`GladysAssistant/integration-template-js`](https://github.com/GladysAssistant/integration-template-js);
the CI/release workflows are the ones of `prohand/gladys-devmel`.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/owa.test.js              # one file
node --test --test-name-pattern "force"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node
22 and 24; pull requests also build the Docker image and run the store checks.
Run the three commands before pushing.

## Architecture

```
index.js                 creates the SDK client, calls createApp, connects
src/app.js               SDK wiring: handlers, publication of devices/states/transports
src/hub.js               ONE Verisure session, cache of every installation, refresh loop,
                         call queue (never two Verisure calls at once), connection status
src/verisure/owa.js      OWA client (GraphQL, auth header, SMS validation, panel polling)
src/verisure/mypages.js  mypages client (GraphQL, cookies, MFA + trust cookie, 2 hosts)
src/verisure/index.js    picks the client from the config, keys the saved session by account
src/verisure/modes.js    the alarm mode keys shared by everything (device, scenes, widget)
src/verisure/errors.js   error classes the hub reacts to (MFA, auth, rate limit, refusal)
src/verisure/http.js     the only `fetch` (timeout), cookies, JWT payload reader
src/devices/<type>.js    one Gladys device type per file: alarm, doorWindow, climate,
                         smartPlug, lock (items, ids, build, states, setValue)
src/events.js            scene triggers: diff of two snapshots
src/scenes.js            scene actions (manifest `scene_actions`)
src/widgets.js           dashboard widget (manifest `widgets`)
src/actions.js           Configuration screen buttons: test, send code, validate code, forget
src/store.js             the session file in /data (0600)
src/config.js            DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json   manifest
docs/en.md, docs/fr.md   user documentation, re-hosted by Gladys (mandatory)
test/                    node --test; fake Verisure clouds (test/helpers/fakeFetch.js),
                         fake client (test/helpers/fakeClient.js), fake Gladys of the SDK
```

## Rules

- **Never hammer Verisure.** Both clouds lock accounts or block IPs (OWA's
  Incapsula WAF) for hours. Every call goes through the hub queue; the refresh
  is one read per installation per `poll_interval` (60 s minimum, 120 s
  default); after a refused login or a required code the loop STOPS until the
  user acts; a rate limit backs off 15 minutes. Never add a retry loop on a
  login.
- **Secrets.** The password, the alarm code, cookies, the hash, the refresh
  token, OTP codes and phone numbers are never logged. Only the session
  (never the password) is written, to `/data/verisure-session.json`, mode 0600.
- **The OWA device identity is forever.** `deviceId` / `uuid` / `indigitall`
  are validated once by SMS: changing them asks the user for a new code.
- **External ids are forever.** Built with `gladys.externalIds(type,
platformId(installation, label))`. Same for every key users store: manifest
  `config_schema`, `actions`, scene trigger/action keys and their fields, the
  widget key and settings, the mode keys of `src/verisure/modes.js`.
- **No scene loops.** Gladys's own orders update the hub cache at once, so the
  next read sees no transition and `alarm_mode_changed` does not fire.
- **A refusal is an output.** An alarm refusing to arm (open door) answers
  `success: false` + `reason` in the scene action, a toast in the widget; only
  transport failures throw.
- **Disarming from the widget** requires the instance setting `allow_disarm`,
  checked again in the action handler.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or the manifest, nor the `docker_image` tag, by
  hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow does it.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects (label,
  description, placeholder). The catalog description holds 10 to 100
  characters per language. `test/manifest.test.js` ties the manifest to the
  code (defaults, handlers, triggers, mode options): change both sides together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, widget content, and `docs/en.md` / `docs/fr.md`, kept in sync.
  Strings Gladys stores as plain text (device names, select labels) follow the
  account: French for OWA France, English otherwise (`src/devices/helpers.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
