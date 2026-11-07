# Screens

**See what your app looks like, explain what needs to change, and review the result.**

Screens is a review board for your app's screenshots. It runs on your computer
and opens in your web browser.

You can:

- Compare how a screen looks now with how you want it to look.
- Click a screenshot and leave a comment, such as “Make this button smaller.”
- Ask your AI coding assistant to make the change and add a new screenshot.
- Review the new version and decide whether the change is complete.

Screens keeps earlier screenshots and comments, so you can see what changed.
A matching screenshot does not prove that every button or feature works.

## Get started with your AI assistant

If you already use an AI coding assistant that can work with files and run commands,
open your app's project and give it this request:

> Install Screens from https://github.com/verdictan/screens, connect it to this
> project, and start the review page. Load any existing screenshots and tell me
> which screens still need screenshots.

Setup includes instructions for Claude Code, Codex, Cursor, GitHub Copilot,
Gemini CLI, and OpenCode. Other assistants can use the included connection guide.
An ordinary chat window without access to your files or tools cannot set it up.

## Set it up yourself

### 1. Install the required tools

You need **Node.js 22.22.2 or newer**, including npm, and **Git**.
Node.js runs Screens. Git downloads its files. If you are unsure whether these
are installed, ask your AI assistant to help with this step.

### 2. Download and start Screens

Open **Terminal** on macOS or Linux, or **PowerShell** on Windows.
Run these two commands, one at a time:

```sh
git clone https://github.com/verdictan/screens.git
cd screens
```

Then run the command for your computer:

**macOS or Linux**

```sh
bash install.sh --start
```

**Windows**

```powershell
powershell -File install.ps1 --start
```

The first setup downloads the software Screens needs, so it can take a few minutes.

### 3. Open the review page

Open **[http://127.0.0.1:4800](http://127.0.0.1:4800)** in your browser.
This address points to your own computer.

Keep the terminal window open while using Screens. Press **Ctrl+C** in that
window to stop it. Your saved screenshots and comments remain available.

The board starts empty. Installing Screens does not automatically take screenshots
of your app.

### 4. Connect your app

Your app's project folder is the folder that contains its code. Open another
terminal in the downloaded `screens` folder and run:

```sh
node scripts/setup.mjs --project "/path/to/your-app"
```

Replace `/path/to/your-app` with the full location of your app's folder. Keep the
quotation marks, especially if the folder name contains spaces.

Restart your AI coding assistant in your app's project, then ask:

> Use Screens to load this project. Show me the available screenshots and explain
> what is missing.

If there are no screenshots yet, ask your assistant to help prepare them.
Taking new screenshots may need extra setup for your particular app.

## Command shortcuts

After connecting your app, type these shortcuts in your AI assistant's chat.

| What you want to do | Claude Code | Codex |
| --- | --- | --- |
| Load this project's screenshots | `/screens load .` | `$screens load .` |
| Review a proposed code change | `/screens compare PR 123` | `$screens compare PR 123` |
| Work on screenshot feedback | `/screens fix the feedback on the login screen` | `$screens fix the feedback on the login screen` |

The dot means the current project folder. Replace `123` with your GitHub pull
request number, and replace `login screen` with the screen you want to fix.
A pull request is a proposed set of code changes.

These shortcuts ask your assistant to follow the Screens workflow. Enter them
in its chat, not in Terminal. Loading uses existing screenshots; taking new ones
may need extra setup. You still review and accept the result yourself.

Other assistants have different ways to open skills. You can ask in plain language:

> Use Screens to load this project, compare the screenshots for pull request 123,
> or work on the feedback I left on the login screen.

Choose the task you need from that example. If the assistant cannot find Screens,
ask it to read `.screens/AGENTS.md` in your app's project folder.

## Your review process

1. **Choose a screen.** Open it in the review page.
2. **Compare versions.** Look at the current screen, the intended design, or a proposed change.
3. **Leave feedback.** Click a screenshot and describe what needs to change.
4. **Ask your assistant to fix it.** It can make the code change and add a fresh screenshot.
5. **Review the result.** You decide whether to accept the design or mark the fix as verified.

## Open Screens again later

From the downloaded `screens` folder, run:

```sh
node .screens/scripts/screens.mjs serve
```

Then open **[the review page](http://127.0.0.1:4800)** again.

## More help

- [Connect an AI assistant](docs/agent-skills.md) — including assistants that do not find Screens automatically.
- [Setup options and detailed usage](docs/usage.md) — different folders, ports, and screenshot imports.
- [Docker setup](docs/deployment.md) — an optional way to keep Screens running in the background.
- [Review evidence](docs/evidence.md) — attach reports and recordings as well as screenshots.
- [Tests and coverage](docs/testing.md) — run the complete checks and open the coverage report.
- [Planned features](docs/roadmap.md) — what is still being developed.

Screens is intended for use on your own computer. It has no account sign-in,
so do not make it publicly accessible on the internet.
