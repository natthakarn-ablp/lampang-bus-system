#!/usr/bin/env python3
"""Synthetic Linux fixtures for the opt-in frontend publisher."""
import importlib.util
from pathlib import Path
import tempfile
import stat
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("publish-frontend.py")
spec = importlib.util.spec_from_file_location("publisher", SCRIPT)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
REV = "a" * 40


class PublishFrontendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="schoolbus-frontend-fixture-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.project = root / "project"
        self.frontend = self.project / "frontend"
        self.dist = self.frontend / "dist"
        self.state = root / "state"
        self.backups = root / "backups"
        self.manual = self.project / "docs" / "manual-html"
        for path in [self.dist, self.state / "deploy-backend.lock", self.backups, self.manual, self.frontend / "node_modules" / ".bin"]:
            path.mkdir(parents=True)
        (self.state / "deploy-backend.lock" / "owner.12345").write_text("synthetic")
        (self.frontend / "node_modules" / ".bin" / "vite").write_text("#!/bin/sh\nexit 0\n")
        (self.frontend / "node_modules" / ".bin" / "vite").chmod(0o755)
        (self.dist / "index.html").write_bytes(b"old version")
        (self.dist / "manual").symlink_to(self.manual, target_is_directory=True)
        self.responses = []
        self.build_fails = False

    def fake_run(self, *args, cwd=None):
        if "build" in args:
            if self.build_fails:
                raise RuntimeError("synthetic build failure")
            stage = Path(args[args.index("--outDir") + 1])
            (stage / "assets").mkdir()
            (stage / "assets" / "app.js").write_bytes(b"synthetic asset")
            (stage / "index.html").write_bytes(b"new version")

    def fake_output(self, args, **kwargs):
        if args[0] == "git":
            return REV
        self.responses.append(args)
        return b"new version" if not self.bad_origin else b"stale origin"

    def execute(self):
        self.bad_origin = getattr(self, "bad_origin", False)
        with patch.object(publisher.os, "getppid", return_value=12345), \
             patch.object(publisher, "run", side_effect=self.fake_run), \
             patch.object(publisher.subprocess, "check_output", side_effect=self.fake_output):
            publisher.publish(self.project, self.state, self.backups, REV, "https://schoolbuslampang.com/")

    def test_atomic_publish_retains_previous_directory_and_manual_only(self):
        previous_mode = stat.S_IMODE(self.dist.stat().st_mode)
        self.execute()
        self.assertEqual((self.dist / "index.html").read_bytes(), b"new version")
        self.assertEqual(stat.S_IMODE(self.dist.stat().st_mode), previous_mode)
        self.assertEqual(len(list(self.backups.iterdir())), 1)
        self.assertEqual((next(self.backups.iterdir()) / "index.html").read_bytes(), b"old version")
        self.assertTrue((self.dist / "manual").is_symlink())
        self.assertFalse((self.dist / "docs").exists())
        self.assertEqual(len(self.responses), 1)

    def test_origin_mismatch_restores_old_directory(self):
        self.bad_origin = True
        with self.assertRaisesRegex(RuntimeError, "different index"):
            self.execute()
        self.assertEqual((self.dist / "index.html").read_bytes(), b"old version")
        self.assertEqual((next(self.backups.iterdir()) / "index.html").read_bytes(), b"new version")

    def test_build_failure_leaves_live_directory(self):
        self.build_fails = True
        with self.assertRaisesRegex(RuntimeError, "synthetic build failure"):
            self.execute()
        self.assertEqual((self.dist / "index.html").read_bytes(), b"old version")
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_symlinked_live_directory_is_refused(self):
        self.dist.rename(self.frontend / "real-dist")
        self.dist.symlink_to(self.frontend / "real-dist", target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "expected real directory"):
            self.execute()

    def test_missing_lock_owner_is_refused(self):
        (self.state / "deploy-backend.lock" / "owner.12345").unlink()
        with self.assertRaisesRegex(RuntimeError, "does not own"):
            self.execute()

    def test_restore_failure_is_distinct_from_safe_failure(self):
        self.bad_origin = True
        original = publisher.exchange
        calls = [0]

        def exchange_then_fail(left, right):
            calls[0] += 1
            if calls[0] == 2:
                raise OSError("synthetic rollback failure")
            return original(left, right)

        with patch.object(publisher, "exchange", side_effect=exchange_then_fail):
            with self.assertRaises(publisher.RestoreFailed):
                self.execute()
        self.assertEqual((self.dist / "index.html").read_bytes(), b"new version")


if __name__ == "__main__":
    unittest.main()
