# Workflow inventory

This inventory comes from the application source. It covers domain transitions,
async work, UI interactions and lifecycle code in `src/` and `ui/`, plus server
and worker entry points. It separates transition machines from derived state,
immutable outcomes and state owned by a control library. Random-number seeds,
text input values and ordinary collection accumulators are not workflow machines.

## Decision

Use small state models with clear owners. Share rules when the UI, CLI and agents
must agree. Use reducers where several booleans can describe contradictory UI
states. Keep independent dimensions separate. Keep Radix and Vaul in charge of
standard controls. Do not add a state-machine dependency or rewrite every local
interaction into one global machine.

`src/workflows.mjs` is the shared contract and machine-readable inventory.
`ui/lib/workflows.js` contains UI reducers. Read the catalog through:

```sh
screens workflow-catalog
```

The same read is available as MCP `workflow_catalog` and `GET /api/workflows`.
The catalog describes domain permissions. Available transport operations can be
narrower: MCP still cannot approve targets or verify fixes.

## Shared workflows

| Workflow | Transitions and rules |
| --- | --- |
| Capture jobs | Queued → running → completed or failed. User cancellation clears ownership. Resume queues failed, cancelled or queued jobs, or jobs with expired leases. A running worker cannot be replaced through Resume while its lease is valid. Completed jobs remain immutable. |
| Worker shutdown | Only the worker with the current token and valid lease can requeue its interrupted job. A cancelled job or a job now owned by another worker stays in that state. |
| Feedback | Open, in progress, submitted, verified or not planned. Existing destination transitions remain available under the same actor and evidence rules. Agents submit; people verify or decline. Revision checks remain mandatory. |
| Capture preparation | Editing → preparing → blocked or ready → starting → done. Uploading is a separate operation. Changes invalidate the plan. A stale-plan conflict returns to editing; ordinary failures allow retry. One prepared plan queues one job, including retries with different request keys. |
| Review attention | Derived from feedback, the exact target approval and available captures. It is not stored as another mutable status. |

Job reads expose `availableActions`. Task lists and handoffs expose a
`workflow.nextAction` with the submit tool, current revision and missing arguments,
or an instruction to wait for human review. These are read-time descriptions;
service-layer checks still decide each write.

## Inventory

