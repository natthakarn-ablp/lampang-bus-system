#!/usr/bin/env python3
"""Seal a verified private snapshot; never read or upload an identity key."""
import argparse
import contextlib
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile

ARTIFACTS = frozenset({
    'backend.env', 'database.sql', 'db-backup.env', 'rclone.conf',
    'nginx-schoolbus.conf', 'nginx-schoolbus-503200.conf',
    'pm2-processes.json', 'uploads.tar.gz',
})
MAX_BYTES = 512 * 1024 * 1024
AGE_BINARY = '/home/schoolbus/deploy-state/age-v1.3.2/age/age'
AGE_SHA256 = 'eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c'


def require_private(st, directory=False):
    expected_mode = 0o700 if directory else 0o600
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if (not expected_type(st.st_mode) or st.st_uid != os.getuid()
            or stat.S_IMODE(st.st_mode) != expected_mode
            or (not directory and st.st_nlink != 1)):
        raise ValueError('private ownership/type/mode check failed')


def sha_file(f):
    f.seek(0)
    digest = hashlib.sha256()
    while chunk := f.read(1024 * 1024):
        digest.update(chunk)
    f.seek(0)
    return digest.hexdigest()


def write_private(path, body):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf8') as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())


class ArchiveSink:
    def __init__(self, pipe):
        self.pipe = pipe
        self.digest = hashlib.sha256()
        self.bytes = 0

    def write(self, data):
        written = self.pipe.write(data)
        if written != len(data):
            raise IOError('short archive write')
        self.digest.update(data)
        self.bytes += written
        return written

    def flush(self):
        self.pipe.flush()


