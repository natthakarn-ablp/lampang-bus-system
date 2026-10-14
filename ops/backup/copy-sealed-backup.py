#!/usr/bin/env python3
"""Copy only sealed artifacts; production CLI is pinned to the existing Drive."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

FILES = ('snapshot.tar.gz.age', 'snapshot.tar.gz.age.sha256', 'metadata.json')
META_FIELDS = frozenset({
    'created_at', 'snapshot_label', 'artifact_count', 'archive_entries',
    'recipient_public_sha256', 'plaintext_archive_sha256', 'plaintext_archive_bytes',
    'ciphertext_sha256', 'ciphertext_bytes', 'identity_required_for_sealing',
    'whole_server_restore_proven',
})
PROOF_FIELDS = frozenset({
    'recipient_public_sha256', 'owner_identity_restore_verified',
    'independent_identity_copy_verified', 'verified_at',
})
LIMIT = 64 * 1024 * 1024


def read_private(path, cap):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        st = os.fstat(f.fileno())
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid()
                or st.st_nlink != 1 or stat.S_IMODE(st.st_mode) != 0o600
                or st.st_size > cap):
            raise ValueError('private regular artifact required')
        body = f.read(cap + 1)
        if len(body) != st.st_size or len(body) > cap:
            raise ValueError('artifact changed or exceeded size cap')
        return body


def private_dir(path):
    st = path.lstat()
    if (not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid()
            or stat.S_IMODE(st.st_mode) != 0o700):
        raise ValueError('private directory required')


def write_private(path, body):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())


def hex_digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value)


def iso_date(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError('invalid timestamp')
    dt = datetime.datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError('timezone required')


def json_without_duplicates(body):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON property')
            result[key] = value
        return result
    return json.loads(body, object_pairs_hook=pairs)


def package_and_proof(package, custody, custody_sha, recipient_sha):
    private_dir(package)
    if set(os.listdir(package)) != set(FILES) | {'COMPLETE'}:
        raise ValueError('sealed directory allowlist mismatch')
    if read_private(package / 'COMPLETE', 32) != b'complete\n':
        raise ValueError('package is incomplete')
    proof_body = read_private(custody, 8192)
    if hashlib.sha256(proof_body).hexdigest() != custody_sha:
        raise ValueError('owner custody receipt changed')
    proof = json_without_duplicates(proof_body)
    if (set(proof) != PROOF_FIELDS or not hex_digest(recipient_sha)
            or proof['recipient_public_sha256'] != recipient_sha
            or proof['owner_identity_restore_verified'] is not True
            or proof['independent_identity_copy_verified'] is not True):
        raise ValueError('independent owner recovery proof required')
    iso_date(proof['verified_at'])
    blobs = {name: read_private(package / name, LIMIT if name.endswith('.age') else 8192)
             for name in FILES}
    metadata = json_without_duplicates(blobs['metadata.json'])
    if (set(metadata) != META_FIELDS or type(metadata['artifact_count']) is not int
            or metadata['artifact_count'] != 8
            or type(metadata['archive_entries']) is not int or metadata['archive_entries'] != 9
            or metadata['recipient_public_sha256'] != recipient_sha
            or metadata['identity_required_for_sealing'] is not False
            or metadata['whole_server_restore_proven'] is not False
            or not hex_digest(metadata['plaintext_archive_sha256'])
            or not hex_digest(metadata['ciphertext_sha256'])
            or type(metadata['plaintext_archive_bytes']) is not int
            or not 1 <= metadata['plaintext_archive_bytes'] <= 512 * 1024 * 1024
            or not isinstance(metadata['snapshot_label'], str)
            or not re.fullmatch(r'backup-[A-Za-z0-9-]{1,80}', metadata['snapshot_label'])):
        raise ValueError('sealed metadata schema mismatch')
    iso_date(metadata['created_at'])
    cipher = blobs[FILES[0]]
    digest = hashlib.sha256(cipher).hexdigest()
    if (not cipher.startswith(b'age-encryption.org/v1\n')
            or type(metadata['ciphertext_bytes']) is not int
            or metadata['ciphertext_bytes'] != len(cipher)
            or metadata['ciphertext_sha256'] != digest
            or blobs[FILES[1]] != (digest + '  snapshot.tar.gz.age\n').encode()):
        raise ValueError('sealed ciphertext integrity mismatch')
    return blobs, metadata


def rclone_copy(rclone, source, destination):
    source_parent, source_name = str(source).rsplit('/', 1)
    destination_parent, destination_name = str(destination).rsplit('/', 1)
    if source_name != destination_name or source_name not in (*FILES, 'COMPLETE'):
        raise ValueError('copy filename outside fixed cipher allowlist')
    # On the tested v1.75.0 local backend, copyto overwrote a conflicting
    # fixture despite --immutable. Directory copy refused that same conflict.
    result = subprocess.run([
        str(rclone), 'copy', source_parent, destination_parent, '--immutable',
        '--filter', '+ /' + source_name, '--filter', '- **',
        '--checksum', '--no-update-modtime', '--retries', '1',
        '--low-level-retries', '1', '--max-duration', '2m',
        '--max-transfer', str(LIMIT), '--tpslimit', '2',
    ], capture_output=True, timeout=150)
    if result.returncode != 0:
        # Provider output is private and can contain account/config details.
        raise RuntimeError('immutable artifact copy failed')


def transfer(package, custody, custody_sha, recipient_sha, remote_root,
             rclone, readback, quota_reader, copy=rclone_copy):
    package, readback, custody = Path(package), Path(readback), Path(custody)
    if not re.fullmatch(r'snapshot-[0-9T-]+', package.name):
        raise ValueError('unexpected sealed snapshot label')
    blobs, metadata = package_and_proof(package, custody, custody_sha, recipient_sha)
    private_dir(readback.parent)
    if readback.exists() or readback.is_symlink():
        raise ValueError('readback attempt exists; inspect before retrying')
    quota = quota_reader()
    needed = sum(len(body) for body in blobs.values()) + 1024 * 1024
    if not isinstance(quota, dict) or type(quota.get('free')) is not int or quota['free'] < needed:
        raise ValueError('included free storage unknown or insufficient')
    readback.mkdir(mode=0o700)
    # Freeze only validated bytes; rclone never receives the original source
    # directory or an arbitrary filename selected by a glob.
    frozen = readback / 'validated-outbound'
    inbound = readback / 'ciphertext-readback'
    frozen.mkdir(mode=0o700)
    inbound.mkdir(mode=0o700)
    for name, body in blobs.items():
        write_private(frozen / name, body)
    destination = str(remote_root).rstrip('/') + '/' + package.name
    for name in FILES:
        copy(rclone, frozen / name, destination + '/' + name)
    for name in FILES:
        copy(rclone, destination + '/' + name, inbound / name)
        # Local rclone creates files using this CLI's umask; verify exact bytes.
        if read_private(inbound / name, LIMIT if name.endswith('.age') else 8192) != blobs[name]:
            raise RuntimeError('offhost readback bytes mismatch')
    # Remote COMPLETE is published only after all three readbacks match.
    write_private(frozen / 'COMPLETE', b'complete\n')
    copy(rclone, frozen / 'COMPLETE', destination + '/COMPLETE')
    copy(rclone, destination + '/COMPLETE', inbound / 'COMPLETE')
    if read_private(inbound / 'COMPLETE', 32) != b'complete\n':
        raise RuntimeError('remote completion marker mismatch')
    receipt = {
        'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'snapshot_tag': package.name,
        'ciphertext_sha256': metadata['ciphertext_sha256'],
        'plaintext_archive_sha256': metadata['plaintext_archive_sha256'],
        'recipient_public_sha256': recipient_sha,
        'custody_receipt_sha256': custody_sha,
        'offhost_byte_comparison_passed': True,
        'whole_server_restore_proven': False,
    }
    write_private(readback / 'UPLOAD_VERIFIED.json', json.dumps(receipt, indent=2).encode() + b'\n')
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True)
    parser.add_argument('--custody-receipt', required=True)
    parser.add_argument('--custody-receipt-sha256', required=True)
    parser.add_argument('--recipient-sha256', required=True)
    parser.add_argument('--readback', required=True)
    args = parser.parse_args()
    package, readback = Path(args.package), Path(args.readback)
    if (package.parent != Path('/home/schoolbus/backups/full-system-encrypted')
            or readback.parent != Path('/home/schoolbus/backups/full-system-readback')):
        raise ValueError('artifact path outside reviewed directories')
    rclone = '/home/schoolbus/.local/bin/rclone'
    digest = hashlib.sha256()
    with open(rclone, 'rb') as executable:
        while chunk := executable.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != 'f3f9aff817f9766029e50adf9a7963c169e475b8f10c7927823568a0d9443db7':
        raise ValueError('tested rclone executable changed')
    import fcntl
    fd = os.open('/home/schoolbus/deploy-state/encrypted-offhost.lock',
                 os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        st = os.fstat(lock.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_nlink != 1 or stat.S_IMODE(st.st_mode) != 0o600:
            raise ValueError('unsafe upload lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if Path('/home/schoolbus/deploy-state/deploy-backend.lock').exists():
            raise RuntimeError('deployment is pending')
        def quota_reader():
            result = subprocess.run([rclone, 'about', 'gdrive:', '--json'],
                                    capture_output=True, timeout=30)
            if result.returncode != 0:
                raise RuntimeError('existing Drive quota read failed')
            return json.loads(result.stdout)
        print(json.dumps(transfer(
            package, args.custody_receipt, args.custody_receipt_sha256,
            args.recipient_sha256, 'gdrive:lampang-bus-backups/full-system',
            rclone, readback, quota_reader,
        )))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        print(json.dumps({'error_type': type(error).__name__, 'offhost_verified': False}))
        raise SystemExit(1)
