"""Temporary synthetic inputs only; no production paths, config, or keys."""
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tool(variable: str, command: str) -> str:
    selected = os.environ.get(variable) or shutil.which(command)
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        raise RuntimeError(f'Set {variable} to the reviewed {command} executable')
    return selected


def create_snapshot(root: Path, sealer, keygen: str) -> dict:
    snapshot = root / 'backup-synthetic'
    snapshot.mkdir(mode=0o700)
    identity = root / 'synthetic-identity.txt'
    subprocess.run([keygen, '-o', str(identity)], check=True, capture_output=True)
    public = subprocess.check_output([keygen, '-y', str(identity)])
    recipient = root / 'public-recipient.txt'
    recipient.write_bytes(public)
    recipient.chmod(0o600)
    payloads = {name: (('SYNTHETIC_ONLY:' + name + '\n') * 500).encode()
                for name in sealer.ARTIFACTS}
    for name, body in payloads.items():
        path = snapshot / name
        path.write_bytes(body)
        path.chmod(0o600)
    manifest = ''.join(hashlib.sha256(body).hexdigest() + '  ' + name + '\n'
                       for name, body in sorted(payloads.items()))
    manifest_path = snapshot / 'SHA256SUMS'
    manifest_path.write_text(manifest, encoding='ascii')
    manifest_path.chmod(0o600)
    return dict(snapshot=snapshot, identity=identity, recipient=recipient,
                recipient_sha=hashlib.sha256(public).hexdigest(),
                payloads=payloads, manifest=manifest)