| Area | State owner | Decision and behavior |
| --- | --- | --- |
| feedback | `src/store.mjs` (shared) | Open, in progress, submitted, verified or not planned; decisions and evidence stay distinct. |
| job | `src/automation.mjs` (shared) | Queue, lease, checkpoint, finish, cancel, interrupt and resume. |
| plan | `src/workspace.mjs` (shared) | Edit, prepare, resolve settings and explicitly start; each dialog session retains its project, capture and draft identity. |
| review-attention | `src/workspace.mjs` (derived) | Submitted fix, open feedback, proposed design, missing capture or ready; recomputed from records. |
| target-approval | `src/store.mjs` (derived) | Missing, proposed or approved for an exact capture and variant; revision-bound human decision. |
| task-claim | `src/automation.mjs` (derived) | Unclaimed, held, expired or released; ownership and time are separate from feedback status. |
| schedule | `src/automation.mjs` (local) | Disabled, waiting, due, claimed and advanced; revision binds interval and event cursors. |
| capture-attempt | `src/auto-capture.mjs` (local) | Plan, prepare, capture, report and clean up; result is captured, partial or failed. |
| application-capture | `src/auto-capture.mjs` (local) | Running, captured, partial, failed, empty or not selected. |
| readiness | `src/capture-scenarios.mjs` (local) | Unverified, passed or failed; browser readiness is not screenshot creation. |
| native-readiness | `src/native-contract.mjs` (local) | Wait for the matching request, screen, fixture and zero pending work; ready, error or timeout. |
| authentication | `src/capture-scenarios.mjs` (local) | Create context, authenticate, check readiness, export state and dispose. |
| coverage | `src/screen-inventory.mjs` (local) | Unresolved, missing, captured, failed or excluded; readiness and optional confidence remain separate. |
| fixture-boundary | `src/fixture-boundaries.mjs` (shared) | Idle, waiting, setting up, resetting, active, tearing down, failed and closed; cleanup remains due after partial setup failure. |
| managed-service | `src/capture-environment.mjs` (local) | Dependency wait, launch, readiness, runtime monitoring and shared cleanup; startup status and physical process phase remain distinct. |
| resource | `ui/lib/api.js` (reducer) | Idle, loading, ready, refreshing, failed or stale; old requests cannot replace newer results. |
| write-request | `ui/lib/api.js` (local) | New, in flight, uncertain, succeeded or rejected; retries retain the idempotency key after uncertain outcomes. |
| capture-image | `ui/components/CaptureImage.jsx` (reducer) | Loading, loaded or failed for one image identity; placeholder and delayed loading label are derived. |
| area-comparison | `ui/Comparison.jsx` (reducer) | Idle, selecting, selected or comparing; changing capture pairs clears the region. |
| annotation-gesture | `ui/components/AnnotationLayer.jsx` (reducer) | Idle, pointer drag or keyboard adjustment, then confirm or cancel; losing pointer capture cancels the unfinished drag. |
| pixel-measurement | `ui/Comparison.jsx` (local) | Idle, measuring, measured or failed; results belong to the exact pair, masks, threshold and region. |
| feedback-write | `ui/ReviewPanels.jsx` (local) | Compose, submit or fail; reopening waits for Undo and rolls back on failure. |
| evidence-form | `ui/ReviewPanels.jsx` (local) | Closed, editing or saving; kind, method and outcome determine required artifact fields. |
| review-set-form | `ui/components/ReviewSets.jsx` (shared) | Closed, editing, saving, conflict or loading latest; the user chooses the saved version or retained draft before retrying. |
| navigation | `ui/App.jsx` (reducer) | Project, session, set, screen and tab transition together; stale asynchronous navigation cannot replace a newer intent. Library and focus remain orthogonal. |
| command-dispatch | `ui/components/CommandMenu.jsx` (local) | Open, selected, closing, focus restored, then dispatch; cancelled navigation or a detached, hidden or disabled control cancels the action. |
| undo | `ui/lib/undo.jsx` (local) | Waiting, undone or committed; unmount cancels pending actions. |
| motion | `ui/lib/motion.js` (local) | Held, moving, interrupted or resting; reduced motion is a rendering preference. |
| standard-controls | `ui/components/ui/` (library) | Radix and Vaul own dialog, drawer, tab, toggle and focus transitions. |
| measurement-outcome | `src/diff.mjs` (immutable) | Measured or dimension mismatch; pixel evidence does not decide acceptance. |
| browser-observation | `src/evidence-tools.mjs` (shared) | Listening, collecting or disposed; reset and main-frame navigation invalidate an observation before it can attach to a screenshot. |
| ci-policy | `src/evidence-tools.mjs` (derived) | Passed, failed, pending or incomplete; explicit policy skips are separate from missing required observations and human acceptance. |
| evidence-outcome | `src/evidence-tools.mjs` (immutable) | Reported pass, fail or not run; CI completion and human acceptance are separate. |
| storage-operation | `src/storage-tools.mjs` (transactional) | Prepare assets, write immutable records, commit or roll back; retention follows reachability. |
| revision-conflict | `src/validation.mjs` (shared) | A stale write fails with 409; recovery identifies the record and requires reading and reconciling current state before retry. |
| pagination | `src/automation.mjs` (local) | Start, advance and exhaust a query-bound snapshot cursor. |
| server-lifecycle | `src/cli.mjs` (local) | Listen, run workers, receive shutdown, abort workers and close the registry. |

## Navigation and edit conflicts

Workspace navigation is one composite state: project, session, review set, screen,
view and tab. Changing a parent resets its dependent selections in one reducer
transition. Library visibility, search filters and focus stay independent. The
newest navigation intent owns pending lookups and view transitions. An older
lookup can complete its server operation, but cannot switch the UI after another
selection, opening a capture dialog or unmounting the workspace. Command dispatch
waits for successful navigation and re-checks the live control after the next
frame. Detached, hidden or disabled controls and removed select options cannot
execute a delayed command.

The review-set editor has closed, editing, saving, conflict and loading-latest
phases. A 409 keeps the draft and blocks another save with the same stale revision.
Load the saved version to compare it with the draft, then explicitly choose:

