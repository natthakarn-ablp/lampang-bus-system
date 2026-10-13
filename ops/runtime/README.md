# Supported Node runtime

The production host uses Node 20.20.2. Node's official release table marks
Node 20 as EOL on the audit date, 13 October 2026:
https://nodejs.org/en/about/previous-releases

Node 22 remains LTS. This rollout pins the official Linux x64 archive
node-v22.23.3-linux-x64.tar.xz to SHA-256
df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de,
read from the official HTTPS distribution manifest:
https://nodejs.org/dist/v22.23.3/SHASUMS256.txt

The owner-approved workflow covers the upgrade. Authentication is still
needed for root-owned /opt, /usr/local/bin and the systemd drop-in. Do not
restore NOPASSWD ALL or Docker membership to get around this requirement.
Never transmit the owner's sudo password through chat.

Before execution: verify the staged archive, run source unit tests using
its Node binary and complete full CI on Node 22. Pin the reviewed release.
Copy the installer into a protected root directory and validate its own
reviewed checksum before executing it with that full release SHA.

The installer keeps the packaged /usr/bin/node unchanged, preserves prior
settings and PM2 state in /root/schoolbus-node22-20261013, creates a fresh
verified database backup, and deploys only through the approved external
deploy script. Project commands run as schoolbus. The systemd drop-in
fixes the runtime path for startup; both backend and the PM2 daemon must
prove the new binary is running. No host reboot is needed.

Failed installation attempts restore only the runtime link/drop-in changed
by that operation. Code/dependency rollback is owned by the deploy script.
On a later failure after deployment, the CI/operator release may remain
checked out because its application source is unchanged. Inspect the
protected operation log and /health before retrying; do not claim success
from the presence of installed files.

Manual rollback requires owner password sudo. Restore the saved node link
(or remove the new link only if it points to this pinned runtime), remove
this operation's unchanged systemd drop-in, reload systemd and restart PM2.
Confirm connected database and running commit/version. Keep the root-owned
runtime directory and backups until the rollback window is closed.
