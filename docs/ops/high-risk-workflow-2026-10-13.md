# High-risk workflow — 13 October 2026

The system owner approved execution through testing, backup, deployment and access hardening on 13 October. This record contains aggregate evidence only. It does not attest legal compliance or replace DPO decisions.

## Reviewed changes

- Optional QR authentication now observes the existing per-user session-reset sentinel, including the same-second cutoff. Revoked staff credentials fall back to anonymous access; independently verified LINE identities remain supported. QR flags remain disabled in production.
- Migration 050/051 preflight requires a recent backup, its checksum and a valid gzip stream. The existing explicit emergency bypass remains operator-controlled.
- Restore drills reject unsafe database identifiers and refuse cloning scheduled events onto a host with an enabled scheduler. Future drills containing events must use a separate MySQL instance.
- Cancellation audit records keep `check_date` as the Bangkok calendar date. Existing historical audit records are not rewritten.
- Compatible runtime dependency lockfile updates address the advisories reported by the registry on the review date. Backend and frontend runtime audit returned zero findings after updating; this is not a claim that no vulnerability exists.
- DPIA teacher permissions reflect the deployed teacher check-in feature. Legal basis, retention, research release review and DPO approval remain unresolved decisions in the draft.
- Fixed-action, root-owned maintenance helper and per-user key-only SSH policy are supplied under `ops/security`. Their installation requires syntax checks, protected backups and a separate successful key-only connection before broad unattended sudo access is removed.

## Production recovery evidence

Baseline running release: `d8647e1013758e3e5ceaeaa2c1be62301734b0fc`. Repository origin was one documentation-only commit ahead (`2c753da`).

Backup `lampang_bus_20261013_100447.sql.gz`: checksum, gzip and dump plausibility passed. A protected server-side restore into the dedicated drill database restored 66 tables; counts of 11 key tables matched. The temporary database was removed. Five seconds measured the streaming restore step, not whole-service recovery time or an agreed RTO.

The dump contained an enabled event and the host scheduler was ON. Original event metadata was unchanged after the drill. The new guard blocks this combination in future; do not disable the live scheduler merely to bypass the guard.

The named backup and checksum were downloaded back from the configured off-host Google Drive destination into a private server directory. Checksum, gzip and byte-for-byte comparison passed. No dump was copied into local reports. Rclone warns that its shared Drive OAuth client is being retired: the owner must supply/authorize a dedicated OAuth client before the shared client stops working.

Certbot renewal dry-run succeeded for the public domain and www. Nginx, MySQL and PM2 are configured to start automatically. Monitoring timers are active; successful completed oneshot services may correctly be inactive between runs.

## Release and rollback gates

1. Complete regression checks against the disposable local test database, dependency audit and frontend build; review the final diff and exact commit.
2. Create a fresh verified database backup and preserve the current frontend build. Confirm the production branch points to the reviewed commit and the external deploy script matches its reviewed checksum.
3. Deploy backend only through `/home/schoolbus/deploy-state/deploy-backend.sh`. Its lock, dependency staging, unit tests and exact-commit health check provide a rollback path.
4. Stage frontend from the same commit outside the live `dist`, preserve manual links and prior asset hashes for already-open browsers, then switch with a recorded rollback directory.
5. Validate the public page, asset fetches, protected endpoints, connected database and deployed commit. Do not run test-database reset commands on production.
6. Validate access policy syntax and a separate SSH key session before removing broad unattended sudo rights. Keep owner password-based sudo recovery.

Completion evidence and timestamps must be recorded after the actual operations. No fabricated release, incident notification or DPO signatures are implied by this plan.

## Remaining owner decisions

- Complete the marked DPO/legal decisions and assign accountable owners; approve data retention and the research/publication review process.
- Set business RPO/RTO and an incident response owner. The restore measurement above does not determine acceptable loss or downtime.
- Configure a dedicated Drive OAuth client. Actual off-host copy and readback currently work, but the provider retirement warning is actionable.
- Review host administration groups. Docker is running even though there are no running containers, and membership in its group provides an additional privileged path; removing a sudo rule alone is not proof of complete host least privilege.
