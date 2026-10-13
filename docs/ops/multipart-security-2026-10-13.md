# Multipart parser security remediation — 13 October 2026

The runtime dependency audit returned zero, but upstream Multer advisories
explicitly affect 1.x, including the locked 1.4.5-lts.2. Registry audit output
alone was insufficient evidence that the upload parser was patched. This
change upgrades to Multer 2.4.0, which includes the latest released cleanup fix.

https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4
https://github.com/expressjs/multer/releases/tag/v2.4.0

All four upload configurations now bound field nesting to 4 levels and array
indices to 32 before field expansion. Current frontend multipart forms use
flat metadata (file/photo, doc_type, auto_create_vehicle); file-size caps remain
2 MB for profile photos and 5 MB for imports/documents. Existing authentication,
role/scope checks, file filters, filenames and magic-byte validation are retained.

Known malformed multipart/file-limit errors return 400 or 413 with a generic
Thai message and the parser error code. Attacker-controlled field/filename
values are not reflected. Storage faults and unknown parser faults remain 500.

Synthetic real-HTTP regression covers preserved CSV/XLSX/PDF/JPG bytes and
metadata, Thai filename decoding, exact size boundary and oversize cleanup,
oversized array indices/nesting rejection and subsequent responsiveness, cleanup
after a later rejected field, aborted upload cleanup, and server-fault handling.
All fixture traffic is loopback with synthetic files in disposable temporary
directories; no exploit probe runs on production. Parser version and finite
limits are checked before malicious-field fixtures to avoid running them on an
unpatched parser.

Full Node22 CI, migration checks and frontend build are deployment gates.
Use a fresh verified backup and the approved dependency-staging/rollback deploy
script. Zero runtime audit findings remain only a scoped registry snapshot;
moderate Jest-chain and frontend build-tool findings remain separately recorded.

CI also exposed an overstrict existing stale-lock fixture: all four competing
deploys can legitimately refuse before any mutation when reclaimers collide.
The test now enforces at most one concurrent winner, validates every refusal,
and if all refuse proves no reload/code change and no owner evidence remains.
After simulating only the orphan-age wait in its disposable directory, one
serial retry must succeed. The final exactly-one-reload/target-HEAD assertions
remain. The approved production deployment script is unchanged.
