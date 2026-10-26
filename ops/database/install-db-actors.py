#!/usr/bin/env python3
"""Owner-authenticated credential switch, fixed production paths; no unattended sudo."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import subprocess
import sys
import time
import urllib.request

APP = Path('/home/schoolbus/apps/lampang-bus-system')
ENV = APP / 'backend/.env'
SAVE = Path('/root/schoolbus-db-actors-20261014')
BACKUP_ENV = Path('/home/schoolbus/.config/schoolbus/db-backup.env')
DEPLOY = Path('/home/schoolbus/deploy-state/deploy-backend.sh')
DEPLOY_SHA = '6a35438abf5d5ebb0776d5a44bc79f69f7106b5c1577208b443217d3e397c2dd'
BRANCH = 'feat/tracking-security-hardening'
RUNTIME = 'schoolbus_runtime_20261014'
BACKUP = 'schoolbus_backup_20261014'
OWNER_PATH = '/opt/schoolbus-node-v22.23.3/bin:/usr/local/bin:/usr/bin:/bin'


def replace_credentials(text: str, user: str, password: str) -> str:
    """Preserve other secrets/settings; refuse ambiguous or multiline DB keys."""
    if '\r' in text or not re.fullmatch(r'[a-z0-9_]+', user) or not re.fullmatch(r'[0-9a-f]{64}', password):
        raise ValueError('Unsupported environment format or generated credential')
    for key in ('DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME'):
        if len(re.findall(r'^' + key + r'=.*$', text, re.M)) != 1 or len(re.findall(r'^[ \t]*(?:export[ \t]+)?' + key + r'[ \t]*=', text, re.M)) != 1:
            raise ValueError('Missing or duplicate DB key')
        raw = re.search(r'^' + key + r'=(.*)$', text, re.M).group(1).strip()
        if raw.startswith(('"', "'", '`')) and (len(raw) < 2 or raw[-1] != raw[0]):
            raise ValueError('Multiline/unsupported quoted DB key; normalize before switch')
    if re.search(r'^DB_CREDENTIAL_ROLE=', text, re.M):
        raise ValueError('Role marker already exists; inspect previous operation')
    text = re.sub(r'^DB_USER=.*$', 'DB_USER=' + user, text, flags=re.M)
    text = re.sub(r'^DB_PASSWORD=.*$', 'DB_PASSWORD=' + password, text, flags=re.M)
    return text.rstrip('\n') + '\nDB_CREDENTIAL_ROLE=runtime\n'


def atomic_private(path: Path, content: bytes, uid: int, gid: int) -> None:
    # Walk components using openat/no-follow and keep the final directory fd.
    # Application-owned parents may be renamed concurrently; root must never
    # follow a substituted symlink into an unrelated privileged directory.
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parent.parts[1:]:
            next_directory = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_directory
        metadata = os.fstat(directory)
        if metadata.st_uid != uid or stat.S_IMODE(metadata.st_mode) & 0o022:
            raise RuntimeError('Credential directory must belong to owner without group/world writes')
        temp = path.name + '.schoolbus-actors-new'
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            with os.fdopen(fd, 'wb') as stream:
                os.fchown(stream.fileno(), uid, gid)
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path.name, src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try:
                os.unlink(temp, dir_fd=directory)
            except FileNotFoundError:
                pass
    finally:
        os.close(directory)


def owner(args: list[str], extra: dict[str, str] | None = None) -> bytes:
    command = ['/usr/sbin/runuser', '-u', 'schoolbus', '--', '/usr/bin/env', '-i',
               'HOME=/home/schoolbus', 'PM2_HOME=/home/schoolbus/.pm2', 'PATH=' + OWNER_PATH]
    command += [key + '=' + value for key, value in (extra or {}).items()]
    result = subprocess.run(command + args, cwd=APP, capture_output=True, check=False)
    if result.returncode:
        with (SAVE / 'operation.log').open('ab') as log:
            log.write(result.stdout + result.stderr)
        raise RuntimeError('Owner operation failed; inspect protected operation.log')
    return result.stdout


def root_sql(sql: str) -> str:
    result = subprocess.run(['/usr/bin/mysql', '--no-defaults', '--protocol=socket', '--user=root',
                             '--batch', '--skip-column-names'], input=sql.encode(), capture_output=True, check=False)
    if result.returncode:
        with (SAVE / 'operation.log').open('ab') as log:
            log.write(result.stderr)
        raise RuntimeError('MySQL administrative operation failed; inspect protected operation.log')
    return result.stdout.decode()


def healthy(release: str) -> bool:
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000/health', timeout=5) as response:
            health = json.load(response)
        data = health['data']
        return health['success'] is True and data['service'] == 'lampang-bus-backend' and data['commit'] == release[:7] and data['database']['connected'] is True
    except (OSError, ValueError, KeyError):
        return False


def reload_reviewed(release: str) -> None:
    pin = '/home/schoolbus/deploy-state/reviewed-' + release + '.git'
    actual = owner(['/usr/bin/git', '--git-dir=' + pin, 'rev-parse', 'refs/heads/' + BRANCH]).decode().strip()
    if actual != release or hashlib.sha256(DEPLOY.read_bytes()).hexdigest() != DEPLOY_SHA:
        raise RuntimeError('Reviewed deployment pin/helper changed')
    owner(['/usr/bin/bash', str(DEPLOY)], {'DEPLOY_REMOTE': pin, 'EXPECTED_BRANCH': BRANCH})
    if not healthy(release):
        raise RuntimeError('Release health gate failed')


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) != 2 or not re.fullmatch(r'[0-9a-f]{40}', sys.argv[1]):
        raise ValueError('Run reviewed installer once using owner password sudo and full live release SHA')
    release = sys.argv[1]
    os.umask(0o077)
    if SAVE.is_symlink() or (SAVE.exists() and (SAVE.stat().st_uid != 0 or stat.S_IMODE(SAVE.stat().st_mode) != 0o700)):
        raise RuntimeError('Protected recovery directory has unexpected ownership/mode')
    SAVE.mkdir(mode=0o700, exist_ok=True)
    if (SAVE / 'begin').exists():
        raise RuntimeError('Operation already started; inspect protected status instead of repeating')
    # All commands that execute repository code run as schoolbus, never root.
    if owner(['/usr/bin/git', 'rev-parse', 'HEAD']).decode().strip() != release:
        raise RuntimeError('Install compatibility release first')
    if owner(['/usr/bin/git', 'branch', '--show-current']).decode().strip() != BRANCH or owner(['/usr/bin/git', 'status', '--porcelain', '--untracked-files=no']).strip():
        raise RuntimeError('Unexpected branch or changed tracked files')
    if not healthy(release) or (Path('/home/schoolbus/deploy-state/deploy-backend.lock')).exists():
        raise RuntimeError('Backend unhealthy or another deployment holds the lock')
    if BACKUP_ENV.exists() or BACKUP_ENV.is_symlink():
        raise RuntimeError('Backup actor already configured; refuse overwrite')
    account = pwd.getpwnam('schoolbus')
    if ENV.is_symlink() or not ENV.is_file() or ENV.stat().st_uid != account.pw_uid or stat.S_IMODE(ENV.stat().st_mode) != 0o600 or ENV.stat().st_nlink != 1:
        raise RuntimeError('Unexpected runtime env ownership/type/mode/link count')
    original = ENV.read_bytes()
    original_text = original.decode()
    if ENV.parent.is_symlink() or stat.S_IMODE(ENV.parent.stat().st_mode) & 0o022:
        raise RuntimeError('Runtime credential directory must not allow group/world writes')
    # dotenv executes only as the existing unprivileged application owner. Secret
    # output is captured in root memory, never printed or put on command argv.
    code = "const fs=require('fs'),c=require('dotenv').parse(fs.readFileSync('.env'));console.log(JSON.stringify(Object.fromEntries(['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'].map(k=>[k,c[k]]))))"
    config = json.loads(owner(['/usr/bin/env', '--chdir=' + str(APP / 'backend'), 'node', '-e', code]))
    if config['DB_HOST'] not in ('localhost', '127.0.0.1') or config['DB_PORT'] != '3306' or config['DB_NAME'] != 'lampang_bus':
        raise RuntimeError('Unexpected database target')
    runtime_password, backup_password = secrets.token_hex(32), secrets.token_hex(32)
    installed = replace_credentials(original_text, RUNTIME, runtime_password).encode()
    if root_sql('SELECT COUNT(*) FROM mysql.user WHERE User IN (\'' + RUNTIME + '\',\'' + BACKUP + '\');').strip() != '0':
        raise RuntimeError('Candidate accounts already exist; refuse grant changes')
    if root_sql("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='lampang_bus';").strip() != '1':
        raise RuntimeError('Production schema not found')
    event_before = root_sql("SELECT EVENT_NAME,DEFINER,STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA='lampang_bus' ORDER BY EVENT_NAME;")
    # Confirm PM2 has no inherited DB values overriding dotenv after the switch.
    process_code = "const cp=require('child_process'),fs=require('fs');let a=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).find(a=>a.name==='schoolbus-backend');let e=fs.readFileSync('/proc/'+a.pid+'/environ','utf8').split('\\0');if(e.some(x=>/^DB_(USER|PASSWORD|HOST|PORT|NAME)=/.test(x)))process.exit(2)"
    owner(['node', '-e', process_code])
    if hashlib.sha256(DEPLOY.read_bytes()).hexdigest() != DEPLOY_SHA:
        raise RuntimeError('Reviewed deployment helper changed')
    # Fresh backup uses the still-working legacy actor; no business data writes.
    owner(['/usr/bin/bash', str(APP / 'scripts/backup-db.sh')])
    owner(['/usr/bin/bash', str(APP / 'scripts/verify-latest-backup.sh')])
    if ENV.read_bytes() != original or not healthy(release):
        raise RuntimeError('Runtime config/health changed during backup')
    (SAVE / 'begin').write_text(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
    (SAVE / 'env.before').write_bytes(original)
    schema_lines = [line for line in original_text.splitlines() if re.match(r'^DB_(HOST|PORT|NAME|USER|PASSWORD)=', line)]
    (SAVE / 'schema-operator.env').write_text('\n'.join(schema_lines) + '\n')
    created: list[str] = []
    switched = False
    backup_installed = False
    try:
        root_sql(f"CREATE USER '{RUNTIME}'@'localhost' IDENTIFIED BY '{runtime_password}';")
        created.append(RUNTIME)
        root_sql(f"GRANT SELECT,INSERT,UPDATE,DELETE ON lampang_bus.* TO '{RUNTIME}'@'localhost';")
        root_sql(f"CREATE USER '{BACKUP}'@'localhost' IDENTIFIED BY '{backup_password}';")
        created.append(BACKUP)
        root_sql(f"GRANT SELECT,SHOW VIEW,EVENT,TRIGGER ON lampang_bus.* TO '{BACKUP}'@'localhost'; GRANT SHOW_ROUTINE ON *.* TO '{BACKUP}'@'localhost';")
        directory = BACKUP_ENV.parent
        owner(['/usr/bin/install', '-d', '-m', '700', str(directory)])
        for parent in (directory.parent, directory):
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise RuntimeError('Unexpected backup credential parent path')
        if directory.stat().st_uid != account.pw_uid or stat.S_IMODE(directory.stat().st_mode) != 0o700:
            raise RuntimeError('Backup credential directory must be owner-owned0700')
        backup_config = f"DB_HOST={config['DB_HOST']}\nDB_PORT=3306\nDB_NAME=lampang_bus\nDB_USER={BACKUP}\nDB_PASSWORD={backup_password}\nDB_CREDENTIAL_ROLE=backup\n"
        atomic_private(BACKUP_ENV, backup_config.encode(), account.pw_uid, account.pw_gid)
        backup_installed = True
        owner(['/usr/bin/bash', str(APP / 'scripts/backup-db.sh')])
        owner(['/usr/bin/bash', str(APP / 'scripts/verify-latest-backup.sh')])
        # Connection preflight with the new runtime principal performs SELECT only.
        # Temporary file has0600 in a700 owner directory; nothing secret on argv.
        preflight = BACKUP_ENV.parent / 'runtime-preflight.env'
        if preflight.exists() or preflight.is_symlink():
            raise RuntimeError('Preflight credential path already exists')
        atomic_private(preflight, installed, account.pw_uid, account.pw_gid)
        try:
            check = """const c=require('dotenv').parse(require('fs').readFileSync('/home/schoolbus/.config/schoolbus/runtime-preflight.env'));
