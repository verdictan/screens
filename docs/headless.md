# Headless features

Screens includes local capture automation, evidence tools, agent workflows, and
storage commands. They use the same registry as the review interface. Start
Screens with `screens serve`; it also processes authorized capture jobs and
saved schedules. No separate queue, worker service, Docker installation, or
cloud account is needed.

## Command input

```sh
screens headless-help
screens headless-help jobs-enqueue
screens doctor --port 4800
screens storage-report
screens tasks-list --project PROJECT_ID
```

`headless-help` prints each action's input schema and whether it is CLI-only.
Use the exact action name shown there. Some evidence action names contain
underscores. Scalar flags use kebab case: `expectedRevision` becomes
`--expected-revision`. Every flag takes a value, including booleans such as
`--enabled false`.

Use a JSON file for nested objects or arrays:

```sh
screens ACTION --input action.json --data ./registry
```

Direct flags override fields from `--input`. Commands use the registry selected
by `--data` or `SCREENS_HOME`. Commands that read recipe files and execute project
code remain CLI-only. Execution actions require `--execute yes`; `capture-auto` is itself an explicit
execution request. Import, planning, and discovery do not execute project commands.

Registry operations use the same service through MCP and
`POST /api/automation/ACTION`. File import/export, signing, and storage
administration remain local CLI operations.

## Capture automation

Use [Automatic capture](automatic-capture.md) for setup and
[Capture recipes](capture-automation.md) for exact revisions.

| Capability | Command or configuration |
| --- | --- |
| Draft automatic plans | `capture-draft PATH` proposes recipes, evidence and unresolved decisions without executing the project. |
| Automatic jobs | `capture-auto` runs with persistent checkpoints; `jobs-enqueue-auto` queues a working-tree plan and `capture-auto --resume JOB` resumes it. |
| Environment diagnostics | `doctor` reports the installed runtime, browsers, registry access, and optional port status. |
| Configuration diagnostics | `capture-config-diagnose` reports field paths and corrections. |
| Profiles and matrices | `capture-plan` expands named profiles and combinations of browsers, devices, themes, locales, and text scales. |
| Browser capture | `capture-run` captures an exact Git revision using the configured managed browser engines. |
| Repeatable fixtures | `determinism` sets time, random seed, timezone, and fixture metadata. |
| Readiness | Application/scenario `ready` waits for selectors, application events, and fonts. |
| Animation timing | `animationTime` pauses supported page animations at the specified timestamp. |
| Network replay | `network.har` reads a recording from the repository. |
| Environment records | Captures retain browser, runtime, and rendering settings as derived evidence. |
| Route discovery | `routes-discover` proposes registrations from supported static routes. |
| Changed screens | `screens-affected` maps source changes; `capture-changed` captures the selected views. |
| Workspace dependencies | Source mapping follows static imports, aliases, and package dependencies. |
| Regression search | `capture-bisect` locates a difference threshold crossing; scan mode handles changes that later recover. |
| Repeatability reports | `capture-repeatability` compares repeated captures of one revision. |
| Merge candidates | `capture-merge` captures a supplied exact candidate ref and records its parents. |

Route and source discovery support static patterns. Dynamic application behavior
can require explicit source mapping or a capture recipe. Unmapped screens remain
included in changed-screen capture selection.

## Evidence and reports

See [Evidence tools](headless-evidence.md) for collector settings and schemas.

| Capability | Command or configuration |
| --- | --- |
| OCR and text search | `ocr_extract` stores English text and word coordinates; `ocr_search` searches saved results. |
| Text comparison | `text_compare` reports changes between recorded extractions. |
| Browser observations | `evidence.dom`, `evidence.console`, `evidence.network`, and `evidence.fonts` record the rendered page and its errors. |
| Accessibility | `evidence.accessibility` records configured axe-core results. |
| Area annotations | `evidence.selectors` records element bounds; `selector_annotate` creates a capture-bound area note. |
| Source references | `source_link` attaches a repository file and symbol at the capture revision. |
| Perceptual measurements | `perceptual_compare` records SSIM, RGB error, and PSNR at original dimensions. |
| Fixture contracts | `fixture_check` compares recorded metadata with explicit fixture requirements. |
| CI policies | `ci_evaluate` evaluates selected checks and capture-job outcomes. |
| CI formats | `ci_report` and `report_export` produce SARIF, JUnit, Markdown, or JSON. |
| Review reports | `review_report` writes a local report with images, comments, measurements, and attachments. |