def seal(snapshot, allowed_parent, recipient_file, recipient_sha, age, output_dir):
    snapshot, allowed_parent = Path(snapshot), Path(allowed_parent)
    output_dir, recipient_file = Path(output_dir), Path(recipient_file)
    if (snapshot.parent.resolve() != allowed_parent.resolve()
            or snapshot.is_symlink() or not snapshot.name.startswith('backup-')):
        raise ValueError('snapshot outside approved parent or unexpected type')
    require_private(snapshot.lstat(), directory=True)
    require_private(output_dir.parent.lstat(), directory=True)
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError('output already exists; inspect instead of overwriting')
    require_private(recipient_file.lstat())
    recipient_bytes = recipient_file.read_bytes()
    if hashlib.sha256(recipient_bytes).hexdigest() != recipient_sha:
        raise ValueError('public recipient hash mismatch')
    if not re.fullmatch(rb'age1[0-9a-z]{58}\r?\n?', recipient_bytes):
        raise ValueError('expected one native age public recipient')
    if not Path(age).is_absolute() or not Path(age).is_file():
        raise ValueError('age executable unavailable')

    process = None
    with contextlib.ExitStack() as stack:
        dir_fd = os.open(snapshot, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
        stack.callback(os.close, dir_fd)
        require_private(os.fstat(dir_fd), directory=True)
        if set(os.listdir(dir_fd)) != ARTIFACTS | {'SHA256SUMS'}:
            raise ValueError('snapshot contains missing or unexpected artifacts')

        def open_source(name):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
            try:
                require_private(os.fstat(fd))
            except BaseException:
                os.close(fd)
                raise
            return stack.enter_context(os.fdopen(fd, 'rb'))

        manifest = open_source('SHA256SUMS').read(16385)
        if len(manifest) > 16384:
            raise ValueError('oversized manifest')
        hashes = {}
        for line in manifest.decode('ascii').splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.-]+)', line)
            if not match or match[2] not in ARTIFACTS or match[2] in hashes:
                raise ValueError('invalid or duplicate manifest entry')
            hashes[match[2]] = match[1]
        if set(hashes) != ARTIFACTS:
            raise ValueError('manifest must cover every artifact')
        sources = {name: open_source(name) for name in sorted(ARTIFACTS)}
        original_stats = {name: os.fstat(f.fileno()) for name, f in sources.items()}
        if sum(s.st_size for s in original_stats.values()) > MAX_BYTES:
            raise ValueError('snapshot exceeds reviewed size cap')
        for name, f in sources.items():
            if sha_file(f) != hashes[name]:
                raise ValueError('snapshot checksum mismatch')

        output_dir.mkdir(mode=0o700)
        ciphertext = output_dir / 'snapshot.tar.gz.age'
        partial = output_dir / 'snapshot.tar.gz.age.partial'
        try:
            fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as target:
                process = subprocess.Popen(
                    # Bind encryption to the exact public bytes just verified,
                    # rather than reopening a file that may change afterwards.
                    [str(age), '-r', recipient_bytes.decode('ascii').strip()], stdin=subprocess.PIPE,
                    stdout=target, stderr=subprocess.PIPE,
                )
                sink = ArchiveSink(process.stdin)
                with tarfile.open(mode='w|gz', fileobj=sink) as archive:
                    for name, source in sources.items():
                        info = tarfile.TarInfo(name)
                        info.size = original_stats[name].st_size
                        info.mode = 0o600
                        archive.addfile(info, source)
                        if sha_file(source) != hashes[name]:
                            raise ValueError('artifact changed during archive read')
                        current = os.fstat(source.fileno())
                        before = original_stats[name]
                        require_private(current)
                        if (current.st_size, current.st_mtime_ns, current.st_ctime_ns) != (
                                before.st_size, before.st_mtime_ns, before.st_ctime_ns):
                            raise ValueError('artifact metadata changed during packaging')
                    manifest_info = tarfile.TarInfo('SHA256SUMS')
                    manifest_info.size = len(manifest)
                    manifest_info.mode = 0o600
                    archive.addfile(manifest_info, io.BytesIO(manifest))
                sink.flush()
                process.stdin.close()
                # Age errors are captured, never printed alongside sensitive input.
                process.stderr.read()
                if process.wait(timeout=30) != 0:
                    raise RuntimeError('age encryption failed')
                target.flush()
                os.fsync(target.fileno())
            with partial.open('rb') as f:
                cipher_sha = sha_file(f)
            # Exclusive publication: a second invocation cannot replace this artifact.
            os.link(partial, ciphertext)
            partial.unlink()
            metadata = {
                'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'snapshot_label': snapshot.name,
                'artifact_count': len(sources),
                'archive_entries': len(sources) + 1,
                'recipient_public_sha256': recipient_sha,
                'plaintext_archive_sha256': sink.digest.hexdigest(),
                'plaintext_archive_bytes': sink.bytes,
                'ciphertext_sha256': cipher_sha,
                'ciphertext_bytes': ciphertext.stat().st_size,
                'identity_required_for_sealing': False,
                'whole_server_restore_proven': False,
            }
            write_private(output_dir / 'snapshot.tar.gz.age.sha256', cipher_sha + '  snapshot.tar.gz.age\n')
            write_private(output_dir / 'metadata.json', json.dumps(metadata, indent=2) + '\n')
            # Upload wrappers must require this final marker before using any output.
            write_private(output_dir / 'COMPLETE', 'complete\n')
            return metadata
        except BaseException:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            # Leave any partial artifact in this private unique directory for inspection.
            # Never create COMPLETE on failure, and never remove source backups.
            raise
        finally:
            if process:
                if process.stdin and not process.stdin.closed:
                    try:
                        process.stdin.close()
                    except BrokenPipeError:
                        pass
                if process.stderr:
                    process.stderr.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--recipient-file', required=True)
    parser.add_argument('--recipient-sha256', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    age = AGE_BINARY
    with open(age, 'rb') as executable:
        if sha_file(executable) != AGE_SHA256:
            raise ValueError('reviewed age binary changed')
    backup_parent = Path('/home/schoolbus/backups')
    output = Path(args.output)
    if output.parent != backup_parent / 'full-system-encrypted' or not re.fullmatch(r'snapshot-[0-9T-]+', output.name):
        raise ValueError('output outside reviewed backup directory')
    metadata = seal(args.snapshot, backup_parent, args.recipient_file,
                    args.recipient_sha256, age, output)
    print(json.dumps(metadata))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error_type': type(error).__name__, 'complete': False}))
        raise SystemExit(1)
