# Local Docker deployment

Docker is an optional distribution of Screens. It includes the same application,
CLI commands, agent skills, pinned runtime dependencies, bundled Git, browser
engines, English OCR, accessibility scanner, signing, and local job service as
the Homebrew package.

Requires Docker Engine/Desktop with Compose v2. From this checkout, run:

```sh
docker compose up -d --build --wait
docker compose logs --tail=50 screens
```

Open http://127.0.0.1:4800. The service runs as the unprivileged node user with a
read-only application filesystem. SQLite, WAL files, images, diffs and evidence
artifacts persist in the `screens-data` named volume. Compose publishes the port
on host loopback only. Host/Origin checks remain enabled. This is a trusted local
service, without user authentication; public shared hosting is a separate milestone.

Browser configuration and cache files use the writable `/tmp` mount. They do not
write into the read-only application or home directory. Registry evidence remains
in the persistent `/data` volume.

To change the port, set `SCREENS_PORT=4900` in a local `.env` file before starting.
The container and published port use the same number so Host/Origin checks agree.
Use that port for the picker and MCP URL. Do not override the loopback port binding.

## Import into the container's registry

```sh
docker compose run --rm --no-deps -T \
  --volume /absolute/project:/input:ro \
  screens node src/cli.mjs load /input --project my-project
```

Mount the directory containing the manifest and its referenced captures. The
importer never executes code from that mount. The host's default Screens database
and the Docker volume are separate: use the command above or a Docker-configured
skill for every import. Do not import on the host and expect the container to see it.

## Agent setup

```sh
npm run skills:install -- --project /absolute/project --client all --runtime docker
claude mcp add --transport http --scope user screens http://127.0.0.1:4800/mcp
codex mcp add screens --url http://127.0.0.1:4800/mcp
```

Other agents can use the generated `.screens/` connection files or CLI guide; see
[agent setup](agent-skills.md). Pass `--port` to the installer when using a custom port.

The installed helper mounts input files read-only and uses Compose for load,
compare, diff, evidence and stdio MCP. `serve` starts Compose. `pr-context` reads GitHub metadata directly through the API. Set `GITHUB_TOKEN`
for private-repository access; GitHub CLI installation is not required.
Build/start Compose before asking the skill to import. The helper does not silently
build a container while executing an MCP request.

## Stop, upgrade and backup

`docker compose down` stops the service and retains the data volume. Do not use
`down -v` unless deleting the registry is intended. Rebuild with
`docker compose up -d --build --wait` after pulling changes.

Use the same backup command in either distribution. In Docker, write into the
persistent data volume, then copy the completed backup out:

```sh
docker compose exec screens screens registry-backup --output /data/backup-new
docker compose cp screens:/data/backup-new ./screens-backup
```

Backups include screenshots, reports, recordings, and the signing identity when
one exists. Restore with `screens registry-restore --source BACKUP --output NEW_DIR`.
The destination must be a new directory and writable by the container user.

## Deployment check

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose exec -T screens node scripts/smoke-deployment.mjs write
docker compose restart
docker compose up -d --wait
docker compose exec -T screens node scripts/smoke-deployment.mjs read
```

The smoke check writes one clearly named deployment-check project and verifies it
survives restart. CI runs this workflow in an isolated Compose project.

For browser capture, feedback, fix submission, approval and restart proof without
CI, use the [standalone Docker proof runner](standalone-proof.md).

## SSH deployment

From a clean, committed checkout with SSH access:

```sh
bash scripts/deploy-ssh.sh dennisotugo@192.168.1.142 4900
ssh -N -L 4900:127.0.0.1:4900 dennisotugo@192.168.1.142
```

Open http://localhost:4900. Port 4900 keeps the remote deployment separate from a
local Screens instance on 4800. The script archives the exact Git commit, writes a
new release directory, builds with Compose, and checks HTTP/MCP plus persistence
across restart. The stable `screens` Compose project retains its named volume.
It never copies local databases or screenshots. Import project evidence explicitly
after deployment. Keep the SSH tunnel active; no public HTTP port is opened.

Both distributions install Chromium, Firefox, WebKit, and Git from the same
pinned npm dependencies. Native binaries match the target OS and architecture;
they are not copied between platforms. Configuration
and source mounts stay read-only; the capture output directory must be writable by
the container user (UID 1000). Never use the service as a public execution endpoint.

## Release parity

Both releases run `scripts/prepare-release.mjs`, which builds the UI and copies
`package-lock.json` to `npm-shrinkwrap.json`. The npm `prepack` hook runs this step
for the Homebrew archive. Docker runs it in its build stage.

The shrinkwrap is included in both releases and pins the installed dependency
tree. Homebrew consumes it with `npm install --omit=dev`; Docker consumes it with
`npm ci --omit=dev`.

Both installation paths run `scripts/bundle-runtime.mjs` through `postinstall`.
It installs the browser revisions selected by the pinned Playwright package.
Dugite installs the matching platform Git, and the OCR worker, WASM core, English
model, and axe-core come from the locked dependency graph. Runtime commands use
these package-local components.

Docker includes the public support scripts, skills, examples, documentation, and
built UI supplied in the npm release. Both packages also include the UI source,
Dockerfile, Compose file, and build configuration used by the Docker agent helper.
The `screens` command is available in both.
Persistent data locations differ: Docker uses its `/data` volume; Homebrew uses
the local registry. Each runs the same `serve` command and managed local services.

Release jobs must run `npm pack` with lifecycle scripts enabled so `prepack`
includes the current UI and dependency snapshot. Publishing runs outside this
repository; `.github/workflows/validate.yml` does not publish release packages.