Reported checks, comparison scores, and signatures do not approve targets or
verify fixes. Those remain human decisions.

## Jobs and schedules

Queue an authorized recipe while Screens is running:

```sh
screens jobs-enqueue --repo ./app --config ./screens.capture.json --ref HEAD --execute yes
screens jobs-list
screens jobs-get --id JOB_ID
screens jobs-events --id JOB_ID --after 0
screens jobs-watch --id JOB_ID --after 0
```

Screens runs the job locally. It retains the resolved recipe, exact revision,
completed captures, and progress events. Resume follows the [checkpoint reuse rules](automatic-capture.md#automatic-capture-jobs-and-resume). `jobs-watch` prints one JSON event per line and stops when the job
completes, fails, or is cancelled. Continue from the last event ID with `--after`.

Read the latest job revision before cancelling or resuming a job:

```sh
screens jobs-change --id JOB_ID --expected-revision REVISION --resume false
screens jobs-change --id JOB_ID --expected-revision REVISION --resume true
```

Capture schedules use the same local service:

```json
{
  "kind": "capture",
  "title": "Nightly checkout",
  "repo": "/path/to/app",
  "config": "/path/to/screens.capture.json",
  "ref": "main",
  "profile": "checkout",
  "everySeconds": 86400,
  "expectedRevision": 0,
  "execute": "yes"
}
```

```sh
screens schedule-save --input schedule.json
screens schedule-list
screens schedule-set-enabled --id SCHEDULE_ID --expected-revision REVISION --enabled false
```

Screens resolves the configured ref when the schedule fires. `eventTypes` can
also trigger a schedule from matching local registry events. For backups, use
`kind: "backup"`, a `destination` directory, and `everySeconds`. Screens creates
the parent directory when the schedule is saved, then a unique directory for each
backup. Scheduled work runs while `screens serve` is running.

## Agent tasks and queries

```sh
screens tasks-list --project PROJECT_ID --available true
screens tasks-claim --id NOTE_ID --owner agent-a --expected-revision 0 --seconds 900
screens tasks-handoff --id NOTE_ID
screens tasks-release --id NOTE_ID --owner agent-a --expected-revision CLAIM_REVISION
```

Claim revisions are separate from feedback revisions. Renew with `tasks-claim`
and the latest claim revision. Active claims belong to their current owner;
expired claims can be acquired by another agent. A claim does not mark feedback
as fixed. Handoff packages retain the task, capture references, source links, and
supporting evidence.

```sh
screens registry-page --collection captures --project PROJECT_ID --limit 50
screens evidence-scoped --review-set SET_ID
screens events-list --after 0 --limit 100
screens events-watch --after 0
```

Continue a collection page with its `nextCursor` and the same filters. Supported
collections are `screens`, `captures`, `notes`, `runs`, `evidence`, and `reviewSets`.
Scoped evidence accepts an exact capture, run, or review set. Its optional `region`
contains normalized `x`, `y`, `width`, and `height` coordinates.

The event log stays in the registry. `events-watch` streams local events as JSON
lines; use the last event ID as `--after` when reconnecting.

## Local storage and sharing

| Capability | Commands |
| --- | --- |
| Portable review sets | `bundle-export`, `bundle-import` |
| Backup and restore | `registry-backup`, `registry-restore` |
| Integrity and disk usage | `registry-integrity`, `storage-report` |
| Unreferenced asset removal | `retention-plan`, `retention-execute` |
| Managed signatures | `bundle-sign`, `signature-verify` |
| Public signing identities | `signing-key-export`, `signing-key-trust` |

See [Storage](storage-tools.md) for bundle contents, restore, retention, and trust rules.
