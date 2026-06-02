# Production Readiness — Lampang Bus System

> สถานะความพร้อมเปิดใช้งานจริง (go-live readiness)
> Phase 10.11A • Snapshot date: 2026-06-02
> HEAD: `6a5fd7d` (latest 10.10H-B reset script commit)

---

## 1. Current readiness summary

| ด้าน | สถานะ | สรุป |
|---|---|---|
| Application (UI/UX, RBAC, business logic) | 🟢 GREEN | Phase 10.7-10.9 ปิดงานครบ ทุก role ใช้งานได้บน mobile + desktop |
| Process recovery (PM2 + systemd) | 🟢 GREEN | systemd active+enabled; backend auto-restart หลัง reboot ผ่าน `pm2 resurrect`; pm2-logrotate ทำงานทุกวัน |
| Local backup | 🟢 GREEN | daily mysqldump 02:30 Bangkok; gzip + sha256; retention 7 วัน |
| Restore drill | 🟢 GREEN | ผ่านการทดสอบ restore ลง `lampang_bus_restore_drill` แล้ว (Phase 10.10D) |
| Health monitoring | 🟢 GREEN | `scripts/health-check.sh` run ทุก 5 นาที, ครอบคลุม 8 มิติ |
| LINE OA flow | 🟢 GREEN | webhook ใช้งานได้บนโดเมนใหม่; binding LIFF ผ่าน UAT จริง 2026-06-02 |
| Off-host backup (disaster recovery) | 🟡 YELLOW | script + docs พร้อม; รอ operator เลือก rclone/rsync target |
| External uptime alerting | 🟡 YELLOW (optional) | ปัจจุบันมี internal health check; ยังไม่มี external pinger |
| Reboot drill (controlled VPS reboot) | 🟡 YELLOW (optional) | ยังไม่ได้ทดสอบจริง — systemd unit + dump.pm2 อยู่ในตำแหน่งที่ถูกต้อง คาดว่าจะกลับมาเองแต่ยังไม่ verify |

**Overall**: 🟢 **GREEN สำหรับการใช้งานจริงในระดับ controlled production**
🟡 **YELLOW สำหรับ disaster recovery นอก VPS**

---

## 2. Completed milestones

| Phase | สรุป | สถานะ |
|---|---|---|
| 10.7 | Dashboard / KPI simplification (per-role focus) | ✅ closed |
| 10.7G | Emergency log soft delete (migration 025) | ✅ closed |
| 10.8A-C | School override "ยืนยันแทนคนขับ" (modal + backend + audit) | ✅ closed |
| 10.8F | Driver-side override badge "ครูยืนยันแทนแล้ว" | ✅ closed |
| 10.8UX series | Loading/empty/error standardization, mobile polish, MobileBottomNav | ✅ closed |
| 10.9A-B | LINE notification resolver → phone-based binding (sibling fix) | ✅ closed |
| 10.9D series | Domain migration (`schoolbus.503200.xyz` → `schoolbuslampang.com`), webhook URL fix, LIFF route defensive redirect, **live UAT passed 2026-06-02** | ✅ closed |
| 10.10B | PM2 systemd alignment + pm2-logrotate v3.0.0 | ✅ closed |
| 10.10C | Automated daily DB backup script + cron | ✅ closed |
| 10.10D | Restore drill script + manual run verified | ✅ closed |
| 10.10E | Health/backup monitor script + cron every 5 min | ✅ closed |
| 10.10F | Off-host backup sync workflow (rclone/rsync) — script ready | 🟡 awaiting destination config |
| 10.10G | Bulk select/delete on admin pickup-points + school teacher-accounts (frontend-only; reuses existing soft-delete endpoints) | ✅ closed GREEN (re-verified post-reset/recovery) |
| 10.10H | Dry-run operational data reset script + first real execution (`students_active 289→0`, `vehicles_active 53→0`, `assignments_active 53→0`); historical tables preserved; audit summary row `id=3969` | ✅ closed GREEN |
| 10.10I | Targeted recovery for `โรงเรียนกิ่วประชาวิทยา` (school_id=`52020143`): 2 students + 1 vehicle + 1 driver assignment reactivated via 4-row transaction; audit row `id=3975`; no spill-over | ✅ closed GREEN |

