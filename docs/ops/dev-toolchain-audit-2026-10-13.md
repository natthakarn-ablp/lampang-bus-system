# Backend development-tool remediation — 13 October 2026

The full backend dependency audit after runtime package remediation still had
34 findings (32 high, 2 moderate) through Jest 29 and nodemon. The runtime-only
audit was zero. This change upgrades Jest to 30.5.2 and replaces nodemon with
Node's built-in `--watch` for development; the production start command and
application source remain unchanged.

Jest's official migration guide was checked for removed matchers, mock API and
CLI flags. No removed matcher/mock calls were found; two test-file usage
comments now use `--testPathPatterns`. Existing assertions are preserved.

https://jestjs.io/docs/upgrading-to-jest30
https://nodejs.org/api/cli.html#--watch

## Audit scope and remaining findings

The candidate full backend audit is 0 critical/high and 19 moderate. These are
dependency-chain findings rooted in `sprintf-js` via argparse/js-yaml/Istanbul
used by Jest. The advisory currently lists no patched version; the suggested
forced Jest 25 downgrade is not a safe resolution and was not performed.
This is a remaining development-tool finding, not an all-dependency clearance.

https://github.com/advisories/GHSA-hp3w-g68c-fv3c

The frontend full audit separately remains 8 findings (6 high, 2 moderate) in
the Tailwind 3 build tool chain. Resolving them requires a separately reviewed
Tailwind 4 migration and responsive visual regression checks; do not force a
major style-system upgrade or hide findings with omit-dev during review.

Full unit/integration CI, migration baseline, and frontend checks remain the
release gates. Production dependency installation must use the approved
staging/rollback deploy script with a fresh verified database backup.
