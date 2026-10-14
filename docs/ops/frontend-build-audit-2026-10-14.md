# Frontend build dependency patch — 14 October 2026

The full frontend dependency audit reported8findings:6high and2moderate. One
high finding was source-map-js1.2.1, used by the development build toolchain.
Indexed source maps could amplify a very large section-line offset into
unbounded work. The upstream [1.2.2release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
and [reviewed advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
identify1.2.2as the patched version.

Update only that existing compatible lockfile entry to1.2.2. No direct package
range, runtime dependency, application source or CSS configuration changes.
Local strict label checks, hybrid UI checks and production build pass. All163
regular build files retain exactly the same paths and SHA256 hashes as the
baseline build on the same machine/environment. This proves artifact equivalence
for this build; it is not a new test of every browser or a vulnerability-free
certification. No served asset exchange is needed for identical output.

The full frontend audit drops to7findings:5high and2moderate. The remaining high
chain is Tailwind3's braces/chokidar/fast-glob/micromatch dependency tree; current
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched
braces release. The moderate chain includes postcss-selector-parser through
postcss-nested. Do not use audit-fix-force to change Tailwind major versions
without reviewing rendering and supported devices.

Tailwind's [upgrade guide](https://tailwindcss.com/docs/upgrade-guide) requires
Safari16.4+, Chrome111+ and Firefox128+ forv4 and recommends retainingv3.4 when
older browsers are required. Browser support requirements are pending an owner
answer. Continue compatibility work in an isolated branch with visual and
interaction review before releasing a major migration. This patch leaves the
current browser support unchanged.
