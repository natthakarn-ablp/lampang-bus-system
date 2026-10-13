# High-risk workflow execution — 13 October 2026

Owner approved the full workflow in the task. PR #4 merged into the production branch as `14f30bcaab72cb3be51bcbf72d31996c7e5a4a12`.

## Completed production operations (UTC)

| Time | Evidence |
|---|---|
| 10:04 | Verified database backup; exact DDL comparison for all five migration 050/051 tables. Reconciled two missing migration metadata rows, with no business-table/schema change. |
| 10:21–10:24 | Off-host copy and protected server-side readback verified by checksum, gzip and byte comparison. Dedicated restore recovered 66 tables and 11 aggregate counts matched; scratch database removed. |
| 14:12:39 | Fresh pre-release backup `lampang_bus_20261013_141239.sql.gz`, verified before deploy. |
| 14:12:41–14:13:45 | Approved external deploy script, unchanged SHA-256 `6a35438abf5d5ebb0776d5a44bc79f69f7106b5c1577208b443217d3e397c2dd`, deployed from a local immutable Git snapshot of the reviewed merge. Server 106 unit suites / 1902 tests passed; health proved `14f30bc` and connected database. |
| 14:15:10 | Frontend staged, checks/build passed, prior chunks preserved and directories exchanged atomically. Backup `backups/frontend-dist/dist.prev-20261013_141459`; previous dist retained in `deploy-state/frontend-stage-20261013_141459`. Public page/manual returned success. |
| 14:16–14:18 | Per-user key-only SSH syntax/effective settings checked, daemon reloaded, separate key login passed. Root-owned fixed-action sudo helper installed; arbitrary unattended root commands and Docker socket access denied. Password-based owner sudo remains. |
| 14:17 | Removed schoolbus from Docker group (no running containers), saved PM2 state and restarted its daemon to clear inherited Docker membership. Both backend and log rotation returned online. PM2 directory 0700 and saved dumps 0600. Protected recovery backup is `/root/schoolbus-hardening-20261013`. |
| 14:19 | Health smoke: 15 PASS, 1 historical baseline, 0 WARN/FAIL/SKIP. 45 migrations tracked, zero untracked/checksum drift; QR flags remain unset/off. |

The first SSH connection used during pin preparation reset before any backup/deploy occurred; the live release remained healthy. Resumed from the verified pin with keepalive and a server-side deploy log. No simultaneous deployment was started.

## Verification limits and remaining work

- Latest PR #4 CI passed on Linux/Node 20: 106 unit suites / 1902 tests; full test:ci 186 suites / 2822 passing tests and 2 explicitly skipped. Frontend and migration checks passed. Windows/Node 24 process crashes are not counted as test successes.
- Runtime npm audit returned zero findings in both packages. Full development-tool audit still reports findings (backend 34, frontend 8). Some require major toolchain changes or have no patched compatible release; no forced/downgrade remediation was applied.
- The app DB account is not root, has no global ALL PRIVILEGES and no GRANT OPTION. This bounded check does not prove every grant is minimal.
- Certificate renewal dry-run passed. Startup settings are enabled; a real reboot was not performed. No real LINE notification was sent in this audit.
- Technical alert configuration contains a token but no `TECH_LINE_TARGET_ID` or legacy target. Successful healthy timer runs therefore do not prove alerts can be delivered. The owner must identify a technical recipient separate from the emergency audience.
- Follow-up tests reproduced retry suppression after failed delivery of a new incident and lost recovery retries. The fix uses the last successfully delivered signature for debounce and retains failed recovery state for retry. Tests use synthetic credentials, fixed HTTP stubs and a disabled localhost endpoint; no production state or real recipient is involved.
- DPO/legal basis, retention, incident owner and RPO/RTO remain human decisions. Off-host storage currently works, but its shared Drive OAuth client retirement warning requires a dedicated owner-authorized OAuth client.

This execution record is not a PDPA certification or a guarantee that every risk is closed.
