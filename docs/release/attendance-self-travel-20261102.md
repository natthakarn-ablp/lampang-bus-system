# Independent travel and attendance statistics

Status: source review/testing; not yet deployed. No production attendance test writes or LINE messages.

School and assigned-grade classroom attendance may record SELF for the selected morning (มาเอง) or evening (กลับเอง), separately from LEAVE and bus attendance. Grade/school boundaries remain enforced. Grade teachers can undo only their own current-day SELF records; full-school accounts remain limited to their own school. Driver/transport/report permissions are not expanded.

The shared pupil lock prevents a bus tap and SELF record from both winning. SELF is never a bus boarding/dropoff, never changes daily service preferences, and never generates a check-in notification. Overlapping leave/SELF is refused; cancellation preserves the historical row and audit. Creation is temporarily refused while the existing production deployment lock is held, preventing a frontend publication/rollback window from creating the first SELF rows before the guarded release completes.

## Statistics

- Separate morning/evening SELF, LEAVE, bus completion and pending counts. SELF/LEAVE do not increase bus completion or pending counts.
- Monthly counts are date/session occurrences plus distinct pupil counts for each category/session. One pupil arriving independently five days is5 occurrences/1 person. An exception-only date is included.
- KPI denominator excludes SELF/LEAVE; no bus opportunities means no bus percentage, not100%. Contradictory evidence is surfaced separately.
- Daily/monthly/summary/policy reports, permitted role dashboards and daily status lists use the same scoped classification. Individual CSV/Excel cells distinguish independent travel and leave; monthly CSV/Excel and PDF summary carry separate headings and metrics.
- Existing reports use current pupil school/grade/vehicle membership and dates with recorded activity, not an immutable historical school roster or an academic calendar. This release does not reconstruct past membership. New exception rows snapshot morning/evening service eligibility so later preference edits do not erase their occurrence counts; pre054 records have no historical snapshot and retain the existing current-preference fallback.

## Targeted schema preflight (NOT EXECUTED)

Migration054_attendance_kind.sql is required before deploying this build: startup refuses missing or unverified attendance metadata before app.listen. It adds attendance_kind(defaultLEAVE), nullable eligibility snapshots and a generated active_session unique key. Existing cancelled rows remain; they no longer prevent a corrected new record. No row is reclassified to SELF and no historical eligibility is invented. tests/schema.sql is updated separately because the disposable test DB is built from that schema, not by replaying migrations.

1. Obtain release authorization, claim source+production on the coordination board with a fresh revision, read HANDOFF, then inspect health/process/lock and verify the on-server DB backup; record backup filename.
2. Prepare a separate server-only full clone at the exact approved source commit before changing the live checkout; verify its SHA and the unchanged backend package/lock hashes. Run scripts/apply-migration-054.mjs --dry-run there. The targeted runner accepts only054, checks exact schema/index metadata and its SHA256 ledger, verifies the latest on-server backup, and acquires both the production deploy lock and a DB advisory lock. For the approved apply operation, set ENV_FILE to the existing private operator configuration; MIGRATION_BACKEND_MODULES may point at the live backend directory to reuse its verified unchanged dependencies. Run node scripts/apply-migration-054.mjs --apply from the reviewed release-prep clone. Do not run a general migration runner: legal052/053 remain pending and must not be activated implicitly. No credentials belong in this document or shell output.
3. Verify metadata only: attendance_kind, morning_enabled_snapshot, evening_enabled_snapshot and generated active_session exist; uk_sl_active_date_student_session has columns leave_date/student_id/active_session and old uk_sl_date_student_session is absent. The runner stamps schema_migrations only after exact postchecks and safely verifies/reconciles an interrupted post-DDL ledger write; it refuses partial schema or checksum drift. Confirm pre-existing LEAVE/default behavior and row preservation through test-DB rehearsal, not new production test records.
4. Release the schema-operation lock, then deploy the pinned approved feat/tracking-security-hardening commit through scripts/deploy-backend.sh with EXPECTED_BRANCH and DEPLOY_FRONTEND=1. Its lock, syntax/unit checks and rollback flow must remain enabled; do not use detached HEAD. The SELF_TRAVEL_DEPLOY_LOCK path, if overridden, must match that deployer's lock.
5. Verify public health commit against the exact target, DB connectivity, migration latest054 with only legal052/053 still pending, frontend asset hashes, process/lock and retained rollback backup. Do not infer whole UAT or legal approval from health200.

### Existing production actor boundary

Fresh read-only preflight found the application uses the runtime actor and054 is not applied. Runtime must retain its current CRUD-only grants. The existing schema-operator configuration is root-protected (see ops/database/README.md); do not copy it to schoolbus, loosen its permissions, reuse the backup actor for DDL, rerun the actor installer/recovery, or run this repository's Node code with sudo.

For that production arrangement, the owner must perform the approved054 SQL through the existing privileged MySQL operator session, with the coordination reservation/deploy lock, verified backup and protected exact-SHA SQL copy. Apply only054 and record its exact file SHA256 in schema_migrations after metadata validation;052/053 remain untouched. After the owner operation, the unprivileged Node helper supports --verify with the runtime configuration: it only SELECTs metadata/ledger, performs no lock or write, and refuses missing/different ledger state. --apply remains for an already authorized non-root operator credential/session; it intentionally refuses runtime credentials and root execution. No additional database actor or grant is created by this release.

## Rollback boundary

Keep the additive schema and cancellation history when rolling back; do not drop054 columns or recreate the old unique key over retained cancelled history. Before the first successful frontend/backend release completes, the SELF write guard uses the deploy lock and prevents new typed SELF records during automatic rollback.

After real SELF records exist, do not manually roll back to a pre054 application that treats all exclusions as leave and lacks the shared SELF check-in guard. Use an approved compatibility-preserving rollback/fix that retains SELF reads and conflict guards. Do not delete/reclassify records to make an old release start.

## Validation evidence

Focused backend regression10suites88tests PASS at the local intermediate revision; static migration baselinePASS. Synthetic22 mobile/desktop captures passed: no failed captures, overflow, unexpected console errors, small tap targets, tiny inputs or invisible focus. Full immutable-head CI and disposable-DB concurrency/migration tests remain required before release; these intermediate results are not deployment evidence.
