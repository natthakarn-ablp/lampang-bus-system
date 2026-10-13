# Database actors — reviewed owner operation

Production inventory 2026-10-14: MySQL8.0.46,66base tables, one enabled
legacy-account event, no views/routines/triggers. Backend dotenv credentials
currently have18schema privileges; PM2 initial environment has no DB overrides.
Schoolbus cron uses backup-db.sh, not the legacy backup.sh or restore tools.

The compatibility release does not change production credentials/grants. Before
installation, backup scripts still read backend/.env. Afterwards, they prefer
/home/schoolbus/.config/schoolbus/db-backup.env; a broken installed file fails
without falling back. An explicit ENV_FILE wins. Migration050/051 and restore
tools accept ENV_FILE and refuse the generated runtime marker before changing
schema or stopping the app. Direct MySQL privileges enforce the actual boundary.

| Actor | Privileges | Credential location |
| --- | --- | --- |
| Runtime | SELECT,INSERT,UPDATE,DELETE on lampang_bus | backend/.env, schoolbus0600 |
| Backup | SELECT,SHOW VIEW,EVENT,TRIGGER on lampang_bus; global SHOW_ROUTINE | .config/schoolbus/db-backup.env, schoolbus0600 in0700directory |
| Existing schema operator/event definer | Existing18schema privileges retained; no new global grant | /root/schoolbus-db-actors-20261014/schema-operator.env, root0600 |

SHOW_ROUTINE exposes routine definitions across schemas; it does not grant
global SELECT. EVENT and TRIGGER allow modifying those object types as well as
backing them up. They are necessary for a complete dump. This actor is therefore
not a read-only MySQL account. See [MySQL privilege documentation](https://dev.mysql.com/doc/refman/8.0/en/privileges-provided.html)
and [routine visibility](https://dev.mysql.com/doc/refman/8.0/en/stored-routines-privileges.html).

This separates SQL principals, not Unix identities. Runtime and backup still
run as schoolbus, and a compromised schoolbus process could read the backup
credential or historical env copies. Do not describe this as complete process
isolation. Existing legacy credentials are deliberately not revoked: the live
event retains its definer; past backups/operators need an explicit retirement
plan. No student/business records are updated by the installer.

## Rehearsal

The standalone backend/scripts/verify-db-actors.js only accepts explicitly
acknowledged local/CI instances and known synthetic root passwords. It refuses
unexpected databases, creates only its own fixture schemas/users, proves CRUD
transactions and denied DDL, operator migration/rollback, full mysqldump and
restoration of view/trigger/routine/event. The test instance scheduler is disabled
before event import and restored afterwards; production scheduler is untouched.
The CI service and an owned disposable local port3307 container run this check.

python3 ops/database/test-install-db-actors.py runs synthetic filesystem
success, backup failure, health failure/rollback, externally changed config
refusal, and parent-symlink refusal. It never contacts production/MySQL.

## Owner installation

Install only after this compatibility release passes full CI and is deployed
via the approved external helper with a fresh backup and immutable Git pin.
Restrict backend directory to owner writes (0755); backend/.env must be0600.
Copy the reviewed installer to root-owned0700 storage, verify its exactSHA,
then run it with password sudo and the full live releaseSHA. Do not whitelist
it for unattended sudo. Root MySQL socket authentication must succeed; the
installer stops before changes if it does not. Passwords are generated in
memory, sent through stdin/private files, and never printed or passed on argv.

The installer preserves the original environment root0600, verifies a fresh
legacy backup, creates only two previously absent accounts, verifies a full
backup using the new backup actor, and SELECT-preflights the new runtime actor.
It changes only DB_USER/DB_PASSWORD and adds the runtime marker, then uses the
approved deployment helper against the SAME immutable release to reload PM2.
Health, event metadata, smoke checks and PM2save gate completion. No feature flag,
event definer, business schema or student row is changed.

On failure, it restores byte-identical old credentials and reloads the reviewed
release. It removes only the accounts/config this operation created after
runtime recovery is verified. If an external config change or recovery failure
prevents safe rollback, it retains accounts and reports protected recovery state.
A begin marker refuses blind repeat; inspect /root/.../status and operation.log.

Manual rollback after a successful installation also requires owner password
sudo: verify unchanged current config, restore env.before with schoolbus0600
ownership, reload the same release through the approved helper, verify health,
then remove/retire only the two new accounts and backup config after checking
no consumer uses them. Do not drop the legacy event definer, disable production
event_scheduler, run an unreviewed repository script as root, or restore broad
NOPASSWD/Docker access. Future schema/restore operations use a reviewed operator
credential and backup gate; the historical restore.sh remains a maintenance
tool, not a zero-downtime production recovery mechanism.
