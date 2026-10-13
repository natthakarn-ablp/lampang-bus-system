"""Filesystem recovery/refusal fixtures; no production access or MySQL writes."""
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


recovery = load('recovery', 'recover-db-actors.py')
installer = load('installer', 'install-db-actors.py')
ORIGINAL = b'DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=lampang_bus\nDB_USER=legacy_fixture\nDB_PASSWORD=synthetic-only\nFEATURE_VEHICLE_QR=false\n'


class RecoveryTests(unittest.TestCase):
    def run_case(self, failure=None):
        with tempfile.TemporaryDirectory(prefix='db-recovery-fixture-') as directory:
            root = Path(directory)
            env = root / 'app/backend/.env'
            env.parent.mkdir(parents=True)
            env.parent.chmod(0o755)
            current = installer.replace_credentials(ORIGINAL.decode(), installer.RUNTIME, 'a' * 64).encode()
            env.write_bytes(current)
            env.chmod(0o600)
            save = root / 'protected'
            save.mkdir()
            calls, reloads, statuses = [], [], []
            if failure == 'external_before':
                env.write_bytes(current.replace(b'FEATURE_VEHICLE_QR=false', b'FEATURE_VEHICLE_QR=true'))
            def owner(args):
                if 'rev-parse' in args:
                    return recovery.RELEASE.encode()
                if 'status' in args:
                    return b''
                if args[-1].endswith('verify-db-actors-installed.cjs'):
                    common = dict(authenticated_principal_matches=True, active_role_present=False, grant_option_present=False)
                    return json.dumps(dict(runtime_marker_matches=True,runtime_name_matches=True,backup_marker_matches=True,backup_name_matches=True,actors=dict(runtime=dict(**common,schema_privileges=['DELETE','INSERT','SELECT','UPDATE'],visible_global_privileges=['USAGE']),backup=dict(**common,schema_privileges=['EVENT','SELECT','SHOW VIEW','TRIGGER'],visible_global_privileges=['SHOW_ROUTINE','USAGE'])))).encode()
                if 'node' in args and 'JSON.stringify' in args[-1]:
                    return json.dumps(dict(user=installer.RUNTIME,password='a'*64,role='runtime')).encode()
                if 'node' in args and recovery.PUBLIC_STATUS in args:
                    statuses.append(args[-1])
                return b''
            def sql(query):
                calls.append(query)
                if 'SCHEMA_PRIVILEGES' in query:
                    if failure == 'unexpected_grants': return 'CREATE\tNO\n'
                    privileges = ['DELETE','INSERT','SELECT','UPDATE'] if installer.RUNTIME in query else ['EVENT','SELECT','SHOW VIEW','TRIGGER']
                    return '\n'.join(x+'\tNO' for x in privileges)+'\n'
                if 'USER_PRIVILEGES' in query:
                    privileges=['USAGE'] if installer.RUNTIME in query else ['SHOW_ROUTINE','USAGE']
                    return '\n'.join(x+'\tNO' for x in privileges)+'\n'
                if 'EVENT_NAME' in query: return 'cleanup_revoked_tokens\tlegacy_fixture@localhost\tENABLED\n'
                if '@@event_scheduler' in query: return 'ON\n'
                if 'PROCESSLIST' in query: return '1\n'
                return ''
            def reload(release):
                reloads.append(env.read_bytes())
                if len(reloads)==1 and failure in ('health','external_during'):
                    if failure=='external_during': env.write_bytes(b'EXTERNAL_CHANGE=preserve\n')
                    raise RuntimeError('synthetic interrupted reload')
            actors = types.SimpleNamespace(APP=root/'app',ENV=env,RUNTIME=installer.RUNTIME,BACKUP=installer.BACKUP,replace_credentials=installer.replace_credentials,atomic_private=installer.atomic_private,owner=owner,root_sql=sql,healthy=lambda _:True,reload_reviewed=reload)
            with patch.object(recovery,'SAVE',save), patch.object(recovery,'verify_original_login',side_effect=RuntimeError('synthetic fallback denied') if failure=='fallback' else None), patch.object(recovery.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())):
                if failure:
                    with self.assertRaises(RuntimeError): recovery.recover(actors,ORIGINAL)
                else: recovery.recover(actors,ORIGINAL)
            return dict(env=env.read_bytes(),reloads=reloads,sql=calls,statuses=statuses)

    def test_success_resumes_existing_accounts_without_grant_or_user_changes(self):
        result=self.run_case()
        self.assertEqual(len(result['reloads']),1)
        self.assertIn(b'DB_CREDENTIAL_ROLE=runtime',result['env'])
        self.assertTrue(result['statuses'][-1].startswith('SUCCESS'))
        self.assertTrue(all(query.startswith('SELECT') for query in result['sql']))

    def test_failed_health_restores_original_bytes_before_second_reload(self):
        result=self.run_case('health')
        self.assertEqual(result['env'],ORIGINAL)
        self.assertEqual(result['reloads'][1],ORIGINAL)
        self.assertIn('restored=True',result['statuses'][-1])

    def test_concurrent_config_change_is_preserved(self):
        result=self.run_case('external_during')
        self.assertEqual(result['env'],b'EXTERNAL_CHANGE=preserve\n')
        self.assertEqual(len(result['reloads']),1)
        self.assertIn('restored=False',result['statuses'][-1])

    def test_prior_flag_change_stops_before_reload(self):
        result=self.run_case('external_before')
        self.assertEqual(result['reloads'],[])
        self.assertIn(b'FEATURE_VEHICLE_QR=true',result['env'])

    def test_unexpected_administrative_grants_stop_before_reload(self):
        result=self.run_case('unexpected_grants')
        self.assertEqual(result['reloads'],[])

    def test_failed_fallback_authentication_stops_before_restart(self):
        result=self.run_case('fallback')
        self.assertEqual(result['reloads'],[])

    def test_detached_work_survives_parent_terminal_session_hangup(self):
        with tempfile.TemporaryDirectory(prefix='db-recovery-hangup-fixture-') as directory:
            root=Path(directory)
            result=root/'finished'
            child=root/'child.py'
            child.write_text("import time\nfrom pathlib import Path\ntime.sleep(0.4)\nPath("+repr(str(result))+").write_text('finished')\n")
            module=str(Path(__file__).with_name('recover-db-actors.py'))
            code="import importlib.util,time\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('r',"+repr(module)+")\nr=importlib.util.module_from_spec(s)\ns.loader.exec_module(r)\nf=open("+repr(str(root/'child.log'))+",'wb')\np=r.start_detached(Path("+repr(str(child))+"),f)\nprint(p.pid,flush=True)\ntime.sleep(10)\n"
            parent=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.PIPE,text=True,start_new_session=True)
            try:
                self.assertTrue(parent.stdout.readline().strip().isdigit())
                os.killpg(parent.pid,signal.SIGHUP)
                parent.wait(timeout=3)
                deadline=time.monotonic()+3
                while not result.exists() and time.monotonic()<deadline: time.sleep(0.05)
                self.assertEqual(result.read_text(),'finished')
            finally:
                if parent.poll() is None: parent.kill(); parent.wait()
                parent.stdout.close()


if __name__=='__main__': unittest.main()
