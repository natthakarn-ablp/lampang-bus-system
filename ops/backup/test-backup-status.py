#!/usr/bin/env python3
"""Synthetic tests for backup_status.py (DATA-001).

Uses the real pinned rclone binary (RCLONE_TEST_BIN) against a local-directory
"remote" and a local mock of the LINE push endpoint. No Drive, no LINE, no
production data. Every fixture lives in a private temp dir removed on exit.
"""
import gzip
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import backup_status as bs  # noqa: E402

RCLONE = os.environ.get('RCLONE_TEST_BIN') or shutil.which('rclone')
NOW = '2026-11-08T21:00:00+00:00'


def make_dump(directory, stamp, body=b'-- synthetic dump\nSELECT 1;\n', sidecar=True, bad_sum=False):
    name = f'lampang_bus_{stamp}.sql.gz'
    path = Path(directory) / name
    path.write_bytes(gzip.compress(body))
    if sidecar:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if bad_sum:
            digest = '0' * 64
        (Path(directory) / (name + '.sha256')).write_text(f'{digest}  {name}\n', encoding='ascii')
    return name


class MockLine(http.server.BaseHTTPRequestHandler):
    calls = []
    status = 200

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get('Content-Length', 0))
        MockLine.calls.append({'auth': self.headers.get('Authorization'),
                               'body': json.loads(self.rfile.read(n))})
        self.send_response(MockLine.status)
        self.end_headers()

    def log_message(self, *args):
        pass


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(('127.0.0.1', 0), MockLine)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.endpoint = f'http://127.0.0.1:{cls.server.server_port}/push'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='bs-test-')
        self.local = os.path.join(self.tmp, 'local')
        self.remote = os.path.join(self.tmp, 'remote')
        self.state = os.path.join(self.tmp, 'state')
        os.makedirs(self.local)
        os.makedirs(self.remote)
        MockLine.calls = []
        MockLine.status = 200
        os.environ['LINE_CHANNEL_ACCESS_TOKEN'] = 'synthetic-token-never-real'
        os.environ['TECH_LINE_TARGET_ID'] = 'Csynthetic-target'

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, *extra, remote=True, now=NOW):
        args = ['--backup-dir', self.local, '--state-dir', self.state, '--now', now,
                '--rclone', RCLONE, '--restore-evidence', os.path.join(self.tmp, 'none.json'),
                '--alert-endpoint', self.endpoint, '--timeout', '30']
        if remote:
            args += ['--remote', self.remote]
        code = bs.main(args + list(extra))
        report = json.loads(Path(self.state, 'latest.json').read_text(encoding='utf-8'))
        return code, {s['stage']: s for s in report['stages']}

    def sync(self):
        subprocess.run([RCLONE, 'copy', self.local, self.remote], check=True, capture_output=True)


