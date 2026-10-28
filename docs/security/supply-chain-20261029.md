# CI supply-chain pins and history scan

## CI action pins

All GitHub Actions referenced by `.github/workflows/*.yml` are pinned to full commit SHAs. Inline comments identify the upstream release tag used for each pin. Workflow permissions default to `contents: read`; no write token permission is granted.

The UI runtime job uses Playwright `1.64.1` as an exact frontend dev dependency, recorded in `frontend/package-lock.json`. `npx playwright install --with-deps chromium` therefore installs the browser revision selected by that lockfile: Chromium `156.0.8078.4`, revision `1248`. CI no longer installs an unpinned Playwright package or resolves a browser through a floating package version.

## Gitleaks history scan

On 2026-10-28, Gitleaks `8.30.1` scanned the complete history and all refs in the full, non-shallow clone at base `fb1a461e22d791c434263ee747c6464e102bde77` (756 reachable commits at scan time). The official Windows release archive checksum was verified before running the scan. Result: **0 findings; exit code 0**. No report containing matched values was retained or committed.

The `secret-scan` CI job fetches full history, downloads the exact Gitleaks `8.30.1` Linux x64 archive, verifies its pinned SHA-256 checksum, and scans all refs with redaction enabled. It prints only grouped counts, file paths, and rule types if findings occur. Reports and raw scanner output stay in the ephemeral runner and are not uploaded. If a scan finds a candidate, treat the check as failed, review only redacted metadata to determine whether it is real, stop release work for a real secret, and do not rewrite Git history as part of this workflow.
