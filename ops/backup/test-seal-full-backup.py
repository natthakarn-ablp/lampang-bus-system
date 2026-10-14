#!/usr/bin/env python3
"""Real age CLI and synthetic data only; never opens production snapshots."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import sys
from synthetic_fixture import create_snapshot, load, tool

seal = load('seal', 'seal-full-backup.py')
AGE = tool('AGE_TEST_BIN', 'age')
KEYGEN = tool('AGE_TEST_KEYGEN', 'age-keygen')


class SealingSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='schoolbus-age-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture = create_snapshot(self.root, seal, KEYGEN)
        self.snapshot, self.key = fixture['snapshot'], fixture['identity']
        self.recipient, self.recipient_sha = fixture['recipient'], fixture['recipient_sha']
        self.payloads, self.manifest = fixture['payloads'], fixture['manifest']
        self.output = self.root / 'sealed'

    def encrypt(self, age=AGE):
        return seal.seal(self.snapshot, self.root, self.recipient, self.recipient_sha, age, self.output)

    def decrypted(self, key=None, cipher=None):
        return subprocess.run([AGE, '-d', '-i', str(key or self.key),
                               str(cipher or self.output / 'snapshot.tar.gz.age')], capture_output=True)

    def test_roundtrip_exact_artifacts_and_manifest(self):
        metadata = self.encrypt()
        result = self.decrypted()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(hashlib.sha256(result.stdout).hexdigest(), metadata['plaintext_archive_sha256'])
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode='r:gz') as archive:
            self.assertEqual(set(archive.getnames()), seal.ARTIFACTS | {'SHA256SUMS'})
            for member in archive.getmembers():
                self.assertTrue(member.isfile())
                self.assertEqual(member.mode, 0o600)
                expected = self.manifest.encode() if member.name == 'SHA256SUMS' else self.payloads[member.name]
                self.assertEqual(archive.extractfile(member).read(), expected)
        self.assertTrue((self.output / 'COMPLETE').is_file())

    def test_wrong_key_rejected(self):
        self.encrypt()
        wrong = self.root / 'wrong-fixture-identity.txt'
        subprocess.run([KEYGEN, '-o', str(wrong)], check=True, capture_output=True)
        self.assertNotEqual(self.decrypted(key=wrong).returncode, 0)

    def test_tampered_cipher_rejected(self):
        self.encrypt()
        data = bytearray((self.output / 'snapshot.tar.gz.age').read_bytes())
        data[-12] ^= 1
        broken = self.root / 'broken.age'
        broken.write_bytes(data)
        self.assertNotEqual(self.decrypted(cipher=broken).returncode, 0)

    def test_changed_source_refused(self):
        (self.snapshot / 'backend.env').write_bytes(b'SYNTHETIC_CORRUPTION')
        with self.assertRaises(ValueError):
            self.encrypt()
        self.assertFalse(self.output.exists())

    def test_symlink_refused(self):
        target = self.snapshot / 'backend.env'
        target.unlink()
        target.symlink_to(self.recipient)
        with self.assertRaises((ValueError, OSError)):
            self.encrypt()

    def test_hardlink_refused(self):
        os.link(self.snapshot / 'backend.env', self.root / 'hardlink')
        with self.assertRaises(ValueError):
            self.encrypt()

    def test_broad_permissions_refused(self):
        (self.snapshot / 'backend.env').chmod(0o640)
        with self.assertRaises(ValueError):
            self.encrypt()

    def test_unexpected_file_refused(self):
        (self.snapshot / 'unexpected-identity.txt').write_text('synthetic unexpected file')
        with self.assertRaises(ValueError):
            self.encrypt()

    def test_duplicate_manifest_entry_refused(self):
        (self.snapshot / 'SHA256SUMS').write_text(self.manifest + self.manifest.splitlines()[0] + '\n')
        with self.assertRaises(ValueError):
            self.encrypt()

    def test_output_not_overwritten(self):
        self.encrypt()
        digest = hashlib.sha256((self.output / 'snapshot.tar.gz.age').read_bytes()).hexdigest()
        with self.assertRaises(ValueError):
            self.encrypt()
        self.assertEqual(digest, hashlib.sha256((self.output / 'snapshot.tar.gz.age').read_bytes()).hexdigest())

    def test_changed_recipient_refused(self):
        self.recipient_sha = '0' * 64
        with self.assertRaises(ValueError):
            self.encrypt()

    def test_recipient_changed_after_check_still_encrypts_to_verified_owner(self):
        wrong = self.root / 'wrong-fixture-identity.txt'
        subprocess.run([KEYGEN, '-o', str(wrong)], check=True, capture_output=True)
        replacement = subprocess.check_output([KEYGEN, '-y', str(wrong)])
        real_popen = subprocess.Popen
        def swap_file_then_encrypt(*args, **kwargs):
            self.recipient.write_bytes(replacement)
            return real_popen(*args, **kwargs)
        with patch.object(seal.subprocess, 'Popen', side_effect=swap_file_then_encrypt):
            self.encrypt()
        self.assertEqual(self.decrypted().returncode, 0)
        self.assertNotEqual(self.decrypted(key=wrong).returncode, 0)

    def test_failed_age_never_marks_complete(self):
        with self.assertRaises((RuntimeError, BrokenPipeError)):
            self.encrypt('/usr/bin/false')
        self.assertFalse((self.output / 'COMPLETE').exists())
        self.assertTrue((self.snapshot / 'backend.env').is_file())

    def test_wrong_parent_refused(self):
        with self.assertRaises(ValueError):
            seal.seal(self.snapshot, self.root / 'other', self.recipient,
                      self.recipient_sha, AGE, self.output)


    def test_cli_wrong_output_parent_refused(self):
        argv=['seal','--snapshot',str(self.snapshot),'--recipient-file',str(self.recipient),'--recipient-sha256',self.recipient_sha,'--output',str(self.output)]
        with patch.object(sys,'argv',argv),patch.object(seal,'AGE_BINARY',AGE),self.assertRaisesRegex(ValueError,'output outside'):
            seal.main()
        self.assertFalse(self.output.exists())

    def test_cli_modified_binary_digest_refused(self):
        argv=['seal','--snapshot',str(self.snapshot),'--recipient-file',str(self.recipient),'--recipient-sha256',self.recipient_sha,'--output',str(self.output)]
        with patch.object(sys,'argv',argv),patch.object(seal,'AGE_BINARY',AGE),patch.object(seal,'sha_file',return_value='0'*64),self.assertRaisesRegex(ValueError,'age binary changed'):
            seal.main()

if __name__ == '__main__':
    os.umask(0o077)
    unittest.main(verbosity=2)