---

## 3. Risk status — detailed

### 🟢 GREEN

| Area | Evidence |
|---|---|
| Application | All Jest test suites pass on `main` (`cdc0ec0` deployed; `2a802b2` is doc/route fix only). 10/10 LINE binding tests pass |
| RBAC | `requireFullSchoolScope` blocks teachers from school override; transport hides student counts; LIFF routes are public by design |
| Process recovery | `pm2-schoolbus.service` is `enabled` + `active`; `~/.pm2/dump.pm2` resurrects both `schoolbus-backend` and `pm2-logrotate` module |
| Logs | pm2-logrotate v3.0.0: max_size=10M, retain=7, compress=true, rotate daily |
| Backup | Latest dump `lampang_bus_20260602_064612.sql.gz` (94 KB) sha256-verified; restore-drill closed GREEN (Phase 10.10D) |
| Health | `scripts/health-check.sh` exits 0 with 8/8 checks; written to `health-check.log` every 5 min via cron |
| LINE OA | webhook URL `https://schoolbuslampang.com/api/line/webhook` returns HTTP 200 on signed POST; live bind `[LINE_BIND_CONFIRM] linked { parentId: 32 }` observed 2026-06-02 08:38:33 |

### 🟡 YELLOW

| Area | Reason | Mitigation |
|---|---|---|
| Off-host backup | Backups live on same VPS as DB; disk-loss event = total loss | Operator picks rclone (cloud) or rsync (second host) per [docs/ops-backup-restore.md §7.3](ops-backup-restore.md); script + cron line already prepared |
| Swap pressure | Memory usage ~1.4G/2G with ~1.3G swap — VPS is near capacity | If sustained traffic grows: bump VPS RAM tier, or profile heaviest endpoints |
| Reboot drill | systemd setup verified by inspection; not yet tested with an actual `sudo reboot` | Schedule a maintenance window post-go-live to run a controlled reboot and confirm `dump.pm2` resurrection |
| pm2-logrotate timezone | rotateInterval `0 0 * * *` is interpreted in UTC (= 07:00 Bangkok), not midnight Bangkok | Low impact; rotation still happens daily. Optional fix: `pm2 set pm2-logrotate:TZ Asia/Bangkok` |

### 🟢 NOT a risk (false positives previously flagged)

| Item | Why it's OK |
|---|---|
| Historical `[errorHandler] jwt expired` log entries | Normal — clients with cached tokens get 401, errorHandler logs at info level. Not a security issue |
| Historical `[LINE] Invalid signature` log entries | Pre-fix probe traffic + this session's diagnostic probes. Not present in current operating window |
| 4 docs in `docs/manual-audit/` + `phase-9-*.md` still use old domain | Intentional — those are historical snapshots, not user-facing manuals. User-facing `docs/user-manual.md` is updated |

---

## 4. Runtime configuration

| Item | Value | Verified |
|---|---|---|
| systemd unit | `pm2-schoolbus.service` | `systemctl is-active` → active, `is-enabled` → enabled |
| PM2 process | `schoolbus-backend` (fork mode, PID 351224) | `pm2 list` → online, restarts=0 |
| PM2 module | `pm2-logrotate@3.0.0` | online |
| Backend port | 3000 (loopback) | `curl http://127.0.0.1:3000/health` → success=true |
| Public ingress | nginx → Cloudflare → `https://schoolbuslampang.com` | HEAD returns 200 |
| Health check script | `scripts/health-check.sh` | exits 0; 8/8 checks |
| Cron | 2 entries (backup 02:30, health 5-min) under `CRON_TZ=Asia/Bangkok` | `crontab -l` |

---

## 5. Backup configuration

