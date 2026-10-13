# Verisure for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that
drives **Verisure** alarm systems through the Verisure **cloud**: arm, disarm,
follow the detectors, and use them in scenes and on the dashboard.

> Unofficial: this project is not affiliated with Verisure. It uses the APIs of
> the Verisure apps, which Verisure can change without notice.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Features

|                     | My Verisure (FR, ES, IT, PT, UK, IE, Latin America)                    | Verisure (Nordics, Benelux, Germany...)                                |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Alarm mode          | Read / set: disarmed, partial day, partial night, total, perimeter (+) | Read / set: disarmed, partial, total                                   |
| Sensors             | Temperature, humidity (comfort sensors)                                | Door/window detectors, temperature, humidity                           |
| Actuators           | —                                                                      | Smart plugs, smart locks                                               |
| Login               | Username + password, SMS code the first time                           | Username + password, SMS/e-mail code the first time, alarm code to arm |
| Gladys capabilities | Scene triggers, scene actions, dashboard widget, cloud transport badge | Scene triggers, scene actions, dashboard widget, cloud transport badge |

On top of the devices (Gladys 5.1+):

| Capability                                                      | Manifest key          | Code                               |
| --------------------------------------------------------------- | --------------------- | ---------------------------------- |
| Scene trigger: alarm mode changed                               | `alarm_mode_changed`  | [`src/events.js`](src/events.js)   |
| Scene trigger: door/window opened or closed                     | `door_window_changed` | [`src/events.js`](src/events.js)   |
| Scene trigger: Verisure connection lost                         | `connection_lost`     | [`src/app.js`](src/app.js)         |
| Scene action: set the alarm mode                                | `set_alarm_mode`      | [`src/scenes.js`](src/scenes.js)   |
| Scene action: read the alarm now                                | `refresh_alarm`       | [`src/scenes.js`](src/scenes.js)   |
| Dashboard widget: Verisure alarm                                | `alarm`               | [`src/widgets.js`](src/widgets.js) |
| Configuration buttons: test, send/validate code, forget session | `actions`             | [`src/actions.js`](src/actions.js) |

The manifest declares `"transports": ["cloud"]`: every device carries a
**cloud** badge, `unreachable` when Verisure stops answering, and the orange
"degraded" dot while Verisure throttles the requests.

## How it works

```
Gladys  <── SDK ──>  src/app.js  ──>  src/hub.js  ──>  src/verisure/{owa,mypages}.js  ──>  Verisure cloud
                      devices,          one session,      GraphQL clients
                      scenes, widget    cache, queue,
                                        refresh loop
```

- **One read per installation** every `poll_interval` (120 s by default, 60 s
  minimum), shared by every device, the widget and the scenes. Verisure blocks
  chatty accounts for hours: every call goes through one queue, a rate limit
  backs off 15 minutes, a refused login or a required code stops the loop
  until the user acts.
- **Verification code**: the first login asks for a code sent by SMS (or
  e-mail). The Configuration screen buttons **Send a code** and **Validate the
  code** carry it; the session (never the password) is then kept in
  `/data/verisure-session.json` (mode 0600), so a restart needs no new code.
- **Orders**: the alarm `mode` is a `text`/`select` feature whose options are
  the modes of the panel. A slow panel (OWA: up to ~90 s) does not block the
  dashboard: the command is acked after 3 s and the state is published when
  Verisure confirms, or rolled back when it refuses.
- **No scene loops**: an order given by Gladys never fires
  `alarm_mode_changed`.

## Project structure

```
.
├─ index.js                          # SDK bootstrap: createApp + connect
├─ src/
│  ├─ app.js                         # SDK handlers, publication to Gladys
│  ├─ hub.js                         # session, cache, refresh loop, call queue
│  ├─ verisure/                      # the two Verisure clients + modes, errors, http
│  ├─ devices/                       # one Gladys device type per file
│  ├─ events.js                      # scene triggers
│  ├─ scenes.js                      # scene actions
│  ├─ widgets.js                     # dashboard widget
│  ├─ actions.js                     # Configuration screen buttons
│  ├─ store.js                       # session file in /data
│  ├─ logging.js                     # "Detailed logs" switch
│  └─ config.js                      # defaults + normalization
├─ docs/en.md, docs/fr.md            # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake Verisure clouds, fake Gladys
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24); PRs: Docker build + store checks
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build + GitHub Release
├─ .github/workflows/build.yml       # multi-arch image (amd64 + arm64) to ghcr.io
├─ .github/workflows/github-release.yml # a GitHub Release for every version tag
├─ .github/scripts/changelog-release.mjs # rolls the changelog at release time
├─ .github/dependabot.yml            # npm weekly, Actions and Docker monthly
└─ cover.png                         # catalog cover, 800×534 px
```

## Development

```bash
npm install
npm test              # node --test: no network, fake Verisure clouds + fake Gladys
npm run lint          # ESLint
npm run format:check  # Prettier
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="verisure" \
VERISURE_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json` and the manifest (`version` +
`docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-verisure`
(`:X.Y.Z` and `:latest`) and publishes the GitHub Release. The Gladys store
indexer picks up the new version from the manifest of the default branch.

For the store to list the integration, the repository must be public, carry
the GitHub topic `gladys-assistant-integration`, and the package
`ghcr.io/prohand/gladys-verisure` must be public.

## Credits

The Verisure protocols come from two Home Assistant projects:
[persandstrom/python-verisure](https://github.com/persandstrom/python-verisure)
and
[guerrerotook/securitas-direct-new-api](https://github.com/guerrerotook/securitas-direct-new-api).
Built from the official
[Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0
