# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- New scene trigger "Verisure alarm triggered": a new alarm (intrusion, fire,
  panic button, water leak, tampering) in the Verisure event log, even when
  the alarm mode does not change. Read at each refresh. My Verisure: one more
  request per refresh (the activity log), asked no more after 3 failures in a
  row. The detailed logs show every new log entry and its code, to complete
  the list of alarm types.

## [1.2.5] - 2026-11-16

### Fixed

- My Verisure: with several phone numbers on the account, "Send a code" no
  longer sends the code to the first one. It lists the masked numbers and
  waits for the user to pick one in the new "Phone" field (position or last
  digits).

## [1.2.4] - 2026-11-16

- Maintenance release, no functional change.

## [1.2.3] - 2026-11-16

- Update `@gladysassistant/integration-sdk` to 0.16.1 (security update).

## [1.2.2] - 2026-11-16

- Maintenance release, no functional change.

## [1.2.1] - 2026-11-07

### Changed

- My Verisure: the detailed logs show the zones the cloud reports (name, type,
  state), to study door/window sensors with testers.

## [1.2.0] - 2026-10-25

### Added

- Search keywords in the Gladys catalog (Securitas Direct, My Verisure, smart
  lock, Sentinel...).

### Changed

- Gladys 5.3.0 or later is now required.
- Gladys integration SDK 0.16.

## [1.1.1] - 2026-10-23

- Maintenance release, no functional change.

## [1.1.0] - 2026-10-13

### Added

- German and Spanish translations (configuration screen, messages, widgets,
  documentation).

### Fixed

- The English documentation names the Gladys screens as the Gladys interface does.

## [1.0.1] - 2026-10-13

### Added

- Verisure alarms on both Verisure clouds: "My Verisure" (France, Spain, Italy,
  Portugal, United Kingdom, Ireland, Latin America) and "Verisure" (Nordics,
  Benelux, Germany...).
- One alarm device per installation: its mode (disarmed, partial day, partial
  night, total, and the perimeter modes when the panel has a perimeter) can be
  read and set from Gladys.
- Door and window detectors, smart plugs and smart locks (Verisure app), and
  temperature / humidity sensors (both apps).
- Login with the verification code Verisure sends by SMS or e-mail, from the
  Configuration screen ("Send a code", then "Validate the code"). The session is
  kept in `/data`, so a restart does not ask for a new code.
- Scene triggers: alarm mode changed, door/window opened or closed, Verisure
  connection lost (Gladys 5.1.0 or later).
- Scene actions: set the alarm mode (with a "force" option and the refusal
  reason as an output), read the alarm now.
- "Verisure alarm" dashboard widget: mode, last change, open doors and windows,
  connection, and buttons to arm (and to disarm, when the widget allows it).
- Cloud transport badge on every device, degraded while Verisure throttles the
  requests.
- Detailed logs switch in the Configuration screen.
- CI (format, lint, tests on Node 22 and 24, Docker build, store admission
  checks), Release workflow, GitHub Releases and Dependabot.
- `SECURITY.md`, `CLAUDE.md` and the user documentation in English and French.

[Unreleased]: https://github.com/prohand/gladys-verisure/compare/v1.2.5...HEAD
[1.2.5]: https://github.com/prohand/gladys-verisure/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/prohand/gladys-verisure/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/prohand/gladys-verisure/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/prohand/gladys-verisure/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/prohand/gladys-verisure/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/prohand/gladys-verisure/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/prohand/gladys-verisure/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/prohand/gladys-verisure/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/prohand/gladys-verisure/releases/tag/v1.0.1
