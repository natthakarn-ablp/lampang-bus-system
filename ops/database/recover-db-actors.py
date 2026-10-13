#!/usr/bin/env python3
"""Finish an interrupted switch using existing actors and protected rollback data."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import sys

SAVE = Path('/root/schoolbus-db-actors-20261014')
ORIGINAL_SHA = 'a21984f317e2daeeeb99861b50ec188adeb61de07f7e8ca0b977f0d84654afd8'
RELEASE = 'c2c04e3e2de3d5c123282c05ed8d7772ec26b8ef'
PUBLIC_STATUS = '/home/schoolbus/logs/db-actors-recovery-20261014.status'


def load_reviewed():
    source = SAVE / 'install.py'
    if source.is_symlink() or not source.is_file() or source.stat().st_uid != 0 or source.stat().st_mode & 0o022 or hashlib.sha256(source.read_bytes()).hexdigest() != ORIGINAL_SHA:
        raise RuntimeError('Protected original installer differs from reviewed code')
    spec = importlib.util.spec_from_file_location('reviewed_db_actors', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def private_original() -> bytes:
    source = SAVE / 'env.before'
    if source.is_symlink() or not source.is_file() or source.stat().st_uid != 0 or stat.S_IMODE(source.stat().st_mode) != 0o600 or source.stat().st_nlink != 1:
        raise RuntimeError('Protected original environment is unavailable or unsafe')
    return source.read_bytes()


def report(actors, message: str):
    # Writing an owner path is unprivileged; only fixed non-secret status text.
    code = "require('fs').writeFileSync(process.argv[1],process.argv[2]+'\\n',{mode:0o600})"
    actors.owner(['node', '-e', code, PUBLIC_STATUS, message])


def verify_original_login(actors, original: bytes):
    # Verify fallback authentication before any restart; pass secrets on stdin,
    # never argv or a temporary owner-readable copy of the protected file.
    code = "const c=require('dotenv').parse(require('fs').readFileSync(0,'utf8'));require('mysql2/promise').createConnection({host:c.DB_HOST,port:Number(c.DB_PORT),database:c.DB_NAME,user:c.DB_USER,password:c.DB_PASSWORD}).then(async d=>{await d.query('SELECT 1');await d.end()}).catch(()=>process.exit(2))"
    command = ['/usr/sbin/runuser','-u','schoolbus','--','/usr/bin/env','-i','HOME=/home/schoolbus','PATH='+actors.OWNER_PATH,'node','-e',code]
    result = subprocess.run(command, cwd=actors.APP/'backend', input=original, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('Protected fallback credentials cannot authenticate; do not restart')


def start_detached(script: Path, stream):
    return subprocess.Popen(['/usr/bin/python3', str(script), '--run'], stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, start_new_session=True)


def recover(actors, original: bytes):
    account = pwd.getpwnam('schoolbus')
    current = actors.ENV.read_bytes()
    if actors.ENV.is_symlink() or actors.ENV.stat().st_uid != account.pw_uid or stat.S_IMODE(actors.ENV.stat().st_mode) != 0o600:
        raise RuntimeError('Unexpected current credential file')
    code = "const c=require('dotenv').parse(require('fs').readFileSync('.env'));console.log(JSON.stringify({user:c.DB_USER,password:c.DB_PASSWORD,role:c.DB_CREDENTIAL_ROLE}))"
    config = json.loads(actors.owner(['/usr/bin/env', '--chdir=' + str(actors.APP / 'backend'), 'node', '-e', code]))
    expected = actors.replace_credentials(original.decode(), actors.RUNTIME, config['password']).encode()
    if config['user'] != actors.RUNTIME or config['role'] != 'runtime' or expected != current:
        raise RuntimeError('Current settings do not match the reviewed switch; refuse overwrite/reload')
    if actors.owner(['/usr/bin/git', 'rev-parse', 'HEAD']).decode().strip() != RELEASE or actors.owner(['/usr/bin/git', 'status', '--porcelain', '--untracked-files=no']).strip() or not actors.healthy(RELEASE):
        raise RuntimeError('Live release/configuration is not the expected healthy baseline')
    # A live holder must never be displaced. The approved deployer, not this
    # script, safely reclaims a dead PID's own lock file.
    lock = Path('/home/schoolbus/deploy-state/deploy-backend.lock')
    holders = list(lock.glob('owner.*')) if lock.exists() else []
    if len(holders) > 1:
        raise RuntimeError('Multiple deployment lock holders; inspect before resuming')
    for holder in holders:
        if not re.fullmatch(r'owner\.[0-9]+', holder.name):
            raise RuntimeError('Unfinished lock owner record; inspect before resuming')
        if Path('/proc/' + holder.name.split('.')[1]).exists():
            raise RuntimeError('Another deployment still runs; do not overlap')
    events_before = actors.root_sql("SELECT EVENT_NAME,DEFINER,STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA='lampang_bus' ORDER BY EVENT_NAME;")
    if 'cleanup_revoked_tokens' not in events_before or actors.root_sql('SELECT @@event_scheduler;').strip() != 'ON':
        raise RuntimeError('Expected production event/scheduler not visible')
    for user, expected_privileges in ((actors.RUNTIME, ['DELETE', 'INSERT', 'SELECT', 'UPDATE']), (actors.BACKUP, ['EVENT', 'SELECT', 'SHOW VIEW', 'TRIGGER'])):
        grantee = f"CONCAT(CHAR(39),'{user}',CHAR(39),'@',CHAR(39),'localhost',CHAR(39))"
        rows = actors.root_sql(f"SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE TABLE_SCHEMA='lampang_bus' AND GRANTEE={grantee} ORDER BY PRIVILEGE_TYPE;").strip().splitlines()
        if rows != [privilege + '\tNO' for privilege in expected_privileges]:
            raise RuntimeError('Administrative privilege inventory differs from reviewed policy')
        expected_global = ['USAGE'] if user == actors.RUNTIME else ['SHOW_ROUTINE', 'USAGE']
        global_rows = actors.root_sql(f"SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE={grantee} ORDER BY PRIVILEGE_TYPE;").strip().splitlines()
        if global_rows != [privilege + '\tNO' for privilege in expected_global]:
            raise RuntimeError('Administrative global privileges differ from reviewed policy')
    # Authenticate both existing principals and verify grants using the safe
    # inspected helper, executed only as schoolbus. No account creation/GRANT.
    raw = actors.owner(['/usr/bin/env', '--chdir=' + str(actors.APP / 'backend'), 'node', '/home/schoolbus/deploy-state/verify-db-actors-installed.cjs'])
    metadata = json.loads(raw)
    for key in ('runtime_marker_matches', 'runtime_name_matches', 'backup_marker_matches', 'backup_name_matches'):
        if metadata.get(key) is not True:
            raise RuntimeError('Existing database actor configuration differs')
    runtime, backup = metadata['actors']['runtime'], metadata['actors']['backup']
    for actor in (runtime, backup):
        if not actor['authenticated_principal_matches'] or actor['active_role_present'] or actor['grant_option_present']:
            raise RuntimeError('Unexpected principal, role or grant option')
    if runtime['schema_privileges'] != ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] or runtime['visible_global_privileges'] != ['USAGE']:
        raise RuntimeError('Runtime privileges differ from reviewed CRUD policy')
    if backup['schema_privileges'] != ['EVENT', 'SELECT', 'SHOW VIEW', 'TRIGGER'] or backup['visible_global_privileges'] != ['SHOW_ROUTINE', 'USAGE']:
        raise RuntimeError('Backup privileges differ from reviewed policy')
    actors.owner(['/usr/bin/bash', str(actors.APP / 'scripts/backup-db.sh')])
    actors.owner(['/usr/bin/bash', str(actors.APP / 'scripts/verify-latest-backup.sh')])
    verify_original_login(actors, original)
    if actors.ENV.read_bytes() != current:
        raise RuntimeError('Environment changed during preflight')
    try:
        report(actors, 'RUNNING: existing accounts verified; approved same-release reload starting')
        actors.reload_reviewed(RELEASE)
        events_after = actors.root_sql("SELECT EVENT_NAME,DEFINER,STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA='lampang_bus' ORDER BY EVENT_NAME;")
        if events_after != events_before:
            raise RuntimeError('Event metadata changed')
        count = actors.root_sql("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='schoolbus_runtime_20261014' AND DB='lampang_bus';").strip()
        if not count.isdigit() or int(count) < 1:
            raise RuntimeError('Live backend runtime connection not observed')
        actors.owner(['/usr/bin/bash', str(actors.APP / 'scripts/health-smoke.sh')])
        actors.owner(['pm2', 'save'])
        (SAVE / 'status').write_text('SUCCESS: interrupted switch recovered; live runtime principal verified; event unchanged; release=' + RELEASE + '\n')
        report(actors, 'SUCCESS: live runtime CRUD verified; backup verified; legacy event retained')
        print('Existing database switch recovered; no users or grants recreated.')
    except Exception:
        restored = False
        if actors.ENV.read_bytes() == current:
            actors.atomic_private(actors.ENV, original, account.pw_uid, account.pw_gid)
            try:
                actors.reload_reviewed(RELEASE)
                restored = True
            except Exception:
                pass
        # Retain existing accounts/backup credentials; this recovery created
        # none and must not drop an account possibly used by another consumer.
        (SAVE / 'status').write_text('RECOVERY_FAILED; original runtime restored=' + str(restored) + '\n')
        report(actors, 'FAILED: original runtime restored=' + str(restored) + '; inspect protected recovery.log')
        raise


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in (['--start'], ['--run']):
        raise RuntimeError('Owner password sudo required; use the reviewed starter')
    os.umask(0o077)
    if SAVE.is_symlink() or not SAVE.is_dir() or SAVE.stat().st_uid != 0 or stat.S_IMODE(SAVE.stat().st_mode) != 0o700:
        raise RuntimeError('Protected recovery directory is unsafe')
    if sys.argv[1] == '--start':
        load_reviewed()
        private_original()
        start = SAVE / 'recovery.begin'
        with start.open('x') as file:
            file.write('One detached recovery; inspect status/log before any repeat.\n')
        with (SAVE / 'recovery.log').open('xb') as log:
            child = start_detached(Path(__file__).resolve(), log)
        (SAVE / 'recovery.pid').write_text(str(child.pid) + '\n')
        print('Detached reviewed recovery started. GPT will inspect its non-secret status.')
        return
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    actors = load_reviewed()
    try:
        report(actors, 'CHECKING: interrupted switch and protected rollback data')
        recover(actors, private_original())
    except Exception:
        report(actors, 'FAILED: inspect protected recovery.log; do not repeat installer')
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
