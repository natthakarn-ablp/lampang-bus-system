#!/usr/bin/env python3
"""Report backup readiness as four separate stages (DATA-001).

Stages, each with its own status so one success never stands in for another:

  local    a fresh dump exists on this host, its sha256 sidecar matches and
           gzip decodes it end to end            ("backup can be created")
  offhost  the destination itself lists a fresh dump + sidecar whose size
           matches the local copy, read with rclone  ("reached the destination")
           The local marker file is NOT used as evidence.
  readback (only with --readback) the newest remote dump is downloaded into a
           private temporary directory, checked against the remote sidecar and
           gunzipped end to end, then deleted   ("can be read back")
  restore  read-only report of the newest restore-drill evidence file, if
           any; this tool never restores anything  ("can be restored into a DB")

Status codes (stable, used for alert signatures):
  OK, STALE, MISSING, CHECKSUM_MISSING, CHECKSUM_MISMATCH, GZIP_BAD,
  SIZE_MISMATCH, UNREACHABLE, NOT_RUN, UNPROVEN

Exit code: 0 when local+offhost (+readback if requested) are OK, 1 otherwise.
The restore stage never changes the exit code; an unproven restore is reported,
not alarmed on every run.

Alerting (--alert): a FAIL is sent once per distinct failure signature, at most
once per --alert-repeat-hours while it persists, and one recovery message is
sent after the first fully OK run. Messages carry only stage names, status
codes, ages and backup file names. The token and target come from the
environment (LINE_CHANNEL_ACCESS_TOKEN, TECH_LINE_TARGET_ID), normally the
existing /etc/schoolbus/health-alert.env; they are never printed.

No database access, no writes outside --state-dir and a private temp dir.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

DUMP_RE = re.compile(r'^lampang_bus_(\d{8})_(\d{6})\.sql\.gz$')
LINE_PUSH = 'https://api.line.me/v2/bot/message/push'
FAILING = {'STALE', 'MISSING', 'CHECKSUM_MISSING', 'CHECKSUM_MISMATCH',
           'GZIP_BAD', 'SIZE_MISMATCH', 'UNREACHABLE'}


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def dump_time(name, tz):
    """Creation time encoded in the dump name (backup-db.sh uses the host clock)."""
    m = DUMP_RE.match(name)
    if not m:
        return None
    return dt.datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S').replace(tzinfo=tz)


def age_hours(when, now):
    return round((now - when).total_seconds() / 3600, 1)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def gzip_ok(path):
    try:
        with gzip.open(path, 'rb') as f:
            while f.read(1 << 20):
                pass
        return True
    except (OSError, EOFError, gzip.BadGzipFile):
        return False


def sidecar_digest(path, name):
    try:
        text = Path(path).read_text(encoding='ascii').strip()
    except (OSError, UnicodeDecodeError):
        return None
    parts = text.split()
    if len(parts) != 2 or not re.fullmatch('[0-9a-f]{64}', parts[0]):
        return None
    if parts[1].lstrip('*') != name:
        return None
    return parts[0]


def newest_dump(names, tz):
    dated = [(dump_time(n, tz), n) for n in names]
    dated = [d for d in dated if d[0] is not None]
    return max(dated) if dated else (None, None)


def check_local(backup_dir, max_age_h, now, tz):
    try:
        names = os.listdir(backup_dir)
    except OSError:
        return {'stage': 'local', 'status': 'MISSING', 'detail': 'backup directory unreadable'}
    when, name = newest_dump(names, tz)
    if not name:
        return {'stage': 'local', 'status': 'MISSING', 'detail': 'no lampang_bus_*.sql.gz'}
    res = {'stage': 'local', 'file': name, 'age_hours': age_hours(when, now),
           'bytes': os.path.getsize(os.path.join(backup_dir, name))}
    side = os.path.join(backup_dir, name + '.sha256')
    if not os.path.exists(side):
        res['status'] = 'CHECKSUM_MISSING'
    elif sidecar_digest(side, name) != sha256_file(os.path.join(backup_dir, name)):
        res['status'] = 'CHECKSUM_MISMATCH'
    elif not gzip_ok(os.path.join(backup_dir, name)):
        res['status'] = 'GZIP_BAD'
    elif res['age_hours'] > max_age_h:
        res['status'] = 'STALE'
    else:
        res['status'] = 'OK'
    return res


def rclone(args, rclone_bin, timeout):
    return subprocess.run([rclone_bin, *args], capture_output=True, text=True,
                          timeout=timeout, check=False)


def list_remote(remote, rclone_bin, timeout):
    """Return {name: size} of top-level remote files, or None when unreachable."""
    try:
        r = rclone(['lsjson', '--files-only', '--no-mimetype', remote], rclone_bin, timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    try:
        return {e['Name']: int(e['Size']) for e in json.loads(r.stdout or '[]')}
    except (ValueError, KeyError, TypeError):
        return None


def check_offhost(remote, listing, backup_dir, max_age_h, now, tz):
    res = {'stage': 'offhost'}
    if listing is None:
        res.update(status='UNREACHABLE', detail='rclone could not list the destination')
        return res
    when, name = newest_dump(listing.keys(), tz)
    if not name:
        res.update(status='MISSING', detail='destination has no lampang_bus_*.sql.gz')
        return res
    res.update(file=name, age_hours=age_hours(when, now), bytes=listing[name])
    local = os.path.join(backup_dir, name)
    if name + '.sha256' not in listing:
        res['status'] = 'CHECKSUM_MISSING'
    elif os.path.exists(local) and os.path.getsize(local) != listing[name]:
        res['status'] = 'SIZE_MISMATCH'
    elif res['age_hours'] > max_age_h:
        res['status'] = 'STALE'
    else:
        res['status'] = 'OK'
    return res


def check_readback(remote, offhost, rclone_bin, timeout):
    res = {'stage': 'readback'}
    name = offhost.get('file')
    if offhost['status'] in ('UNREACHABLE', 'MISSING') or not name:
        res.update(status='NOT_RUN', detail='no remote dump to read back')
        return res
    tmp = tempfile.mkdtemp(prefix='backup-readback-')
    os.chmod(tmp, 0o700)
    started = utcnow()
    try:
        for item in (name, name + '.sha256'):
            try:
                r = rclone(['copyto', f'{remote.rstrip("/")}/{item}', os.path.join(tmp, item)],
                           rclone_bin, timeout)
            except (OSError, subprocess.TimeoutExpired):
                r = None
            if r is None or r.returncode != 0:
                if item.endswith('.sha256') and r is not None:
                    res.update(status='CHECKSUM_MISSING', file=name)
                else:
                    res.update(status='UNREACHABLE', file=name, detail='download failed')
                return res
        dump = os.path.join(tmp, name)
        want = sidecar_digest(os.path.join(tmp, name + '.sha256'), name)
        res.update(file=name, bytes=os.path.getsize(dump))
        if want is None:
            res['status'] = 'CHECKSUM_MISSING'
        elif sha256_file(dump) != want:
            res['status'] = 'CHECKSUM_MISMATCH'
        elif not gzip_ok(dump):
            res['status'] = 'GZIP_BAD'
        else:
            res['status'] = 'OK'
        res['seconds'] = round((utcnow() - started).total_seconds(), 1)
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_restore(evidence_path, now):
    res = {'stage': 'restore'}
    try:
        data = json.loads(Path(evidence_path).read_text(encoding='utf-8'))
        when = dt.datetime.fromisoformat(data['completed_at'])
        if when.tzinfo is None:
            raise ValueError('timezone required')
        res.update(status='OK' if data.get('result') == 'PASS' else 'UNPROVEN',
                   proven_at=data['completed_at'], age_hours=age_hours(when, now),
                   source=data.get('source', 'unknown'))
    except (OSError, ValueError, KeyError, TypeError):
        res.update(status='UNPROVEN', detail='no restore-drill evidence recorded')
    return res


# ─── alert state ──────────────────────────────────────────────────────────
def load_state(state_dir):
    try:
        return json.loads((Path(state_dir) / 'alert-state.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def save_state(state_dir, state):
    path = Path(state_dir) / 'alert-state.json'
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(state, f)
    os.replace(tmp, path)


def signature(stages):
    return '|'.join(f"{s['stage']}={s['status']}" for s in stages if s['status'] in FAILING)


def build_message(kind, stages, host):
    head = {'fail': '🚨 Lampang Bus backup check FAILED',
            'reminder': '🚨 Lampang Bus backup check still FAILING',
            'recover': '✅ Lampang Bus backup check recovered'}[kind]
    lines = [head, f'host: {host}']
    for s in stages:
        extra = []
        if 'age_hours' in s:
            extra.append(f"age {s['age_hours']}h")
        if 'file' in s:
            extra.append(s['file'])
        lines.append(f"- {s['stage']}: {s['status']}" + (f" ({', '.join(extra)})" if extra else ''))
    return '\n'.join(lines)[:4900]


def push_line(text, endpoint, timeout):
    token = os.environ.get('LINE_CHANNEL_ACCESS_TOKEN', '')
    target = os.environ.get('TECH_LINE_TARGET_ID', '')
    if not token or not target:
        return False, 'alert credentials missing'
    body = json.dumps({'to': target, 'messages': [{'type': 'text', 'text': text}]}).encode()
    req = urllib.request.Request(endpoint, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300, f'HTTP {resp.status}'
    except urllib.error.HTTPError as e:
        e.close()
        return False, f'HTTP {e.code}'
    except (urllib.error.URLError, OSError):
        return False, 'network error'


def decide_alert(stages, state, now_epoch, repeat_s):
    """Return (kind|None, new_state). Pure: no I/O."""
    sig = signature(stages)
    new = dict(state)
    if sig:
        if state.get('status') != 'FAIL' or state.get('signature') != sig:
            kind = 'fail'
        elif now_epoch - int(state.get('last_sent', 0)) >= repeat_s:
            kind = 'reminder'
        else:
            kind = None
        new.update(status='FAIL', signature=sig)
        return kind, new
    kind = 'recover' if state.get('status') == 'FAIL' else None
    new.update(status='OK', signature='')
    return kind, new


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--backup-dir', default='/home/schoolbus/backups/lampang-bus')
    p.add_argument('--remote', help='rclone remote, e.g. gdrive:lampang-bus-backups')
    p.add_argument('--rclone', default=shutil.which('rclone') or 'rclone')
    p.add_argument('--max-age-hours', type=float, default=26)
    p.add_argument('--readback', action='store_true')
    p.add_argument('--restore-evidence', default='/home/schoolbus/backups/restore-drill/latest.json')
    p.add_argument('--state-dir', default='/home/schoolbus/backups/lampang-bus/.backup-status')
    p.add_argument('--alert', action='store_true')
    p.add_argument('--alert-repeat-hours', type=float, default=12)
    p.add_argument('--alert-endpoint', default=os.environ.get('BACKUP_ALERT_ENDPOINT', LINE_PUSH))
    p.add_argument('--timeout', type=int, default=120)
    p.add_argument('--now', help='ISO time override (tests only)')
    p.add_argument('--tz-offset-hours', type=float, default=0,
                   help='UTC offset of the clock that named the dumps; backup-db.sh calls date '
                        'on a UTC host (CRON_TZ only changes when cron fires), so 0')
    a = p.parse_args(argv)

    tz = dt.timezone(dt.timedelta(hours=a.tz_offset_hours))
    now = dt.datetime.fromisoformat(a.now) if a.now else utcnow()
    stages = [check_local(a.backup_dir, a.max_age_hours, now, tz)]
    if a.remote:
        listing = list_remote(a.remote, a.rclone, a.timeout)
        off = check_offhost(a.remote, listing, a.backup_dir, a.max_age_hours, now, tz)
    else:
        off = {'stage': 'offhost', 'status': 'NOT_RUN', 'detail': '--remote not given'}
    stages.append(off)
    if a.readback:
        stages.append(check_readback(a.remote, off, a.rclone, a.timeout) if a.remote
                      else {'stage': 'readback', 'status': 'NOT_RUN'})
    stages.append(check_restore(a.restore_evidence, now))

    required = [s for s in stages if s['stage'] != 'restore']
    ok = all(s['status'] == 'OK' for s in required)
    report = {'checked_at': now.isoformat(), 'ok': ok, 'stages': stages}

    os.makedirs(a.state_dir, mode=0o700, exist_ok=True)
    save_report = Path(a.state_dir) / 'latest.json'
    fd = os.open(save_report.with_suffix('.tmp'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False)
    os.replace(save_report.with_suffix('.tmp'), save_report)

    for s in stages:
        extra = ' '.join(f'{k}={v}' for k, v in s.items() if k not in ('stage', 'status'))
        print(f"[backup-status] {s['stage']:<8} {s['status']:<17} {extra}")

    if a.alert:
        state = load_state(a.state_dir)
        now_epoch = int(now.timestamp())
        kind, new = decide_alert(required, state, now_epoch, int(a.alert_repeat_hours * 3600))
        if kind:
            sent, why = push_line(build_message(kind, stages, os.uname().nodename if hasattr(os, 'uname') else 'host'),
                                  a.alert_endpoint, 15)
            print(f'[backup-status] alert {kind}: {"sent" if sent else "NOT sent"} ({why})')
            if sent:
                new['last_sent'] = now_epoch
            else:
                new = dict(state)  # retry next run; keep previous state untouched
        save_state(a.state_dir, new)

    print(f"[backup-status] {now.isoformat()} done ok={str(ok).lower()}")
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
