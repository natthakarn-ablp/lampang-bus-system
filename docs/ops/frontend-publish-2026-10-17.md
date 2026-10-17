# Frontend publication through the existing backend deployer

`DEPLOY_FRONTEND=1` is opt-in on the reviewed external
`/home/schoolbus/deploy-state/deploy-backend.sh`. Without it the deployer keeps
its previous backend-only behaviour. Run this only after pinning that external
script to the reviewed source hash and confirming the production branch, health,
absence of a deploy lock, the database backup, and the frontend lockfile match.

The backend deployer holds its existing lock, fast-forwards the reviewed commit,
runs syntax and unit tests, reloads PM2, and proves `/health` before invoking
`scripts/publish-frontend.py`. The helper verifies the same full commit and lock
owner, builds into an empty directory on the same filesystem, and refuses
symlinked live directories or an unexpected `docs` path. It includes only the
public manual link. Linux `renameat2(RENAME_EXCHANGE)` swaps the candidate and
live directories atomically. The old tree moves to a unique
`/home/schoolbus/backups/frontend-dist/dist.prev-*` path. An origin request
bound to 127.0.0.1 must return the exact new `index.html` bytes.

If build or publication fails, the helper restores the old `dist` and returns
failure. The backend deployer then uses its existing rollback path. If the
frontend exchange back itself fails, the helper returns exit 2 and the deployer
stops without another code change, leaving both trees for incident inspection.
Never infer that a failed command is safe without checking the result and
current site. The backup's relative manual link resolves again if that tree is
exchanged into its original `frontend/dist` path.

This does not change the database schema, access roles, LINE configuration, or
the frontend browser baseline. The helper's Linux synthetic fixtures cover
success, build failure, origin mismatch and restore, missing lock owner,
symlink refusal, and failed restore. The backend deployer fixtures cover opt-in
success and backend rollback after a frontend failure. The release is not
complete until the new source has passed CI and the actual origin, protected
API, `/manual` and backend health have been checked after publication.
