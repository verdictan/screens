# Roadmap

Implementation and release verification are separate. [Recorded validation](validation.md)
records the current local browser fixture checks and an earlier Docker snapshot.
Neither establishes every supported installation or native runtime.

## Available

| Area | Implementation |
| --- | --- |
| Review | Immutable captures/runs, Current/Target/PR comparisons, overlays, point/area feedback, review sets, revision checks, approval history |
| Capture | Shared working-tree/exact-commit recipes, managed browsers, Apple native capture, services, login, fixture resets, readiness, draft plans, source relationships, required coverage and optional backlog |
| Automation | Resumable local jobs, schedules, task claims, scoped queries, events, source-change selection, repeatability and regression search |
| Evidence | Pixel/perceptual measurements, browser observations, accessibility, English OCR, source links, CI and review reports |
| Storage | Bundles, online backups, restore, integrity and usage reports, retention, managed signatures |

See the [documentation index](README.md) for operating contracts.

## Remaining

- Native capture adapters for Electron and other non-Apple runtimes.
- Native fixture adapters and discovery beyond supported static patterns.
- Additional OCR languages.
- Screen metadata updates and rename/move lineage.
- Review-history migration and explicit reconfirmation of carried-forward feedback.
- Richer motion playback and perceptual measurements.
- Hosted authentication, project authorization, and remote storage/worker boundaries.
- Signed releases and registry distribution for client packages.

## Release evidence still needed

- Installed-package workflows across supported operating systems.
- Installer recovery and upgrade scenarios.
- Real agent-client sessions and live-account behavior.
- Docker/Homebrew release checks and native-app capture for the latest automation
  and bundling changes. Local browser fixture checks are recorded separately.
