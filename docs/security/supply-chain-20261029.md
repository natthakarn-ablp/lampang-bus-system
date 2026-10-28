# CI supply-chain pins and history scan

## CI action pins

All GitHub Actions referenced by `.github/workflows/*.yml` are pinned to full commit SHAs. Inline comments identify the upstream release tag used for each pin. Workflow permissions default to `contents: read`; no write token permission is granted.

The UI runtime job uses Playwright `1.64.1` as an exact frontend dev dependency, recorded in `frontend/package-lock.json`. `npx playwright install --with-deps chromium` therefore installs the browser revision selected by that lockfile: Chromium `156.0.8078.4`, revision `1248`. CI no longer installs an unpinned Playwright package or resolves a browser through a floating package version.

## Gitleaks history scan

On 2026-10-28, Gitleaks `8.30.1` scanned the complete history and all refs in the full, non-shallow clone at base `fb1a461e22d791c434263ee747c6464e102bde77`. The official Windows release archive checksum was verified before running the scan. The initial scan identified 14 candidates (exit 1); review of their source context classified them as synthetic test fixtures or documented shell-variable placeholders, not live credentials. No matched values were retained or committed. The exact commit, file, rule, and line fingerprints are listed in `.gitleaksignore`; no path-wide or rule-wide exemptions were added. The repeat scan with these exact fingerprints ignored passed with exit 0 and 0 remaining findings.

| File | Rule | Reviewed candidates |
|---|---|---:|
| `backend/tests/applyMigration050Script.unit.test.js` | `generic-api-key` | 1 |
| `backend/tests/enableFeatureFlagScript.unit.test.js` | `generic-api-key` | 1 |
| `backend/tests/numericPathParamValidation.test.js` | `generic-api-key` | 3 |
| `backend/tests/routeLatency.unit.test.js` | `generic-api-key` | 1 |
| `backend/tests/secretScan.unit.test.js` | `generic-api-key` | 3 |
| `backend/tests/secretScan.unit.test.js` | `curl-auth-header` | 1 |
| `backend/tests/secretScan.unit.test.js` | `jwt` | 1 |
| `docs/production-launch-checklist.md` | `curl-auth-header` | 1 |
| `docs/uat-deployment-guide.md` | `curl-auth-header` | 1 |
| `scripts/ui-redesign/capture.mjs` | `generic-api-key` | 1 |
| **Total** |  | **14** |

The `secret-scan` CI job fetches full history, downloads the exact Gitleaks `8.30.1` Linux x64 archive, verifies its pinned SHA-256 checksum, and scans all refs with redaction enabled. It prints only grouped counts, file paths, and rule types if findings occur. Reports and raw scanner output stay in the ephemeral runner and are not uploaded. The fingerprint file exempts only the 14 reviewed historical findings above; new findings still fail the check. If a scan finds a new candidate, review only redacted metadata to determine whether it is real, stop release work for a real secret, and do not rewrite Git history as part of this workflow.
