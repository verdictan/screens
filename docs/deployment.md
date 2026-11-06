# Local Docker deployment

Requires Docker Engine/Desktop with Compose v2. From this checkout:

```sh
docker compose up -d --build --wait
docker compose logs --tail=50 screens
```

Open http://127.0.0.1:4800. The service runs as the unprivileged node user with a
read-only application filesystem. SQLite, WAL files, images, diffs and evidence
artifacts persist in the `screens-data` named volume. Compose publishes the port
on host loopback only. Host/Origin checks remain enabled. This is a trusted local
service, without user authentication; public shared hosting is a separate milestone.

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
npm run skills:install -- --project /absolute/project --client both --runtime docker
claude mcp add --transport http --scope user screens http://127.0.0.1:4800/mcp
codex mcp add screens --url http://127.0.0.1:4800/mcp
```

The installed helper mounts input files read-only and uses Compose for load,
compare, diff, evidence and stdio MCP. `serve` starts Compose. `pr-context` uses
the host's authenticated `gh` so credentials are never copied into the image.
Build/start Compose before asking the skill to import. The helper does not silently
build a container while executing an MCP request.

## Stop, upgrade and backup

`docker compose down` stops the service and retains the data volume. Do not use
`down -v` unless deleting the registry is intended. Rebuild with
`docker compose up -d --build --wait` after pulling changes.

For a consistent backup, stop the service and every agent/writer first. Copy the
entire `/data` directory from the stopped container with `docker compose cp`,
then start it again. For example, with a new destination directory:

```sh
docker compose stop
docker compose cp screens:/data ./screens-backup
docker compose start
```

Keep the backup private; it includes screenshots, reports and recordings. Restore
the whole data directory into an empty volume while writers are stopped, retaining
ownership for UID/GID 1000. Schema v2 is additive to v1; back up before upgrading.
Older binaries must not open a registry upgraded by v0.2.

## Deployment check

```sh
docker compose config --quiet
docker compose up -d --build --wait
node scripts/smoke-deployment.mjs write
docker compose restart
docker compose up -d --wait
node scripts/smoke-deployment.mjs read
```

The smoke check writes one clearly named deployment-check project and verifies it
survives restart. CI runs this workflow in an isolated Compose project.

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

The image includes Chromium and Git for explicit browser captures. Configuration
and source mounts stay read-only; the capture output directory must be writable by
the container user (UID 1000). Never use the service as a public execution endpoint.
