# Screens

**Compare screenshots. Leave feedback. Review the fix.**

Screens is a local review board for your app. Compare the current screen with
its design, mark what needs to change, and ask your AI assistant to fix it.
You review the result.

![Screens demo: compare designs, mark feedback, and review a fix](docs/assets/product-demo.gif)

Actual Screens interface with sample data.

## Get started

```sh
brew install verdictan/tap/screens
screens serve
```

Open [localhost:4800](http://127.0.0.1:4800). Press Ctrl+C to stop; your data stays
saved. To run at login, stop the foreground process and use
`brew services start screens`.

Screens includes Git, Chromium, Firefox, WebKit, English OCR, and accessibility
scanning. Docker and a cloud account are optional.

For source or Windows installation, see [Using Screens](docs/usage.md#install).
To connect an AI assistant, see [Agent setup](docs/agent-skills.md).

## Capture your app

```sh
screens capture-draft /path/to/app --output capture-plan.json
screens capture-auto /path/to/app --plan capture-plan.json
```

Review the draft and fill in missing settings before capture. Screens can start
supported frontends and capture desktop, tablet, and phone layouts. Xcode apps
use native Mac windows or iPhone and iPad simulators.

The result includes a review link, readiness results, and any coverage gaps.
Discovery cannot enumerate every runtime state. See [Automatic capture](docs/automatic-capture.md)
for services, fixtures, login, native states, and resume.

## Review

1. Compare the current screenshot with its target.
2. Click a point or select an area to leave feedback.
3. Ask your assistant to fix it and submit a fresh capture.
4. Review the evidence and verify the fix.

Use review sets to follow a flow, or compare a selected area. Earlier comments
stay attached to their original captures. [Review controls](docs/usage.md#review)
explains the keyboard and area-selection controls.

## Develop

```sh
npm ci
npm run dev
```

Open [localhost:5170](http://127.0.0.1:5170). Vite reloads UI changes; API changes
restart the backend on port 4801. See [development settings](docs/usage.md#develop).

## Documentation

[All guides](docs/README.md) · [CLI and jobs](docs/headless.md) ·
[Docker](docs/deployment.md) · [Architecture](docs/architecture.md) ·
[Roadmap](docs/roadmap.md)

Screens has no account authentication. Keep its service local.