if(c.DB_USER!=='schoolbus_runtime_20261014'||!/^([0-9a-f]{64})$/.test(c.DB_PASSWORD))process.exit(2);
require('mysql2/promise').createConnection({host:c.DB_HOST,port:Number(c.DB_PORT),database:c.DB_NAME,user:c.DB_USER,password:c.DB_PASSWORD}).then(async d=>{
try {
 const [[identity]]=await d.query('SELECT CURRENT_USER() AS principal, CURRENT_ROLE() AS role');
 const [schema]=await d.query('SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE TABLE_SCHEMA=DATABASE()');
 const [global]=await d.query('SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES');
 const actual=schema.map(x=>x.PRIVILEGE_TYPE).sort().join(',');
 if(identity.principal!=='schoolbus_runtime_20261014@localhost'||identity.role!=='NONE'||actual!=='DELETE,INSERT,SELECT,UPDATE'||schema.some(x=>x.IS_GRANTABLE==='YES')||global.some(x=>x.PRIVILEGE_TYPE!=='USAGE'))throw new Error('unexpected runtime grants');
 await d.query('SELECT COUNT(*) FROM users');
}finally{await d.end()}
}).catch(()=>process.exit(2))"""
            owner(['/usr/bin/env', '--chdir=' + str(APP / 'backend'), 'node', '-e', check])
        finally:
            preflight.unlink()
        if ENV.read_bytes() != original:
            raise RuntimeError('Environment changed externally; refuse overwrite')
        if Path('/home/schoolbus/deploy-state/deploy-backend.lock').exists() or owner(['/usr/bin/git', 'rev-parse', 'HEAD']).decode().strip() != release or not healthy(release):
            raise RuntimeError('Deployment or health changed before credential switch')
        atomic_private(ENV, installed, account.pw_uid, account.pw_gid)
        switched = True
        reload_reviewed(release)
        event_after = root_sql("SELECT EVENT_NAME,DEFINER,STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA='lampang_bus' ORDER BY EVENT_NAME;")
        if event_before != event_after:
            raise RuntimeError('Event metadata changed; refuse completion')
        owner(['/usr/bin/bash', str(APP / 'scripts/health-smoke.sh')])
        owner(['pm2', 'save'])
        (SAVE / 'status').write_text('SUCCESS: runtime CRUD only; backup verified; legacy event definer retained; release=' + release + '\n')
        print('Database actors installed; backend healthy; backup checksum/gzip verified; event unchanged.')
        print('SQL privilege separation only: application and backup still share the schoolbus Unix identity.')
    except Exception:
        recovered = not switched
        if switched:
            if ENV.read_bytes() == installed:
                atomic_private(ENV, original, account.pw_uid, account.pw_gid)
                try:
                    reload_reviewed(release)
                    recovered = True
                except Exception:
                    recovered = False
            else:
                print('Environment changed externally: automatic overwrite refused.', file=sys.stderr)
        if recovered and backup_installed:
            if BACKUP_ENV.read_text() == backup_config:
                BACKUP_ENV.unlink()
            else:
                recovered = False
        if recovered:
            for user in reversed(created):
                root_sql(f"DROP USER '{user}'@'localhost';")
        (SAVE / 'status').write_text('FAILED; previous runtime restored=' + str(recovered) + '; inspect protected log before retry\n')
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No SQL, credentials, recipient identifiers or captured stderr on screen.
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
