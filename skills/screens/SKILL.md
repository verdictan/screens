---
name: screens
description: Load a repository into the Screens visual review registry, compare current, target and PR captures, or address capture-bound feedback. Use for Screens picker requests, /screens load, /screens compare and /screens fix workflows. Do not use for unrelated screenshots or general image editing.
---

# Screens

Use the shared Screens registry. Keep current implementation, proposed or approved
target, and PR result distinct. Resolve this skill's directory from the file you
loaded. Set `SCREENS_HELPER` to its absolute `scripts/screens.mjs` path. Invoke
`node "$SCREENS_HELPER" help` first. The bundled helper reads screens-config.json
written by the installer; it uses the configured local registry or Docker volume.
If configuration is absent, set SCREENS_CLI to the known Screens checkout's
absolute src/cli.mjs path. Do not invent a checkout path or silently create a new
registry. Report a missing runtime as blocked with the installation command from
the Screens repository: `npm run skills:install -- --project PROJECT --client both`.
Never change the configured registry during an existing review.

Use `/screens load .` in Claude Code. In Codex invoke `$screens load .` (or select
Screens through the client's skill picker). Treat the request after the skill
name as the workflow arguments, not as an arbitrary shell command. Quote paths.

## Load a project

1. Identify the requested repository and read its agent instructions.
2. Find its stable registry project with `projects_list` or the helper’s `projects` command; reuse the ID. For a new project, derive a stable lowercase ID from its repository name and report it.
3. Run `node "$SCREENS_HELPER" load /absolute/project/path --project PROJECT_ID`.
   Recognized manifests: screens.json, docs/picks/manifest.json,
   .artifacts/ui-review/manifest.json and docs/routing-comparison/manifest.json.
4. If no manifest exists, inspect routes, stories and documented capture recipes.
   Prepare screens.json using the Screens repository's examples/screens.json. State
   discovered coverage and missing captures. Do not call route discovery full coverage.
5. Import existing evidence without executing capture commands. In Docker mode, use the helper for both load and serve so imports reach the same named volume. Start the review
   server if required with `node "$SCREENS_HELPER" serve` and open the returned run URL.
6. Report screen count and missing evidence. Imported captures retain unknown
   source revisions when provenance is unavailable. They are not fresh captures.

## Compare a PR

1. Resolve repository and PR number from the request.
2. Run `node "$SCREENS_HELPER" pr-context OWNER/REPO NUMBER --output NEW_CONTEXT_FILE`.
   This reads GitHub metadata; it does not build or capture the application.
3. Reuse capture evidence only if it matches the exact head and merge-base SHA,
   fixture, device, viewport, theme, locale and text scale.
4. When captures are missing, read the project's supported capture procedure.
   Run only authorized project commands in isolated checkouts. Follow its native
   capture requirements; never substitute a browser renderer for a native app.
   If execution is blocked, report the missing side and keep available evidence.
5. Import baseline, target and PR manifests. Run
   `node "$SCREENS_HELPER" compare --project PROJECT_ID --current BASE_RUN --target TARGET_RUN --pr PR_RUN --context CONTEXT_FILE`.
   CLI compare takes run IDs, not PR numbers. Omit an unavailable input; do not
   invent it. Reuse stable screen keys across revisions.
6. Open the comparison URL. Select Current/PR for change review or Target/PR for
   design matching. Label a design from the PR as proposed until approved.

## Address feedback

1. Use screens_search, screens_get and captures_view to read the issue and its
   actual original image. A filename alone is not visual evidence.
2. Read the implementation locations and approved target. There are no
   claim tools; coordinate file ownership explicitly with the active session.
3. Make the requested change, run checks required by the request or project instructions, and capture the same state.
4. Register fresh evidence with captures_register, including source revision,
   fixture and provenance. Submit with reviews_submit_fix using the note's latest
   expectedRevision and a concrete resolution.
5. On conflict, reload the note and reconcile. Never overwrite a newer review.
6. Leave acceptance to the reviewer. Do not use HTTP review endpoints to bypass
   the absence of approval/verification tools. Do not mark an unseen screen matched.

## Pixel and semantic evidence

Use `diffs_create` with left/right capture IDs, optional channel threshold (0–255),
and explicit integer-pixel masks. With no MCP connection, use the helper's
`diff --left ID --right ID --threshold 0 [--masks FILE]`. Read `diffs_view` to
inspect the lossless artifact. Never resize captures to hide a dimension mismatch.
Report fixture mismatch/unknown, masked count, threshold, and changed-pixel ratio.
A zero score is pixel evidence only; it does not prove behavior or acceptance.

Use `evidence_add` (or `evidence add FILE` through the helper) for visual, behavior,
accessibility or motion checks. Required fields: capture, kind, method, outcome,
assertion, procedure, observation, author. Method is manual, automated or screenshot;
outcome is pass, fail or not-run. Use not-run with an honest explanation when blocked.
Screenshots support visual checks only. Automated pass/fail requires artifactBase64
and artifactType (text/plain, application/json, video/mp4 or video/webm, up to 20 MB).
Record real commands/observations and attach real reports or recordings. Do not
invent artifacts. Evidence records are reporter-supplied and never an approval.

## Limits

Screens has no automatic capture runner, change-to-screen dependency map, claim leases,
background jobs or hosted authentication. Use documented CLI/MCP operations only.
Preserve old evidence and notes. Never infer a visual match from file hash changes.
