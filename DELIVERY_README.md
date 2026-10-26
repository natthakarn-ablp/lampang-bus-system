# School-summary feature — local delivery, NOT deployed

Base: production commit `242142e37e57f888d31607569eedb187111c5ecb`, with the feature merged from the earlier `bfe8a80` snapshot and relevant checks rerun. This bundle contains changed/new files and a unified patch only; it is not a complete checkout and must not replace the existing project wholesale.

## Implemented

- A top-right school-summary panel on the affiliation school list: schools, students, and vehicles deduplicated across schools.
- School-by-school report dialog with affiliation, timestamp, totals and print/Save PDF.
- Genuine `.xlsx` export, preserving numeric cells and literal text, including zero-count schools.
- Authenticated scope resolution, read-only repeatable-read report snapshot, and export rate limiting.

## Verified locally

- Backend report/scope/regression tests: 4 suites / 52 tests passed, independently rerun by parent.
- Browser tests: 11 passed, including desktop/mobile, loading/error/retry, report modal, admin-scoped download, and browser round-trip of the real backend workbook generator.
- Frontend production build passed.
- Generated Excel reloaded by ExcelJS and Python openpyxl; ZIP integrity and numeric summary cells verified.
- PDF extraction verified all 65 synthetic school rows across four pages, including the final page. The short report is one page. All attached screenshots/workbooks/PDFs use synthetic test data, NOT production counts.
- In the initial bfe8a80 source-only snapshot, the full DB-free baseline had 27 failing suites / 77 failing tests, with unchanged failure names/headings after the feature. After merging onto 242142e, the relevant 52 backend tests, 11 browser tests, production build and UI-label check passed. The full suite was not rerun on this later tree; no real MySQL execution was performed.

## Run in a complete isolated checkout

1. Install backend and frontend dependencies with `npm ci --ignore-scripts`.
2. Backend: `npx jest --config jest.unit.config.js --runInBand tests/affiliationSchoolReportRoute.unit.test.js tests/affiliationSchoolReportService.unit.test.js tests/summaryMatchesBreakdown.unit.test.js tests/exportRateLimitCoverage.unit.test.js`
3. Frontend: install the browser-test dependency with `npm install --no-save --package-lock=false --ignore-scripts playwright@1.64.1`, run `npx playwright install chromium`, then `npm run test:school-report`. Optionally set `SCHOOL_REPORT_BROWSER` to an installed Chrome/Edge executable. Set `SCHOOL_REPORT_ARTIFACTS` to a directory to retain synthetic output files.
4. Frontend: `npm run build`.

## Not implemented/deployed

- No production changes, migrations, student-record reads/writes, or deployment.
- The school-login popup and per-term transport declaration workflow is a separate confirmed concept, recorded in `docs/affiliation-term-report-workflow.md`; it is NOT part of this implementation.
- Zero vehicles must not be interpreted as no submission. Counts here are live master data, not term attestation status.
- Before integration/deployment: compare the current server commit, review/apply the patch to a clean working branch, exercise against an isolated MySQL test database, obtain owner approval and a verified backup, then use the approved deployment script. Do not overwrite the user's older dirty local checkout.
