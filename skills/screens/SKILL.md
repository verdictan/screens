---
name: screens
description: Load a repository into the Screens visual review registry, compare current, target and PR captures, or address capture-bound feedback. Use for Screens picker requests, /screens load, /screens compare and /screens fix workflows. Do not use for unrelated screenshots or general image editing.
---

# Screens

Use the shared Screens registry. Keep current implementation, proposed or approved
target, and PR result distinct. Read the installed CLI's `help` before unfamiliar
operations. Require `SCREENS_CLI` to identify the absolute `src/cli.mjs` path, or
locate it in the user's known Screens checkout. Use one `SCREENS_HOME` for every
client and the picker. Never guess a new data directory during an existing review.

## Load a project

1. Identify the requested repository and read its agent instructions.
2. Find its stable registry project with `projects_list`; reuse the ID.
3. Run `node "$SCREENS_CLI" load /absolute/project/path --project PROJECT_ID`.
   Recognized manifests: screens.json, docs/picks/manifest.json,
   .artifacts/ui-review/manifest.json and docs/routing-comparison/manifest.json.
4. If no manifest exists, inspect routes, stories and documented capture recipes.
   Prepare screens.json using the CLI repository's examples/screens.json. State
   discovered coverage and missing captures. Do not call route discovery full coverage.
5. Import existing evidence without executing capture commands. Start the review
   server if required with `node "$SCREENS_CLI" serve` and open the returned run URL.
6. Report screen count and missing evidence. Imported captures retain unknown
   source revisions when provenance is unavailable. They are not fresh captures.

## Compare a PR

1. Resolve repository and PR number from the request.
2. Run `node "$SCREENS_CLI" pr-context OWNER/REPO NUMBER --output NEW_CONTEXT_FILE`.
   This reads GitHub metadata; it does not build or capture the application.
3. Reuse capture evidence only if it matches the exact head and merge-base SHA,
   fixture, device, viewport, theme, locale and text scale.
4. When captures are missing, read the project's supported capture procedure.
   Run only authorized project commands in isolated checkouts. Follow its native
   capture requirements; never substitute a browser renderer for a native app.
   If execution is blocked, report the missing side and keep available evidence.
5. Import baseline, target and PR manifests. Run
   `node "$SCREENS_CLI" compare --project PROJECT_ID --current BASE_RUN --target TARGET_RUN --pr PR_RUN --context CONTEXT_FILE`.
   CLI compare takes run IDs, not PR numbers. Omit an unavailable input; do not
   invent it. Reuse stable screen keys across revisions.
6. Open the comparison URL. Select Current/PR for change review or Target/PR for
   design matching. Label a design from the PR as proposed until approved.

## Address feedback

1. Use screens_search, screens_get and captures_view to read the issue and its
   actual original image. A filename alone is not visual evidence.
2. Read the implementation locations and approved target. In v0.1 there are no
   claim tools; coordinate file ownership explicitly with the active session.
3. Make the requested change, then run project checks and capture the same state.
4. Register fresh evidence with captures_register, including source revision,
   fixture and provenance. Submit with reviews_submit_fix using the note's latest
   expectedRevision and a concrete resolution.
5. On conflict, reload the note and reconcile. Never overwrite a newer review.
6. Leave acceptance to the reviewer. Do not use HTTP review endpoints to bypass
   the absence of approval/verification tools. Do not mark an unseen screen matched.

## Limits

v0.1 has no automatic capture runner, change-to-screen dependency map, claim leases,
background jobs or hosted authentication. Use documented CLI/MCP operations only.
Preserve old evidence and notes. Never infer a visual match from file hash changes.