@unittest.skipUnless(RCLONE, 'rclone binary required')
class StageTests(Base):
    def test_all_ok_including_readback(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        code, st = self.run_cli('--readback')
        self.assertEqual(code, 0)
        for stage in ('local', 'offhost', 'readback'):
            self.assertEqual(st[stage]['status'], 'OK', stage)
        self.assertEqual(st['restore']['status'], 'UNPROVEN')

    def test_local_marker_alone_is_not_offhost_evidence(self):
        make_dump(self.local, '20261108_193000')
        Path(self.local, '.last_offhost_sync').write_text('2026-11-08T19:50:00+00:00\n')
        code, st = self.run_cli()
        self.assertEqual(code, 1)
        self.assertEqual(st['offhost']['status'], 'MISSING')

    def test_stale_local_and_stale_remote_are_separate(self):
        make_dump(self.local, '20261106_193000')
        self.sync()
        code, st = self.run_cli()
        self.assertEqual(code, 1)
        self.assertEqual(st['local']['status'], 'STALE')
        self.assertEqual(st['offhost']['status'], 'STALE')

    def test_fresh_local_but_remote_not_updated(self):
        make_dump(self.local, '20261106_193000')
        self.sync()
        make_dump(self.local, '20261108_193000')
        _, st = self.run_cli()
        self.assertEqual(st['local']['status'], 'OK')
        self.assertEqual(st['offhost']['status'], 'STALE')
        self.assertEqual(st['offhost']['file'], 'lampang_bus_20261106_193000.sql.gz')

    def test_missing_local_sidecar(self):
        make_dump(self.local, '20261108_193000', sidecar=False)
        _, st = self.run_cli(remote=False)
        self.assertEqual(st['local']['status'], 'CHECKSUM_MISSING')

    def test_local_checksum_mismatch(self):
        make_dump(self.local, '20261108_193000', bad_sum=True)
        _, st = self.run_cli(remote=False)
        self.assertEqual(st['local']['status'], 'CHECKSUM_MISMATCH')

    def test_corrupt_gzip_with_matching_sum(self):
        name = 'lampang_bus_20261108_193000.sql.gz'
        p = Path(self.local, name)
        p.write_bytes(gzip.compress(b'x' * 5000)[:-12])
        Path(self.local, name + '.sha256').write_text(
            hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + name + '\n')
        _, st = self.run_cli(remote=False)
        self.assertEqual(st['local']['status'], 'GZIP_BAD')

    def test_remote_missing_sidecar(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        os.remove(os.path.join(self.remote, 'lampang_bus_20261108_193000.sql.gz.sha256'))
        _, st = self.run_cli()
        self.assertEqual(st['offhost']['status'], 'CHECKSUM_MISSING')

    def test_remote_size_mismatch(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        Path(self.remote, 'lampang_bus_20261108_193000.sql.gz').write_bytes(b'truncated')
        _, st = self.run_cli()
        self.assertEqual(st['offhost']['status'], 'SIZE_MISMATCH')

    def test_remote_corrupt_detected_only_by_readback(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        os.remove(os.path.join(self.local, 'lampang_bus_20261108_193000.sql.gz'))  # rotated locally
        make_dump(self.local, '20261108_193001')
        remote_dump = Path(self.remote, 'lampang_bus_20261108_193000.sql.gz')
        data = bytearray(remote_dump.read_bytes())
        data[-1] ^= 0xFF
        remote_dump.write_bytes(bytes(data))
        _, st = self.run_cli('--readback')
        self.assertEqual(st['offhost']['status'], 'OK')
        self.assertEqual(st['readback']['status'], 'CHECKSUM_MISMATCH')

    def test_unreachable_destination(self):
        make_dump(self.local, '20261108_193000')
        code = bs.main(['--backup-dir', self.local, '--state-dir', self.state, '--now', NOW,
                        '--rclone', RCLONE, '--remote', 'nosuchremote-xyz:path', '--readback',
                        '--restore-evidence', os.path.join(self.tmp, 'none.json'), '--timeout', '30'])
        st = {s['stage']: s for s in json.loads(Path(self.state, 'latest.json').read_text())['stages']}
        self.assertEqual(code, 1)
        self.assertEqual(st['offhost']['status'], 'UNREACHABLE')
        self.assertEqual(st['readback']['status'], 'NOT_RUN')

    def test_readback_leaves_no_temp_copy(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        before = set(os.listdir(tempfile.gettempdir()))
        self.run_cli('--readback')
        leaked = [n for n in set(os.listdir(tempfile.gettempdir())) - before
                  if n.startswith('backup-readback-')]
        self.assertEqual(leaked, [])

    def test_restore_evidence_reported_without_changing_exit(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        ev = Path(self.tmp, 'drill.json')
        ev.write_text(json.dumps({'completed_at': '2026-11-01T10:00:00+00:00',
                                  'result': 'PASS', 'source': 'synthetic-ci'}))
        code = bs.main(['--backup-dir', self.local, '--state-dir', self.state, '--now', NOW,
                        '--rclone', RCLONE, '--remote', self.remote, '--restore-evidence', str(ev)])
        st = {s['stage']: s for s in json.loads(Path(self.state, 'latest.json').read_text())['stages']}
        self.assertEqual(code, 0)
        self.assertEqual(st['restore']['status'], 'OK')
        self.assertEqual(st['restore']['source'], 'synthetic-ci')


@unittest.skipUnless(RCLONE, 'rclone binary required')
class AlertTests(Base):
    def test_fail_once_then_suppressed_then_reminder_then_recover(self):
        make_dump(self.local, '20261106_193000')  # stale everywhere
        self.sync()
        self.run_cli('--alert', now='2026-11-08T21:00:00+00:00')
        self.run_cli('--alert', now='2026-11-08T21:30:00+00:00')
        self.assertEqual(len(MockLine.calls), 1)
        self.run_cli('--alert', now='2026-11-09T09:00:00+00:00')  # 12h later → reminder
        self.assertEqual(len(MockLine.calls), 2)
        self.assertIn('still FAILING', MockLine.calls[1]['body']['messages'][0]['text'])
        make_dump(self.local, '20261109_193000')
        self.sync()
        self.run_cli('--alert', now='2026-11-09T21:00:00+00:00')
        self.run_cli('--alert', now='2026-11-09T21:30:00+00:00')
        self.assertEqual(len(MockLine.calls), 3)
        self.assertIn('recovered', MockLine.calls[2]['body']['messages'][0]['text'])

    def test_new_failure_kind_alerts_immediately(self):
        make_dump(self.local, '20261106_193000')
        self.sync()
        self.run_cli('--alert', now='2026-11-08T21:00:00+00:00')
        os.remove(os.path.join(self.remote, 'lampang_bus_20261106_193000.sql.gz.sha256'))
        self.run_cli('--alert', now='2026-11-08T21:05:00+00:00')
        self.assertEqual(len(MockLine.calls), 2)

    def test_failed_delivery_retries_next_run(self):
        make_dump(self.local, '20261106_193000')
        MockLine.status = 500
        self.run_cli('--alert', now='2026-11-08T21:00:00+00:00')
        MockLine.status = 200
        self.run_cli('--alert', now='2026-11-08T21:05:00+00:00')
        self.assertEqual(len(MockLine.calls), 2)

    def test_message_has_no_secret_and_auth_only_in_header(self):
        make_dump(self.local, '20261106_193000')
        self.run_cli('--alert')
        call = MockLine.calls[0]
        text = json.dumps(call['body'])
        self.assertNotIn('synthetic-token-never-real', text)
        self.assertEqual(call['auth'], 'Bearer synthetic-token-never-real')
        self.assertEqual(call['body']['to'], 'Csynthetic-target')

    def test_missing_credentials_never_marks_sent(self):
        del os.environ['TECH_LINE_TARGET_ID']
        make_dump(self.local, '20261106_193000')
        self.run_cli('--alert')
        self.assertEqual(MockLine.calls, [])
        self.assertNotEqual(bs.load_state(self.state).get('status'), 'FAIL')

    def test_ok_run_sends_nothing(self):
        make_dump(self.local, '20261108_193000')
        self.sync()
        self.run_cli('--alert')
        self.assertEqual(MockLine.calls, [])


class PureTests(unittest.TestCase):
    def test_signature_ignores_ok_and_informational(self):
        stages = [{'stage': 'local', 'status': 'OK'}, {'stage': 'offhost', 'status': 'STALE'},
                  {'stage': 'readback', 'status': 'NOT_RUN'}]
        self.assertEqual(bs.signature(stages), 'offhost=STALE')

    def test_sidecar_must_name_the_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, 's')
            p.write_text('a' * 64 + '  other.sql.gz\n')
            self.assertIsNone(bs.sidecar_digest(p, 'lampang_bus_20261108_193000.sql.gz'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