- **Use saved version** replaces the draft with the latest saved content.
- **Keep my draft for the next save** keeps local content and adopts the loaded
  revision for a subsequent, explicit save. It does not write immediately.

Any newer concurrent write can still reject that next save. Closing or unmounting
an editor invalidates its pending callbacks. A result from an earlier editor
cannot close a later one or change its selected review set.

Revision-conflict errors preserve HTTP 409 and add a code and recovery object.
For feedback, review sets and target approvals, recovery names the corresponding
read tool and arguments. Automation conflicts identify the record. Read current
state and reconcile before retrying with its expected revision. The API and MCP
still enforce the existing actor and evidence rules.

## UI changes

- Capture preparation uses one operation phase instead of separate plan, busy
  and error flags. The dialog snapshots its project, session and screen on open.
  Background refreshes cannot reset its draft or redirect an upload to another
  screen. Request ownership prevents late results from updating another dialog
  session or dispatching an action after the component unmounts.
- The recipe editor distinguishes empty, incomplete, raw and structured JSON.
  Partly edited recipes stay in the text editor without crashing the form fields.
  The service remains responsible for recipe acceptance; explicit invalid values
  do not silently select detected defaults.
- Resource reads distinguish initial loading, refresh with cached data, failure
  without data and stale data after a failed refresh. Superseded responses cannot
  replace newer data. Cancelling the current read ends its loading state.
- Image loading has one phase per capture URL and identity. An earlier image's
  completion cannot change the current image's phase.
- Area selection uses idle, selecting, selected and comparing phases. A pair
  change clears the region; cancel returns to the prior selection.
- Annotation gestures distinguish pointer dragging from keyboard adjustment.
  Losing pointer capture clears the unfinished drag. Pointer events cannot move
  a keyboard selection, and keyboard events cannot confirm an unfinished drag.
- Navigation and review-set editing use reducers rather than repeated groups of
  setters or unrelated busy, draft and error flags.
- Job buttons use the service's available actions. Labels, pending state and
  feedback closure rules come from the shared contract.

## Fixture and service lifecycle

Fixture boundaries serialize start, enter and close operations. Setup and reset
must succeed before the boundary becomes active. A failed run-level setup cannot
silently become usable on the next enter. Scenario and group boundaries can
recover by completing teardown and starting a fresh boundary. Partial setup still
requires teardown. Close is terminal; concurrent callers await the same cleanup
result, including an error. The epoch advances only after setup and reset succeed.

Managed services also share one cleanup promise. Their `status` records startup
readiness (`starting`, `ready`, or `failed`); `phase` records the physical lifecycle,
including stopping, stopped and stop failure. A service can have reached ready
successfully and later have stopped during normal cleanup. These facts remain
separate in reports.

## Browser observations and CI results

Browser evidence collection owns a generation and main-frame navigation identity.
Its phases are listening, collecting and disposed. Reset, disposal or navigation
invalidates an unfinished observation. The browser capture adapter checks the
same identity after screenshot creation. A changed observation fails that capture
attempt instead of attaching mismatched evidence. Registration of its derived
records, selector comments and accessibility report uses one registry transaction.

CI results derive passed, failed, pending or incomplete from the recorded checks
and policy. Explicit `failOnMissing: false` skips stay allowed. Incomplete required
accessibility results cannot count as a pass. A failure has priority over pending
work for the exit code, while completion remains a separate fact. Reports include
next actions and the original arguments for an explicit re-evaluation. Neither
the state calculation nor report export changes human acceptance.

The catalog treats CI evaluation as an immutable result, not a mutable job.
Detailed states and exit codes are in [Evidence tools](headless-evidence.md#ci-policies).

## Boundaries retained

No database migration is needed. Captures, runs and measurements stay immutable.
Existing persisted status names stay in use. Existing revision checks, evidence
requirements, source fingerprints and execution authorization remain in place. The capture
engine fingerprint includes the shared workflow contract and browser evidence
collector.
Import and discovery do not start capture commands. A ready app, measured pixel
match or passing CI report cannot approve a design or verify a fix.

The inventory records existing local lifecycle code without claiming that it has
all been replaced by shared reducers. This change does not establish exhaustive
runtime coverage or a no-regression result. Tests, builds and runtime validation
were not run for this work, in accordance with the repository instructions.