| Item | Value |
|---|---|
| Backup script | [`scripts/backup-db.sh`](../scripts/backup-db.sh) |
| Backup directory | `/home/schoolbus/backups/lampang-bus` (mode 700) |
| Filename pattern | `lampang_bus_YYYYmmdd_HHMMSS.sql.gz` (mode 600) |
| Checksum sidecar | `*.sha256` (mode 600) |
| Schedule | Daily 02:30 Asia/Bangkok via crontab |
| Retention | 7 days (auto-pruned by `find -mtime +7 -delete`) |
| Compression | gzip |
| Dump flags | `--single-transaction --quick --routines --triggers --events --no-tablespaces` |
| Credentials | `--defaults-extra-file` mode 600 temp file; cleaned on EXIT/INT/TERM |
| Restore drill | [`scripts/restore-drill-db.sh`](../scripts/restore-drill-db.sh) → target `lampang_bus_restore_drill` (hard-guarded against production names) |
| Drill last verified | Phase 10.10D — restored to test DB; row counts matched production |
| Off-host sync | [`scripts/offhost-backup-sync.sh`](../scripts/offhost-backup-sync.sh) (configurable, **pending destination**) |

---

## 6. LINE OA configuration

| Item | Value |
|---|---|
| New public domain | `https://schoolbuslampang.com` |
| Webhook URL (LINE Console) | `https://schoolbuslampang.com/api/line/webhook` |
| Bot identity | `รถรับส่งนักเรียน` (basic ID `@943glwjf`) |
| Channel access token | configured in `backend/.env` (length 172) |
| Channel secret | configured in `backend/.env` (length 32) |
| LIFF ID | configured in `backend/.env` (length 19) |
| LIFF Endpoint URL (LINE Console) | should be `https://schoolbuslampang.com/parent/link` (or `/parent` — both work via 10.9D-2 defensive redirects) |
| Rich-menu actions | text-based ("ผูกบัญชี", "สถานะ", "ยกเลิกผูกบัญชี") — unaffected by domain |
| Notification resolver | phone-based via `line_bindings.phone` (Phase 10.9B). Sibling bug fixed |
| Live bind UAT (2026-06-02) | ✅ `[LINE_BIND_CONFIRM] linked { parentId: 32 }`; `[LINE_PARENT_STATUS_FLEX] delivered` after subsequent `สถานะ` |

---

## 7. Security / privacy notes

| Item | Status |
|---|---|
| Transport role does NOT see student names or counts | ✅ enforced in dashboard + pickup map (Phase 10.8UX) |
| Grade-scoped teacher cannot trigger school override | ✅ `requireFullSchoolScope` middleware on `POST /api/school/checkin-override` |
| CID stored as SHA256 hash, never plain | ✅ schema enforces `cid_hash VARCHAR(64)` |
| `backend/.env` never committed | ✅ `.gitignore` `.env` rule; `scripts/offhost-backup-sync.env` also gitignored |
| `scripts/backup.sh` legacy credential leak | ✅ hardened in Phase 10.10E to use `--defaults-extra-file` |
| `LINE_CHANNEL_*` secrets never in logs | ✅ verified in 10.9D audit; no token printed |
| UAT users `__UAT*` / `__TEST*` rotated periodically | ⚠️ operator responsibility — `UAT_FORCE_RESET=1 backend/scripts/seed-uat-override-fixture.js` |
| JWT refresh tokens revocable | ✅ via `revoked_tokens` table + `/api/auth/logout` endpoint |
| MySQL root password | not stored in repo or `backend/.env`; operator-only |
| Off-host backup script | will never upload `.env`, `*.log`, `*.partial`, or anything outside `lampang_bus_*.sql.gz` + sidecar |

### UAT credentials hygiene

After go-live and post-UAT, the operator should:
1. Delete or disable `__UAT_*` / `__TEST_*` users in `users` table if they aren't required for ongoing UAT
2. Rotate passwords on remaining UAT accounts every 90 days
3. Confirm `__UATSCH` and related fixture data are flagged so they're easy to identify in any export

---

## 8. Remaining items (post-go-live backlog)

### Required before "fully GREEN"

1. **Configure off-host backup destination** (10.10F-2)
   - Operator picks rclone (cloud) or rsync (second host)
   - Follow [docs/ops-backup-restore.md §7.3](ops-backup-restore.md)
   - Once first sync verified, install the 02:45 cron line

### Recommended (not blocking go-live)

2. **External uptime alerting**
   - Add UptimeRobot / Healthchecks.io ping on `https://schoolbuslampang.com/health`
   - Pages on-call when 2 consecutive checks fail
