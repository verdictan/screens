# Storage and portable evidence

These commands run without the review interface. They use the same registry as
other Screens commands. Pass `--data DIR` to select a registry. Filesystem,
backup, and signing commands are available only through the CLI.
`storage-report` is also available through MCP and the shared service.

## Portable review sets

```sh
screens bundle-export --review-set SET_ID --output review.screens.gz
screens bundle-import --file review.screens.gz --data ./imported-registry
```

A bundle contains the selected set and its complete immutable source run, even
when the set selects only some entries in that run. It includes the run's exact
captures, feedback, submitted-fix capture references, target decisions, pixel
measurements, semantic evidence, derived evidence, source links, run-linked CI
reports, and related
event records. Assets are embedded by SHA-256 address. The gzip file is portable;
it does not refer to the exporting computer's asset paths.

Import retains record IDs. An existing record with different content stops the
import with a conflict. Import never replaces a local approval or feedback
revision. Imported decision events retain their source event identity inside
`bundle.source-event` records. Reimporting the same bundle returns its import
receipt. Import is a deliberate CLI action; agents cannot import human decisions
through MCP.

The output file must not exist. Create a fresh bundle after changing a review set.

## Backups and restore

```sh
screens registry-backup --output ./backups/review-2026-11-07
screens registry-restore --source ./backups/review-2026-11-07 --output ./restored-registry
screens serve --data ./restored-registry
```

Create the parent directory first. Each backup and restore uses a new directory.
Backups use SQLite's online backup API, then copy the immutable assets referenced
by that database snapshot. The snapshot includes every registry table, including
queues, schedules, trusted signers, and derived evidence. The local signing
identity is copied with private file permissions when it exists. A `backup.json` manifest records the
database hash and asset inventory. Restore checks those addresses before copying.

Restore writes to a separate registry. It does not stop the current service or
replace its data. To use the restored data, start Screens with the new `--data`
path. Schedule `registry-backup` with the automation scheduler when periodic
backups are required; choose a unique output directory for every execution.

## Integrity and disk usage

```sh
screens registry-integrity
screens storage-report
```

The integrity command reports SQLite integrity errors, foreign-key errors,
missing local assets, asset hash differences, and missing capture references in
runs, notes, and diffs. It reports findings without changing the registry.
All assets remain in the local registry. Restore missing evidence from a registry
backup or a portable review bundle.

The storage report includes database size, total asset bytes, unreferenced bytes,
project totals, and the 50 largest local assets with their owners. Project totals
include shared assets for every project that references them, so their sum can
exceed the unique local asset total.

## Retention

```sh
screens retention-plan --older-than-days 30 --output retention.json
screens retention-execute --plan retention.json --execute yes
```

The plan lists only local assets with no capture, diff, or semantic-evidence
reference. It does not delete captures, runs, comments, or approvals. The executor takes a registry write transaction and checks each planned
asset's current references, size, and modification time. Referenced, changed, and
already missing files are skipped and reported. Execute only a plan you intend
to apply. Writers should use the shared transactional service when retention runs.

## Sign and verify bundles

Screens creates an Ed25519 identity on the first signing or public-key export
request. It uses Node's built-in cryptography. No key-generation tool, account,
server, or additional installation is required. The private key stays in the
registry's `signing/private.pem` file with mode `0600`.

```sh
screens bundle-sign --file review.screens.gz --output review.signature.json
screens signature-verify --file review.screens.gz --signature review.signature.json
screens bundle-import --file review.screens.gz --signature review.signature.json
```

The registry trusts its own signing identity. To share signed evidence with
another registry, export only the public key:

```sh
screens signing-key-export --output screens-public.pem
```

On the receiving registry, explicitly trust that public key before verifying:

```sh
screens signing-key-trust --file screens-public.pem --label "Design team"
screens signature-verify --file review.screens.gz --signature review.signature.json
```

Signature files contain the digest, public-key fingerprint, key type, and
signature. They do not add a signer to the trusted list. A successful verification
identifies the signing key and detects changes to the file. It does not establish
that an image shows live-account behavior or that a fix is accepted. The
`createdAt` field is descriptive metadata; the signature covers the file bytes.
Backups retain the signing identity and trusted signers. Portable review bundles
contain neither private keys nor trust settings.

Screens stores evidence locally. Remote object-storage commands and external
bucket configuration have been removed. Use portable bundles and local backups
to move or preserve evidence.
