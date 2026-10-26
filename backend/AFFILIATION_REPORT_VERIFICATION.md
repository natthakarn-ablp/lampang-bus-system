# Affiliation school report backend verification

Scope: isolated source snapshot `C:/Users/Admin/AppData/Local/Temp/schoolbus-affiliation-report-bfe8a80`, based on production commit `bfe8a80`. No git repository, deployment, production requests, migrations, integration tests, test preparation, or real student records were used. Backend-only changes; frontend/workflow changes belong to the parent.

## Parent follow-up verification

The feature was cleanly merged onto production commit `242142e37e57f888d31607569eedb187111c5ecb` in an isolated local tree. The parent reran all 52 relevant backend tests and all 11 browser tests, built the frontend and passed the UI-label check. Existing upstream frontend check scripts were preserved; Playwright is installed locally with `--no-save`, and the production package lock is not modified. The full DB-free baseline counts below refer only to the earlier source-only snapshot, not a full-suite run on the later tree. No production writes or deployments occurred.

## Contract

- `GET /api/affiliation/schools/report`: `sendSuccess({ affiliation: { id, name }, generated_at: <ISO timestamp>, summary: { total_schools, total_students, total_vehicles }, schools: [...] })`.
- `GET /api/affiliation/schools/report/excel`: genuine ExcelJS-generated XLSX attachment `affiliation-schools-report.xlsx`, using the same report service. Thai metadata/headers, current-data disclaimer, per-school rows including zero counts, and final summary row. String identifiers retain leading zeroes; formula-like names are text, not formulas. Integer count cells are numeric.
- Existing `GET /api/affiliation/schools` keeps its original list contract.
- Existing resolver locks affiliation users to authenticated scope regardless of query. Admins must explicitly provide `affiliation_id`; absent scope returns 403. Missing/deleted selected affiliation returns 404.
- One connection executes `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`, then `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`, followed by all report reads, commit and release. Errors trigger rollback and release; rollback errors do not mask the original failure.
- Student total sums normalized school counts. Fleet total is separately `COUNT(DISTINCT s.vehicle_id)` over live students, live schools and live vehicles in the selected affiliation, not the sum of per-school fleets. No student identities/PII are selected or returned.
- This is a **current master-data overview**, not academic-term attestation, submission status, or a declaration of having/no transport. Zero does not mean no report. No term workflow or schema changes were implemented.

## Exact commands and outcomes

All commands below were executed in the snapshot's `backend/` directory.

1. `npm ci --ignore-scripts --no-audit --no-fund`
   - Exit 0; installed 586 packages. Existing dependency deprecation warnings only; no install/lifecycle scripts executed.
2. `npm run test:unit -- --silent > affiliation-report-unit-baseline.log 2>&1`
   - Baseline exit 1: 27 failed / 98 passed suites; 77 failed / 1623 passed tests.
3. TDD tracer bullets used `npx jest --config jest.unit.config.js --runInBand tests/affiliationSchoolReportService.unit.test.js` and `npx jest --config jest.unit.config.js --runInBand tests/affiliationSchoolReportRoute.unit.test.js` before implementation.
   - Observed RED for optional executor (pool incorrectly used), report service absent, rollback absent, missing-affiliation report resolving, JSON route 404, and XLSX route 404. Implemented each slice only after its failure, then observed GREEN. Related regressions were rerun between slices.
4. `npx jest --config jest.unit.config.js --runInBand tests/affiliationSchoolReportRoute.unit.test.js tests/affiliationSchoolReportService.unit.test.js tests/summaryMatchesBreakdown.unit.test.js tests/exportRateLimitCoverage.unit.test.js`
   - Final exit 0: **4 suites, 52 tests passed**. New report tests: 23 route tests and 12 service tests. Real workbook bytes are loaded back by ExcelJS, not mocked.
5. `npm run test:unit -- --silent --json --outputFile=affiliation-report-unit-final.json > affiliation-report-unit-final.log 2>&1`
   - Exit 1: 27 failed / 100 passed suites; 77 failed / 1660 passed tests. Programmatic comparisons of baseline/final failed suite names and failure headings both returned no additions or removals. Passing-test deltas include baseline differences; the parent independently changed frontend files only, not unrelated backend tests.
   - Existing failures concern absent snapshot migrations/scripts/documentation/assets/`.env.example` and missing test JWT configuration. No attempt was made to repair these by running integration/preparation/migration scripts.
6. `node --check src/routes/affiliation.routes.js && node --check src/services/affiliation.service.js && node --check src/utils/affiliationSchoolsWorkbook.js && node --check tests/affiliationSchoolReportService.unit.test.js && node --check tests/affiliationSchoolReportRoute.unit.test.js`
   - Exit 0 for all five JS files.
7. A local Python source scan of the three feature source files found no eval/shell execution, interpolated affiliation IDs, or hardcoded secret assignments. All report SQL scope values are bound parameters and asserted by tests.

Testing caveat: MySQL execution/isolation behavior is verified as a query/connection contract using a mocked DB boundary, not against an actual database, as required for this task. Real Excel serialization/parsing and Express routing were executed.

## Owned source/test files

Modified:
- `src/services/affiliation.service.js`
- `src/routes/affiliation.routes.js`

Created:
- `src/utils/affiliationSchoolsWorkbook.js`
- `tests/affiliationSchoolReportService.unit.test.js`
- `tests/affiliationSchoolReportRoute.unit.test.js`

Local verification evidence, not deployment artifacts:
- `AFFILIATION_REPORT_VERIFICATION.md` (this file)
- `affiliation-report-unit-baseline.log`
- `affiliation-report-unit-final.log`
- `affiliation-report-unit-final.json`

No commit was created. Parent will independently review/verify before deciding how to integrate.
