# Encrypted offhost snapshot tools

These opt-in tools prepare an encrypted snapshot and copy only ciphertext to the
existing Drive storage. They do not install a timer, generate a production key,
change the backend, or replace the existing database backups. No production
snapshot has yet been uploaded using these tools. Publishing the scripts is not
evidence of a complete disaster recovery rehearsal.

## Before production enrollment

The owner must identify two locations they can access if the production server
or their main computer fails. Use an existing USB/disk or password vault, without
buying storage or opening billing. Generate a dedicated age identity on the
owner's protected computer, keep its independent second copy there, and prove
both copies can decrypt a synthetic fixture before enrollment. Never upload an
identity to the server, Drive beside the ciphertext, GitHub, or chat.

Only a public age recipient and a public custody receipt go to the server. The
receipt must have exactly these fields:

```json
{
  "recipient_public_sha256": "<SHA256 of the exact public recipient file>",
  "owner_identity_restore_verified": true,
  "independent_identity_copy_verified": true,
  "verified_at": "<timezone-qualified ISO timestamp>"
}
```

Record the receipt SHA and recipient SHA separately in the owner's trusted
record. The receipt represents a completed owner check; creating JSON with
these booleans does not perform that check. These scripts share the server's
Unix user with the backend and do not protect against compromise of that user.
Do not choose custody, fabricate a receipt, or create the production key while
the owner's location decision remains pending.

## Sealing and copying

`seal-full-backup.py` accepts only a private snapshot immediately under
`/home/schoolbus/backups`, named `backup-*`, with exactly eight artifacts and
`SHA256SUMS`. All files must be owned by the current user, mode 600, regular and
not hardlinked; the directory must be mode 700. Artifacts are `database.sql`,
`backend.env`, `uploads.tar.gz`, `pm2-processes.json`, `db-backup.env`,
`rclone.conf`, `nginx-schoolbus.conf`, and `nginx-schoolbus-503200.conf`.
The manifest must cover all eight. The tool hashes opened file descriptors,
streams a nine-entry tar.gz archive to age, and publishes `COMPLETE` only after
successful encryption. It binds encryption to the public recipient bytes that
passed the supplied SHA check. It never needs an identity on the server.

Use a fresh `snapshot-YYYYMMDDTHHMMSS` output below
`/home/schoolbus/backups/full-system-encrypted`. Existing output is refused;
inspect any partial directory instead of blindly retrying. Source size is capped
at 512 MiB and the copier refuses ciphertext above 64 MiB. Increase neither cap
without reviewing the current storage and restore plan.

`copy-sealed-backup.py` requires the completed package, the trusted custody
receipt SHA, and the recipient SHA. It checks strict metadata and exact file
allowlists, freezes only validated ciphertext/hash/metadata, and copies them to
`gdrive:lampang-bus-backups/full-system/<snapshot-name>` using the existing
rclone configuration. A known sufficient quota is required; insufficient or
unknown capacity stops the operation without purchasing anything. A private
upload lock prevents overlap, and a pending deploy lock refuses the upload.
Use a fresh readback directory below
`/home/schoolbus/backups/full-system-readback`. The CLI uses umask 077.

The copier uses directory `copy` with anchored single-file filters, `--immutable`
and `--checksum`. In the tested rclone 1.75.0 local backend, `copyto --immutable`
overwrote a conflicting fixture; the directory-copy form refused it and kept
the previous bytes. Do not substitute `copyto`, `sync`, or `delete`.
Ciphertext, checksum and metadata are read back and compared byte for byte
before the remote `COMPLETE` marker and local `UPLOAD_VERIFIED.json` receipt
are created. No sharing settings change. This is not WORM storage: an authorized
Drive user can still remove files. A failed readback is incomplete evidence even
if the original upload returned success.

## Owner verification

On Windows, `verify-encrypted-backup-owner.ps1` takes `CipherPath`,
`IdentityPath`, `ExpectedPlainSha256` and `ExpectedCipherSha256`. Use the trusted
expected hashes, not unverified metadata fetched beside a potentially changed
ciphertext. It pins age 1.3.2, rejects broad identity ACLs, checks ciphertext SHA,
and hashes the authenticated decrypted stream in memory without writing
plaintext to disk. Its optional `AgeExecutable` argument locates the same pinned
binary elsewhere. Default: the owner's profile `.codex/tools/age/v1.3.2/windows/age/age.exe`.
Success proves the archive stream and key work; it does not prove a whole-server
restore, RPO/RTO, or PDPA compliance. Root-only SSL keys, schema operator
credentials and OS state are not part of this eight-artifact snapshot.

## Pinned tools and repeatable tests

Production Linux age path: `/home/schoolbus/deploy-state/age-v1.3.2/age/age`.
Executable SHA: `eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c`.
Production rclone path: `/home/schoolbus/.local/bin/rclone`, version 1.75.0.
Executable SHA: `f3f9aff817f9766029e50adf9a7963c169e475b8f10c7927823568a0d9443db7`.
Windows age executable SHA:
`2821a4ed191da07372acd302e5f6feae7a7985e285e1417765ebe74025af45f0`.
Archives are pinned to official release asset SHA256 digests. Sigsum verification
has not been performed; do not describe SHA pinning as Sigsum verification.

Run `bash ops/backup/run-synthetic-tests.sh` on Linux x86_64. It downloads pinned
public CLI archives into a private temporary directory, or uses the explicit
`AGE_TEST_BIN`, `AGE_TEST_KEYGEN`, `RCLONE_TEST_BIN` test-only paths. Actual age
and the actual rclone local backend run against temporary synthetic files; no
production snapshot, credentials, preexisting proof files or Drive writes are
needed. Fixture keys and artifacts are removed on exit. Those test-only tool
variables do not alter the production CLI's fixed tool paths and hashes.
Backup Python and PowerShell sources are explicitly LF in `.gitattributes` so
Windows exports preserve the same bytes and helper fingerprints as Linux.
Verify exported helper SHA256 and Git blob IDs before staging a reviewed release.

On Windows PowerShell 5.1, run `test-owner-stream.ps1` with the reviewed portable
Windows age binaries installed. It generates its own private temporary identity
and synthetic ciphertext, then checks roundtrip, wrong hashes/key, tamper and
broad identity permissions. It removes only its own checked temporary directory.

The existing GitHub workflow uses standard `ubuntu-latest` runners in this public
repository. [GitHub's billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
states these runner minutes are free. This change adds no paid runner, billing
enrollment, hosted service, artifact storage upload, or production deployment.
