# Docker deployment

Docker and Homebrew include the same Screens application, CLI, skills, pinned
runtime packages, Git, browsers, English OCR, and accessibility scanner. Docker
is optional. Apple capture requires a macOS host.

## Start

Requires Docker Engine/Desktop and Compose v2:

```sh
docker compose up -d --build --wait
docker compose logs --tail=50 screens
```

Open <http://127.0.0.1:4800>. Compose binds to loopback; keep that binding.
To change the port, set `SCREENS_PORT=4900` in `.env` and use it for both UI and MCP.
Screens has no account authentication. Do not expose it publicly.

The container runs as unprivileged `node` (UID 1000) with a read-only application
filesystem. `/tmp` holds browser caches/configuration; the `screens-data` volume
at `/data` holds the registry and evidence.

## Import

```sh
docker compose run --rm --no-deps -T \
  --volume /absolute/project:/input:ro \
  screens node src/cli.mjs load /input --project my-app
```

Mount the manifest directory and its images together. Imports never execute app
code. The host registry and Docker volume are separate; use container commands
or a Docker-configured helper to write to the container registry.

## Connect agents

```sh
npm run skills:install -- --project /path/to/app --client all --runtime docker
```

[Agent setup](agent-skills.md) explains generated connections and HTTP registration.
Pass the custom `--port` if used. Build the image before using the helper.
`pr-context` resolves GitHub metadata on the host; use `capture-refs` for Docker
captures. Capture outputs need a writable mount accessible to UID 1000.

## Update and back up

After pulling source changes:

```sh
docker compose up -d --build --wait
```

`docker compose down` stops Screens and retains its volume. Adding `-v` deletes
that volume. To export an online backup:

```sh
docker compose exec screens screens registry-backup --output /data/backup-new
docker compose cp screens:/data/backup-new ./screens-backup
```

Backups include evidence and an existing signing identity. See [Storage](storage-tools.md)
for restore and signature rules. Backup and restore destinations must be new.

## Deployment check

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose exec -T screens node scripts/smoke-deployment.mjs write
docker compose restart
docker compose up -d --wait
docker compose exec -T screens node scripts/smoke-deployment.mjs read
```

This writes a deployment-check project and checks restart persistence. The
[standalone proof](standalone-proof.md) exercises the full fixture review workflow
in isolated containers.

## SSH deployment

From a clean committed checkout, replace the example destination:

```sh
bash scripts/deploy-ssh.sh user@example.com 4900
ssh -N -L 4900:127.0.0.1:4900 user@example.com
```

Open <http://localhost:4900> and keep the tunnel active. The script archives the
exact commit, creates a release directory, builds with Compose, and checks
HTTP/MCP and restart persistence. The stable `screens` Compose project retains
its volume. Local databases and images are not copied; import evidence explicitly.

## Release parity

```sh
npm run release:package -- --output release
```

Release packaging builds the UI and archives the declared package files and
committed `package-lock.json`. Homebrew and Docker both run `npm ci --omit=dev`
and `scripts/bundle-runtime.mjs` through `postinstall`.

Playwright supplies pinned browser revisions; Dugite supplies platform Git.
The OCR worker, WASM core, English model, and axe-core come from the same lockfile.
Native binaries match each target OS and architecture. Runtime capture and OCR
do not download these dependencies.

Both distributions include the CLI, built UI, UI source, support scripts, skills,
examples, and Docker helper files. Homebrew uses the local registry; Docker uses
`/data`. Publishing is external to this repository; the GitHub validation workflow
does not publish releases.