3. **Controlled reboot drill**
   - Schedule a maintenance window after go-live
   - `sudo reboot` → confirm backend resurrected within 2 minutes via systemd
4. **Admin/report menu grouping** (Phase 10.7 backlog)
   - Optional UX polish — group admin pages into "ระบบ", "รายงาน", "ผู้ใช้"
5. **pm2-logrotate Bangkok timezone**
   - Optional: `pm2 set pm2-logrotate:TZ Asia/Bangkok` so rotation fires at midnight Bangkok
6. **Memory headroom**
   - Monitor swap usage; if sustained > 1.5G consider VPS upgrade

### Documentation deliverables (this phase)

✅ Final UAT checklist — [docs/final-uat-checklist.md](final-uat-checklist.md)
✅ Production readiness (this doc) — [docs/production-readiness.md](production-readiness.md)
✅ Role user guides — see [docs/user-guide-school.md](user-guide-school.md), [docs/user-guide-driver.md](user-guide-driver.md), [docs/user-guide-transport-province-affiliation.md](user-guide-transport-province-affiliation.md)

---

## 9. Go-live recommendation

🟢 **READY for controlled production use with off-host backup pending.**

The application, RBAC, mobile UX, LINE binding flow, daily backup, restore
drill, and 5-minute health monitor are all verified GREEN. The one remaining
risk — losing local backups if the VPS itself is destroyed — is well-defined
and unblocked by a single operator decision (pick rclone or rsync target). It
does not block go-live for the immediate use case; it should land within the
first sprint after go-live.

**Recommended sequence after this phase:**
1. Execute UAT per [docs/final-uat-checklist.md](final-uat-checklist.md) with real role users
2. Sign off UAT
3. Configure off-host backup destination (1-hour operator task)
4. Announce go-live to school stakeholders
5. Schedule first reboot drill within 30 days

---

## 10. Sign-off

| Role | Name | Date | Sign |
|---|---|---|---|
| Project owner | | | |
| Lead engineer | | | |
| Operator (DBA / server) | | | |
| UAT lead | | | |
| Education stakeholder rep | | | |

**Status snapshot generated**: 2026-06-02
**HEAD at signing**: `2a802b2`

---

## 11. Phase 10.11D — Go-live Handoff Status

> เพิ่มในรอบ Phase 10.11D (2026-06-02) — closeout เอกสารการส่งมอบ

### 11.1 Handoff artifacts delivered
| Doc | Path | Purpose |
|---|---|---|
| Go-live handoff (full) | [`docs/go-live-handoff.md`](go-live-handoff.md) | 11-section executive document with completed-work summary, role access, training plan, role-based training checklist, go-live checklist (before/day-of/after), known caveats, support/escalation matrix, rollback notes, sign-off block |
| Operator quick checklist | [`docs/operator-go-live-checklist.md`](operator-go-live-checklist.md) | A4-printable day-of checklist: pre-go-live → role smoke → first-day monitoring → post-go-live ops + emergency contact matrix |
| Training agenda (Thai) | [`docs/training-agenda.md`](training-agenda.md) | 60–90 min workshop plan with role-by-role practice tasks, common Q&A, post-training feedback form spec |

### 11.2 Final readiness verdict
🟢 **READY FOR CONTROLLED GO-LIVE WITH OFF-HOST BACKUP PENDING.**

Same posture as §9 — no change to the underlying risk picture. Off-host backup
destination remains the single 🟡 to clear within the first week of operations.
Once configured, the system flips to **FULL GREEN**.

### 11.3 Operator action queue (post-handoff)
1. ▢ Distribute role-specific user guides to the appropriate staff
2. ▢ Schedule training workshop(s) per `docs/training-agenda.md`
3. ▢ Run `docs/operator-go-live-checklist.md` pre-go-live block on launch morning
4. ▢ Configure off-host backup destination per [`docs/ops-backup-restore.md §7.3`](ops-backup-restore.md) within 7 days
5. ▢ Schedule controlled reboot drill within 30 days
6. ▢ Collect first-week user feedback → fold into next sprint backlog

**Handoff status**: ✅ **complete; signed-off block in `docs/go-live-handoff.md §11`**
