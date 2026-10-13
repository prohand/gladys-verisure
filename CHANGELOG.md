# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- German and Spanish translations (configuration screen, messages, widgets,
  documentation).

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

[Unreleased]: https://github.com/prohand/gladys-verisure/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/prohand/gladys-verisure/releases/tag/v1.0.1
