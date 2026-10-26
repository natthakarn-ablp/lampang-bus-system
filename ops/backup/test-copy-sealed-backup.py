#!/usr/bin/env python3
"""Real rclone local backend; never contacts Google Drive or production data."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from synthetic_fixture import create_snapshot, load, tool

copy_sealed = load('copy_sealed', 'copy-sealed-backup.py')
sealer = load('seal', 'seal-full-backup.py')
RCLONE = tool('RCLONE_TEST_BIN', 'rclone')


class ImmutableCopySafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.synthetic_temp = tempfile.TemporaryDirectory(prefix='schoolbus-copy-input-fixture-')
        cls.addClassCleanup(cls.synthetic_temp.cleanup)
        root = Path(cls.synthetic_temp.name)
        fixture = create_snapshot(root, sealer, tool('AGE_TEST_KEYGEN', 'age-keygen'))
        cls.synthetic_package = root / 'sealed'
        sealer.seal(fixture['snapshot'], root, fixture['recipient'], fixture['recipient_sha'],
                    tool('AGE_TEST_BIN', 'age'), cls.synthetic_package)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='schoolbus-copy-cipher-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / 'snapshot-20261014T000000'
        self.package.mkdir(mode=0o700)
        self.metadata = json.loads((self.synthetic_package / 'metadata.json').read_bytes())
        self.package.joinpath('snapshot.tar.gz.age').write_bytes((self.synthetic_package / 'snapshot.tar.gz.age').read_bytes())
        self.package.joinpath('snapshot.tar.gz.age.sha256').write_text(self.metadata['ciphertext_sha256'] + '  snapshot.tar.gz.age\n')
        self.package.joinpath('metadata.json').write_text(json.dumps(self.metadata))
        self.package.joinpath('COMPLETE').write_text('complete\n')
        for p in self.package.iterdir():
            p.chmod(0o600)
        self.recipient_sha = self.metadata['recipient_public_sha256']
        self.proof = {
            'recipient_public_sha256': self.recipient_sha,
            'owner_identity_restore_verified': True,
            'independent_identity_copy_verified': True,
            'verified_at': '2026-10-14T00:00:00+00:00',
        }
        self.custody = self.root / 'synthetic-custody-receipt.json'
        self.write_proof()
        self.remote = self.root / 'synthetic-remote'
        self.remote.mkdir(mode=0o700)
        self.readback = self.root / 'readback-attempt'

    def write_proof(self):
        self.custody.write_text(json.dumps(self.proof))
        self.custody.chmod(0o600)
        self.custody_sha = hashlib.sha256(self.custody.read_bytes()).hexdigest()

    def run_copy(self, quota=None, copier=copy_sealed.rclone_copy):
        return copy_sealed.transfer(
            self.package, self.custody, self.custody_sha, self.recipient_sha,
            self.remote, RCLONE, self.readback,
            lambda: quota if quota is not None else {'free': 1024 * 1024 * 1024}, copy=copier,
        )

    def test_copy_readback_only_cipher_artifacts_and_preserves_other_files(self):
        old = self.remote / 'existing-database-backup.sql.gz'
        old.write_bytes(b'SYNTHETIC_OLD_BACKUP')
        receipt = self.run_copy()
        self.assertTrue(receipt['offhost_byte_comparison_passed'])
        destination = self.remote / self.package.name
        self.assertEqual(set(os.listdir(destination)), set(copy_sealed.FILES) | {'COMPLETE'})
        for name in copy_sealed.FILES:
            self.assertEqual((destination / name).read_bytes(), (self.package / name).read_bytes())
        self.assertEqual(old.read_bytes(), b'SYNTHETIC_OLD_BACKUP')

    def test_missing_custody_refused_before_copy(self):
        self.custody.unlink()
        with self.assertRaises(FileNotFoundError): self.run_copy()
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_independent_copy_not_verified_refused(self):
        self.proof['independent_identity_copy_verified'] = False
        self.write_proof()
        with self.assertRaises(ValueError): self.run_copy()
        self.assertFalse(self.readback.exists())

    def test_changed_receipt_hash_refused(self):
        self.custody_sha = '0' * 64
        with self.assertRaises(ValueError): self.run_copy()

    def test_recipient_binding_refused(self):
        self.recipient_sha = '0' * 64
        with self.assertRaises(ValueError): self.run_copy()

    def test_corrupt_cipher_refused(self):
        self.package.joinpath('snapshot.tar.gz.age').write_bytes(b'SYNTHETIC_NOT_CIPHERTEXT')
        with self.assertRaises(ValueError): self.run_copy()

    def test_partial_package_refused(self):
        self.package.joinpath('COMPLETE').unlink()
        with self.assertRaises(ValueError): self.run_copy()

    def test_plaintext_or_key_extra_file_refused(self):
        self.package.joinpath('backend.env').write_bytes(b'SYNTHETIC_PLAINTEXT')
        with self.assertRaises(ValueError): self.run_copy()
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_metadata_unknown_secret_field_refused(self):
        self.metadata['unexpected_secret'] = 'SYNTHETIC_ONLY'
        self.package.joinpath('metadata.json').write_text(json.dumps(self.metadata))
        with self.assertRaises(ValueError): self.run_copy()

    def test_duplicate_metadata_property_refused(self):
        original = json.dumps(self.metadata)
        self.package.joinpath('metadata.json').write_text('{"snapshot_label":"SYNTHETIC_PRIVATE",' + original[1:])
        with self.assertRaises(ValueError): self.run_copy()
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_non_integer_metadata_count_refused(self):
        self.metadata['artifact_count'] = 8.0
        self.package.joinpath('metadata.json').write_text(json.dumps(self.metadata))
        with self.assertRaises(ValueError): self.run_copy()
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_non_integer_cipher_size_refused(self):
        self.metadata['ciphertext_bytes'] = float(self.metadata['ciphertext_bytes'])
        self.package.joinpath('metadata.json').write_text(json.dumps(self.metadata))
        with self.assertRaises(ValueError): self.run_copy()
        self.assertFalse(self.readback.exists())

    def test_duplicate_custody_property_refused(self):
        self.custody.write_text('{"independent_identity_copy_verified":false,' + json.dumps(self.proof)[1:])
        self.custody_sha = hashlib.sha256(self.custody.read_bytes()).hexdigest()
        with self.assertRaises(ValueError): self.run_copy()
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_broad_cipher_permissions_refused(self):
        self.package.joinpath('snapshot.tar.gz.age').chmod(0o644)
        with self.assertRaises(ValueError): self.run_copy()

    def test_symlink_refused(self):
        p = self.package / 'metadata.json'
        p.unlink()
        p.symlink_to(self.custody)
        with self.assertRaises((ValueError, OSError)): self.run_copy()

    def test_free_capacity_insufficient_refused(self):
        with self.assertRaises(ValueError): self.run_copy({'free': 0})
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_free_capacity_unknown_refused(self):
        with self.assertRaises(ValueError): self.run_copy({'total': 1024 ** 3})
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_remote_existing_different_same_size_cipher_not_overwritten(self):
        destination = self.remote / self.package.name
        destination.mkdir(mode=0o700)
        existing = destination / 'snapshot.tar.gz.age'
        data = bytearray(self.package.joinpath('snapshot.tar.gz.age').read_bytes())
        data[-12] ^= 1
        existing.write_bytes(data)
        with self.assertRaises(RuntimeError): self.run_copy()
        self.assertEqual(existing.read_bytes(), bytes(data))
        self.assertFalse((destination / 'COMPLETE').exists())

    def test_failed_readback_never_marks_remote_complete(self):
        corrupted = False
        def corrupt_once(rclone, src, dst):
            nonlocal corrupted
            copy_sealed.rclone_copy(rclone, src, dst)
            if str(src).endswith('metadata.json') and 'validated-outbound' in str(src) and not corrupted:
                cipher = self.remote / self.package.name / 'snapshot.tar.gz.age'
                data = bytearray(cipher.read_bytes())
                data[-12] ^= 1
                cipher.write_bytes(data)
                corrupted = True
        with self.assertRaises(RuntimeError): self.run_copy(copier=corrupt_once)
        self.assertFalse((self.remote / self.package.name / 'COMPLETE').exists())
        self.assertFalse((self.readback / 'UPLOAD_VERIFIED.json').exists())

    def test_existing_readback_attempt_refused(self):
        self.readback.mkdir(mode=0o700)
        with self.assertRaises(ValueError): self.run_copy()
        self.assertEqual(list(self.remote.iterdir()), [])


if __name__ == '__main__':
    os.umask(0o077)
    unittest.main(verbosity=2)
