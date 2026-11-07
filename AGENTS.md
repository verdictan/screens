# Screens

Build a local-first registry that keeps design targets, implementation evidence,
and human decisions distinct. Read README.md and docs/architecture.md first.

- Prefer Node's built-in APIs. Sharp is the pinned raster decoding/diff dependency.
- Run tests and validation only when explicitly requested, required by higher-priority instructions, or required by configured commit hooks.
- Captures and comparison runs are immutable. Never overwrite evidence.
- Bind notes and approvals to capture IDs, never mutable file paths.
- Use expected revisions for mutable records. A stale update must fail with 409.
- Keep web UI and MCP operations on the same service layer.
- Do not claim a fixture capture proves live-account behavior or native correctness.
- Never execute project-provided capture commands implicitly during import.
- Never commit screenshots, runtime databases, credentials, or local absolute paths.
- MCP tools can submit fixes. They cannot approve targets or verify fixes.
- Keep future work explicit in docs/roadmap.md. Do not represent planned features as working.

## Screens review

For Screens capture and review tasks, read [.screens/AGENTS.md](.screens/AGENTS.md).
