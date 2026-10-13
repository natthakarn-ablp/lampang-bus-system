"""Synthetic filesystem failures for the privileged switch; no SSH/production access."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('db_actors', Path(__file__).with_name('install-db-actors.py'))
actors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actors)
ORIGINAL = ('DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=lampang_bus\n'
            'DB_USER=legacy_fixture\nDB_PASSWORD=synthetic-legacy-only\n'
            'JWT_SECRET="synthetic-token-keep-byte-identical"\nFEATURE_VEHICLE_QR=false\n')


class SwitchTests(unittest.TestCase):
    def test_preserves_other_credentials_and_flags(self):
        result = actors.replace_credentials(ORIGINAL, 'runtime_fixture', 'a' * 64)
        self.assertIn('DB_USER=runtime_fixture\n', result)
        self.assertIn('DB_PASSWORD=' + 'a' * 64 + '\n', result)
        self.assertTrue(result.endswith('DB_CREDENTIAL_ROLE=runtime\n'))
        self.assertIn('JWT_SECRET="synthetic-token-keep-byte-identical"\nFEATURE_VEHICLE_QR=false\n', result)

    def test_refuses_ambiguous_or_existing_switch(self):
        for text in (ORIGINAL + 'DB_USER=other\n', ORIGINAL.replace('DB_HOST=127.0.0.1\n', ''), ORIGINAL + 'DB_CREDENTIAL_ROLE=runtime\n', ORIGINAL.replace('\n', '\r\n')):
            with self.assertRaises(ValueError):
                actors.replace_credentials(text, 'runtime_fixture', 'a' * 64)

    def test_atomic_write_refuses_parent_symlink_without_touching_target(self):
        with tempfile.TemporaryDirectory(prefix='db-actors-symlink-test-') as base:
            root = Path(base)
            real = root / 'elsewhere'
            real.mkdir()
            target = real / 'config.env'
            target.write_text('preserve')
            (root / 'redirect').symlink_to(real, target_is_directory=True)
            with self.assertRaises(OSError):
                actors.atomic_private(root / 'redirect/config.env', b'new', os.getuid(), os.getgid())
            self.assertEqual(target.read_text(), 'preserve')

    def run_operation(self, fail_at=None, concurrent_change=False):
        with tempfile.TemporaryDirectory(prefix='db-actors-owner-test-') as base:
            root = Path(base)
            app = root / 'app'
            env = app / 'backend/.env'
            env.parent.mkdir(parents=True)
            env.write_text(ORIGINAL)
            env.chmod(0o600)
            save = root / 'recovery'
            backup = root / 'config/schoolbus/db-backup.env'
            deploy = root / 'deploy.sh'
            deploy.write_text('synthetic-not-executed')
            sql_calls = []
            reloads = []
            credentials = {'DB_HOST': '127.0.0.1', 'DB_PORT': '3306', 'DB_NAME': 'lampang_bus', 'DB_USER': 'legacy_fixture', 'DB_PASSWORD': 'synthetic-legacy-only'}
            def owner(command, extra=None):
                if command[:3] == ['/usr/bin/install', '-d', '-m']:
                    directory = Path(command[-1])
                    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
                    return b''
                if 'rev-parse' in command:
                    return ('a' * 40 + '\n').encode()
                if 'branch' in command:
                    return (actors.BRANCH + '\n').encode()
                if 'node' in command and 'Object.fromEntries' in command[-1]:
                    return json.dumps(credentials).encode()
                if fail_at == 'backup' and command[-1].endswith('backup-db.sh') and backup.exists():
                    raise RuntimeError('synthetic backup failure')
                return b''
            def root_sql(sql):
                sql_calls.append(sql)
                if sql.startswith('SELECT COUNT(*) FROM mysql.user'):
                    return '0\n'
                if sql.startswith('SELECT COUNT(*) FROM information_schema.SCHEMATA'):
                    return '1\n'
                if sql.startswith('SELECT EVENT_NAME'):
                    return 'synthetic-event\tlegacy_fixture@localhost\tENABLED\n'
                return ''
            def reload(release):
                reloads.append(env.read_text())
                if len(reloads) == 1 and fail_at == 'health':
                    if concurrent_change:
                        env.write_text('EXTERNAL_CHANGE=preserve\n')
                    raise RuntimeError('synthetic health failure')
            replacements = dict(APP=app, ENV=env, SAVE=save, BACKUP_ENV=backup, DEPLOY=deploy,
                                DEPLOY_SHA=hashlib.sha256(deploy.read_bytes()).hexdigest())
            with patch.multiple(actors, **replacements), patch.object(actors, 'owner', side_effect=owner), patch.object(actors, 'root_sql', side_effect=root_sql), patch.object(actors, 'healthy', return_value=True), patch.object(actors, 'reload_reviewed', side_effect=reload), patch.object(actors.os, 'geteuid', return_value=0), patch.object(actors.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())), patch.object(actors.sys, 'argv', ['script', 'a' * 40]):
                if fail_at:
                    with self.assertRaises(RuntimeError):
                        actors.main()
                else:
                    actors.main()
                snapshot = {'env': env.read_text(), 'backup_exists': backup.exists(), 'sql': sql_calls, 'reloads': reloads, 'status': (save / 'status').read_text(), 'original_mode': stat.S_IMODE((save / 'env.before').stat().st_mode)}
            return snapshot

    def test_success_keeps_recovery_private_and_switches_runtime(self):
        result = self.run_operation()
        self.assertIn('DB_USER=schoolbus_runtime_20261014\n', result['env'])
        self.assertTrue(result['backup_exists'])
        self.assertEqual(result['original_mode'], 0o600)
        self.assertIn('SUCCESS', result['status'])
        self.assertFalse(any(sql.startswith('DROP') for sql in result['sql']))

    def test_backup_failure_leaves_runtime_and_definer_unchanged(self):
        result = self.run_operation('backup')
        self.assertEqual(result['env'], ORIGINAL)
        self.assertFalse(result['backup_exists'])
        self.assertEqual(result['reloads'], [])
        self.assertEqual(sum(sql.startswith('DROP USER') for sql in result['sql']), 2)

    def test_health_failure_restores_original_bytes_and_reloads(self):
        result = self.run_operation('health')
        self.assertEqual(result['env'], ORIGINAL)
        self.assertFalse(result['backup_exists'])
        self.assertEqual(len(result['reloads']), 2)
        self.assertEqual(result['reloads'][1], ORIGINAL)
        self.assertIn('restored=True', result['status'])

    def test_external_config_change_is_not_overwritten_or_accounts_dropped(self):
        result = self.run_operation('health', concurrent_change=True)
        self.assertEqual(result['env'], 'EXTERNAL_CHANGE=preserve\n')
        self.assertTrue(result['backup_exists'])
        self.assertFalse(any(sql.startswith('DROP USER') for sql in result['sql']))
        self.assertIn('restored=False', result['status'])


if __name__ == '__main__':
    unittest.main()
