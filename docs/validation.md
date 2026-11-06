# Initial validation

The initial implementation was checked in the task workspace on 6 November 2026.

- Main automated suite: registry persistence and immutable IDs, capture anchor
  preservation, stale update rejection, same-screen evidence rules, approval
  revisions, import containment, comparison roles, MCP images and errors, HTTP
  request handling, direct stdio MCP subprocess.
- Syntax checks cover all JavaScript modules. Bundled skill metadata is checked.
- Real input imports: 121 Kalkidan screens / 209 captures and 11 console routing
  screens / 66 captures. The console run has 22 screen/variant comparisons.
- Historical source revisions remain unknown where the input did not supply them.
- Real TCP integration was attempted and blocked with `listen EPERM` on loopback.
  In-process HTTP handler checks do not replace the live integration suite.
- Browser interaction, visual review and real Claude/Codex client connection have
  not been verified. Run these before shipping.
- GitHub creation was initially blocked by shell network access and browser
  sign-in. The user subsequently created the private verdictan/screens repository.
  The implementation can be published through the GitHub connector. Local writes
  to the user's Work checkout remain blocked by this task's filesystem permissions.
