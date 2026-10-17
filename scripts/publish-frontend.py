#!/usr/bin/env python3
"""Opt-in frontend stage and atomic exchange, invoked by deploy-backend.sh.

The caller holds deploy-backend.lock and owns the backend rollback. This helper
never reads credentials or writes the database. A failed origin probe exchanges
the previous dist directory back before returning failure.
"""

import argparse
import ctypes
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


def fail(message):
    raise RuntimeError(message)


class RestoreFailed(RuntimeError):
    pass


def exchange(left, right):
    libc = ctypes.CDLL(None, use_errno=True)
    operation = libc.renameat2
    operation.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                          ctypes.c_char_p, ctypes.c_uint)
    operation.restype = ctypes.c_int
    if operation(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def checked_dir(path):
    if path.is_symlink() or not path.is_dir():
        fail(f"expected real directory: {path}")


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=subprocess.DEVNULL)


def publish(project, state, backups, expected_commit, origin):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit):
        fail("expected commit must be a full SHA")
    checked_dir(project)
    checked_dir(state)
    checked_dir(backups)
    project = project.resolve(strict=True)
    state = state.resolve(strict=True)
    backups = backups.resolve(strict=True)
    frontend = project / "frontend"
    dist = frontend / "dist"
    manual = project / "docs" / "manual-html"
    checked_dir(frontend)
    checked_dir(dist)
    checked_dir(manual)
    checked_dir(backups)
    if not (state / "deploy-backend.lock" / f"owner.{os.getppid()}").is_file():
        fail("caller does not own the backend deployment lock")
    head = subprocess.check_output(["git", "-C", str(project), "rev-parse", "HEAD"], text=True).strip()
    if head != expected_commit:
        fail("checkout changed during frontend publication")
    if os.stat(dist).st_dev != os.stat(state).st_dev or os.stat(dist).st_dev != os.stat(backups).st_dev:
        fail("dist, stage and backup must be on the same filesystem")
    build = frontend / "node_modules" / ".bin" / "vite"
    if not build.is_file() or not os.access(build, os.X_OK):
        fail("reviewed frontend build tool is unavailable")
    run("npm", "ls", "--depth=0", cwd=frontend)
    stage = Path(tempfile.mkdtemp(prefix="frontend-stage-", dir=state))
    backup = backups / f"dist.prev-{expected_commit[:12]}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    swapped = False
    old_at = stage
    try:
        run(str(build), "build", "--outDir", str(stage), "--emptyOutDir", cwd=frontend)
        if not (stage / "index.html").is_file() or not (stage / "assets").is_dir():
            fail("frontend build missing index or assets")
        if (stage / "docs").exists() or (stage / "docs").is_symlink():
            fail("frontend build exposes private documentation")
        (stage / "manual").symlink_to(manual, target_is_directory=True)
        expected_index = hashlib.sha256((stage / "index.html").read_bytes()).hexdigest()
        # mkdtemp creates 0700. The web server must retain the live directory's
        # traversal permissions after the atomic exchange.
        stage.chmod(stat.S_IMODE(dist.stat().st_mode))
        if backup.exists() or backup.is_symlink():
            fail("backup name already exists")
        exchange(dist, stage)
        swapped = True
        stage.rename(backup)
        old_at = backup
        if not (dist / "manual").is_symlink() or (dist / "manual").resolve() != manual:
            fail("published manual link does not resolve")
        if (dist / "docs").exists() or (dist / "docs").is_symlink():
            fail("published dist exposes private documentation")
        response = subprocess.check_output([
            "curl", "--silent", "--show-error", "--fail", "--max-time", "8",
            "--noproxy", "*",
            "--resolve", "schoolbuslampang.com:443:127.0.0.1",
            "--header", "Cache-Control: no-cache", origin,
        ])
        if hashlib.sha256(response).hexdigest() != expected_index:
            fail("origin served a different index after frontend exchange")
        print(f"[deploy] Frontend verified at origin; backup={backup}; index_sha256={expected_index}")
    except BaseException:
        if swapped:
            try:
                exchange(dist, old_at)
                print(f"[deploy] Frontend restored from {old_at}", file=sys.stderr)
            except BaseException as rollback_error:
                raise RestoreFailed(f"frontend restore failed: {rollback_error}; previous={old_at}") from rollback_error
        elif stage.is_dir() and not stage.is_symlink():
            shutil.rmtree(stage)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--backups", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--origin", default="https://schoolbuslampang.com/")
    args = parser.parse_args()
    try:
        publish(args.project, args.state, args.backups, args.expected_commit, args.origin)
    except RestoreFailed as error:
        print(f"[deploy] URGENT: {error}", file=sys.stderr)
        sys.exit(2)
    except BaseException as error:
        print(f"[deploy] Frontend publication failed: {error}", file=sys.stderr)
        sys.exit(1)
