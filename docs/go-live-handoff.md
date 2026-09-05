# Go-Live Handoff — Lampang Bus System

> ระบบรถรับส่งนักเรียนจังหวัดลำปาง — เอกสารส่งมอบขั้นสุดท้าย
> Phase 10.11D • Closeout snapshot: 2026-06-02

> **Historical snapshot:** เอกสารนี้เป็นสถานะเดือน 2026-06 เท่านั้น สำหรับรอบเปิดใช้งาน/ตรวจความพร้อมล่าสุดให้ใช้
> `docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md`,
> `docs/UAT_SIGNOFF_2026-08.md`, `docs/TRAINING_PACK_2026-08.md`,
> และ `docs/OPERATOR_RUNBOOK.md`
> สถานะจริงล่าสุด (ติดป้ายเพิ่ม 5 ก.ย. 2569): `docs/project-closure/handoff-2026-09-05.md` · เหตุผล: `docs/project-closure/current-status-2026-09-04.md` §5 (#20)

---

## 1. Executive Summary

| รายการ | ค่า |
|---|---|
| Project | **Lampang Bus System** (ระบบรถรับส่งนักเรียนจังหวัดลำปาง) |
| Public URL | **https://schoolbuslampang.com** |
| Backend health | `/health` (loopback) + `/api/health` (public) |
| Historical readiness (2026-06) | 🟢 **READY FOR CONTROLLED GO-LIVE WITH OFF-HOST BACKUP PENDING** |
| Closeout date | 2026-06-02 |
| Latest documentation commit | `67e5966` (`docs: add final UAT and handoff documentation`) |
| Latest application commit serving production | `cdc0ec0` (`feat(line): switch notification resolver to phone-based binding`) — *historical 2026-06; ณ 5 ก.ย. 2569 production runtime คือ `208e883` (`handoff-2026-09-05.md` §3)* |
| Latest frontend bundle | built from `2a802b2` (`fix(parent): make LIFF bind route tolerant of endpoint config`) — subsequent commits are scripts/docs only |
| Main caveat (historical 2026-06) | 🟡 Off-host backup destination not yet configured (Phase 10.10F-2 pending operator decision) |

> **One-line status**: ระบบพร้อมเปิดใช้งานจริงในระดับ controlled production
> มีคำเตือน 1 ข้อ คือยังต้องตั้งค่า off-host backup destination ก่อนถึงจะเป็น
> FULL GREEN

---

## 2. Completed work summary

| Phase | งานที่ปิด | สถานะ |
|---|---|---|
| 10.7 | Dashboard / KPI simplification (per-role focus) | ✅ |
| 10.7G | Emergency log soft-delete (migration 025) | ✅ |
| 10.8A-C | School override "ยืนยันแทนคนขับ" (modal + backend + audit) | ✅ |
| 10.8F | Driver-side override badge "ครูยืนยันแทนแล้ว" | ✅ |
| 10.8UX series | Loading/empty/error standardization, mobile polish, MobileBottomNav | ✅ |
| 10.9A-B | LINE notification resolver → phone-based binding (sibling fix) | ✅ |
| 10.9D series | Domain migration `schoolbus.503200.xyz → schoolbuslampang.com`; webhook URL fix; LIFF route defensive redirect; live LINE binding UAT passed | ✅ |
| 10.10B | PM2 systemd alignment + pm2-logrotate v3.0.0 | ✅ |
| 10.10C | Automated daily DB backup script + cron (02:30 Bangkok) | ✅ |
| 10.10D | Restore drill script + manual run verified | ✅ |
| 10.10E | Health/backup monitor script + cron every 5 min | ✅ |
| 10.10F | Off-host backup sync workflow (rclone/rsync) — script + docs ready | 🟡 awaiting destination config |
| 10.10G | Bulk select + bulk delete on admin pickup-points + school teacher-accounts (frontend; reuses existing soft-delete endpoints) | ✅ |
| 10.10H | Dry-run + real operational reset (students/vehicles/assignments soft-deleted globally; historical tables preserved; audit row `id=3969`) | ✅ |
| 10.10I | Targeted recovery for `โรงเรียนกิ่วประชาวิทยา` (school_id `52020143`): 2 students + 1 vehicle + 1 assignment reactivated via 4-row transaction; audit row `id=3975`; no spill-over | ✅ |
| 10.11A | Final UAT checklist + production readiness + 3 role user-guides committed | ✅ |
| 10.11C | Final role-based UAT (server-side preconditions verified for all 8 roles) | ✅ |
| 10.11D | Go-live handoff + training + operator checklist (this commit) | ✅ |

---

## 3. System Access Overview

ผู้ใช้แบ่งเป็น 8 บทบาท แต่ละบทบาทมีขอบเขตข้อมูลและการดำเนินการต่างกัน
ตามที่ออกแบบใน RBAC

| บทบาท | ขอบเขต | ใช้ทำอะไรหลัก ๆ |
|---|---|---|
| **Admin** | ทั้งระบบ | ดูแลระบบ, จัดการบัญชี, audit log, system params |
| **Province (จังหวัด)** | ทั้งจังหวัดลำปาง (อ่านอย่างเดียว) | ภาพรวมเชิงนโยบาย, รายงาน, ดู live vehicle map |
| **Affiliation (สังกัด)** | โรงเรียนในเขตพื้นที่การศึกษาที่ผูก | ภาพรวมเขต, รายงาน, school checklist dashboard |
| **Transport (ขนส่ง)** | รถทั้งหมดในโครงการ (ไม่เห็นข้อมูลนักเรียน — PDPA) | ตรวจสภาพรถ, เอกสารใกล้หมดอายุ |
| **School — full account** | โรงเรียนตนเอง (CRUD) | จัดการนักเรียน, รถ, รายงาน, "ยืนยันแทนคนขับ" |
| **School — grade-scoped teacher** | ชั้นที่ผูก (อ่านอย่างเดียวเป็นหลัก) | ดูข้อมูลเฉพาะชั้นของตน; ไม่มีสิทธิ์ override |
| **Driver (คนขับ)** | นักเรียนในรถที่ได้รับมอบหมายเท่านั้น | เช็คอิน/เช็คเอาท์, แจ้งเหตุฉุกเฉิน |
| **Parent (LINE OA)** | บุตรหลานของตนเองเท่านั้น | ดูสถานะผ่าน LINE, รับแจ้งเตือน |

> 🔒 **บัญชีและรหัสผ่านให้ส่งมอบผ่านช่องทางแยกที่ปลอดภัยเท่านั้น**
> (password manager / sealed envelope / encrypted file — **ไม่ใส่ในเอกสารนี้**)

---

## 4. Training Plan (60–90 นาที)

ออกแบบสำหรับ workshop ผู้ใช้ผสมจากหลายบทบาท สามารถปรับลำดับได้ตามผู้เข้าร่วม

| ช่วงเวลา | นาที | หัวข้อ | ผู้บรรยายแนะนำ |
|---|---|---|---|
| 00:00–00:10 | 10 | ภาพรวมระบบ + บทบาทผู้ใช้ 8 บทบาท | ผู้ดูแลโครงการ |
| 00:10–00:25 | 15 | สิทธิ์ Province / Affiliation / Transport — เน้น dashboard + reports + PDPA | ผู้ดูแลระบบ |
| 00:25–00:40 | 15 | สิทธิ์ School (full + grade-scoped teacher) — เน้น override + การจัดการนักเรียน | ผู้ดูแลระบบ |
| 00:40–00:50 | 10 | สิทธิ์ Driver — login ด้วยทะเบียนรถ, roster, check-in/out, emergency | ผู้ดูแลระบบ |
| 00:50–01:00 | 10 | LINE OA สำหรับผู้ปกครอง — ผูกบัญชี, สถานะ, ยกเลิกผูกบัญชี | ผู้ดูแลระบบ |
| 01:00–01:10 | 10 | Q&A + ข้อควรระวัง (override, การส่งออกข้อมูล, PDPA) | ผู้ดูแลโครงการ |
| 01:10–01:20 | 10 | วิธีแจ้งปัญหา / support workflow (ดู §8) | ผู้ดูแลระบบ |

---

## 5. Role-based Training Checklist

### 5.1 Admin
- **Demo**: เปิด `/admin/system-health`, ดู audit log, จัดการบัญชี
- **Practice**: เพิ่ม + ลบบัญชีทดสอบ (ใช้ username ที่มี prefix `__TRAIN_`)
- **ห้ามทำ**: ลบบัญชี admin ตัวเองหรือเปลี่ยน scope ของบัญชีจริงระหว่าง training
- **Common errors**: ลืม assign scope → role ดูไม่เห็นข้อมูล

### 5.2 Province
- **Demo**: เปิด `/province` → 5-card dashboard, drill ลง school list
- **Practice**: เปิด `/reports/daily` แล้ว export Excel / CSV / PDF
- **ห้ามทำ**: พยายามแก้ไขข้อมูลผ่าน devtools — สิทธิ์เป็น read-only เท่านั้น
- **Common errors**: เข้าใจผิดว่า map ที่ไม่มี pin คือ map พัง — แท้จริงคือยังไม่มี GPS update

### 5.3 Affiliation
- **Demo**: เปิด `/affiliation` → school adoption checklist, ดูโรงเรียนใน scope
- **Practice**: ส่งออกรายงานเขต, เปรียบเทียบ 2 โรงเรียน
- **ห้ามทำ**: เปิดข้อมูลโรงเรียนของเขตอื่น (จะเจอ 403; **ไม่ใช่ bug**)
- **Common errors**: บัญชีไม่ได้ผูก affiliation_id → dashboard ว่าง

### 5.4 Transport
- **Demo**: เปิด `/transport` → document expiry cards, inspection form
- **Practice**: บันทึก inspection 1 รายการสมมุติแล้วลบ (หรือใช้ test vehicle)
- **ห้ามทำ**: ไม่ต้องมองหา student count — role นี้ออกแบบให้ไม่เห็นข้อมูลนักเรียน (PDPA)
- **Common errors**: คาดหวังจะเห็น roster ของรถ → ไม่มี (ออกแบบมา)

### 5.5 School — full account
- **Demo**: เปิด `/school` → action row, session hero cards, student search,
  vehicle management, รายงานวันนี้
- **Practice (สำคัญ)**:
  - เพิ่ม + แก้ไข + soft-delete นักเรียนทดสอบ
  - "ยืนยันแทนคนขับ" สำหรับนักเรียนทดสอบ — สังเกตว่าผู้ปกครองได้ push
- **ห้ามทำ**: ใช้ "ยืนยันแทนคนขับ" สำหรับนักเรียนจริงโดยไม่จำเป็น (จะกระทบ
  ผู้ปกครองทันที)
- **Common errors**: ลืมว่าครูสายชั้นไม่เห็นปุ่ม override (เป็น feature ไม่ใช่ bug)

### 5.6 School — grade-scoped teacher
- **Demo**: login ครูสายชั้น 1 บัญชี — เห็น scope chip, เห็นเฉพาะนักเรียนชั้นตน
- **Practice**: ค้นหานักเรียน, เปิด report scope ของชั้นนั้น
- **ห้ามทำ**: พยายาม forge request POST `/api/school/checkin-override` ผ่าน
  devtools — backend จะตอบ 403 ผ่าน `requireFullSchoolScope` middleware
- **Common errors**: คาดหวังจะเห็นปุ่ม "เพิ่มนักเรียน" / "จัดการรถ" /
  "ยืนยันแทนคนขับ" — ทั้งสามถูกซ่อนโดยการออกแบบ

### 5.7 Driver
- **Demo**: login ด้วย **ทะเบียนรถ** (เช่น `บม 2246 ลำปาง`) → pretrip pill +
  remaining counter + roster
- **Practice**:
  - เช็คอินนักเรียนทดสอบ 1 คน, เช็คเอาท์, ดู status เปลี่ยน
  - กดปุ่มฉุกเฉินกับ test scenario (อย่าใช้ในสถานการณ์ปลอม)
- **ห้ามทำ**: ใช้ปุ่มฉุกเฉินเล่น — จะส่ง notification ไปยังกลุ่มผู้ดูแลทันที
- **Common errors**: ลืมเช็คอินจน "ครูยืนยันแทนแล้ว" ปรากฏ — chip นี้เป็น read-only

### 5.8 Parent / LINE OA
- **Demo**: บนมือถือ — เพิ่มเพื่อนบอท `@943glwjf` (รถรับส่งนักเรียน) → พิมพ์
  `ผูกบัญชี` → กดปุ่ม LIFF → กรอกเบอร์ + รหัสนักเรียน → success
- **Practice**: พิมพ์ `สถานะ` เพื่อดูบุตรหลาน, พิมพ์ `ยกเลิกผูกบัญชี` แล้ว
  ผูกใหม่ — ดูว่า idempotent
- **ห้ามทำ**: แชร์ link `liff.line.me/...` ไปยังคนอื่น (เป็น launcher
  สำหรับเฉพาะ LINE user ที่ล็อกอินแล้ว — ไม่เป็นความลับแต่ทำให้สับสน)
- **Common errors**: เปิด LIFF บน desktop browser → จะ login แล้วใช้งานได้
  เหมือนกัน แต่ขั้นตอน LINE Login ยาวกว่าบนมือถือ

---

## 6. Go-live Checklist

### 6.1 Before go-live
- [ ] Backend `/health` returns `success: true` with DB connected
- [ ] `systemctl is-active pm2-schoolbus` = `active`, `is-enabled` = `enabled`
- [ ] `./scripts/health-check.sh` exits 0 with 8/8 OK
- [ ] Latest backup exists in `/home/schoolbus/backups/lampang-bus/`
      with sha256+gzip verified, age < 24h
- [ ] Restore drill ran successfully at least once (see 10.10D closeout)
- [ ] LINE webhook URL in LINE Developers Console points at
      `https://schoolbuslampang.com/api/line/webhook` and Verify returned Success
- [ ] LIFF Endpoint URL also on the new domain
- [ ] Final UAT (`docs/final-uat-checklist.md`) signed off per role
- [ ] Operator has admin credentials in their password manager
- [ ] User-facing PDFs from `docs/user-guide-*.md` distributed to staff
- [ ] Off-host backup caveat acknowledged in writing (will land within
      1 week of go-live)

### 6.2 On go-live day
- [ ] Verify `https://schoolbuslampang.com` returns 200 + valid TLS
- [ ] Login smoke per role (1 click-through each) — see
      [`docs/operator-go-live-checklist.md`](operator-go-live-checklist.md)
- [ ] Confirm role dashboards load without console errors
- [ ] Send `สถานะ` to bot from a parent test account — confirm reply
- [ ] Watch `pm2 logs schoolbus-backend --lines 100` periodically;
      no 500s, no SQL errors, no UnhandledPromiseRejection
- [ ] Confirm first scheduled daily backup runs successfully at 02:30
      Bangkok (read `/home/schoolbus/backups/lampang-bus/backup.log`)

### 6.3 After go-live (first 7 days)
- [ ] Daily: read `health-check.log` — every 5-minute entry should be
      `exit=0`
- [ ] Daily: confirm new `lampang_bus_YYYYmmdd_HHMMSS.sql.gz` file appears
      after 02:30 Bangkok
- [ ] Weekly: run restore drill into `lampang_bus_restore_drill` and
      compare table row counts vs production
- [ ] **Within 1 week**: configure off-host backup destination (rclone or
      rsync) per [`docs/ops-backup-restore.md §7.3`](ops-backup-restore.md)
- [ ] Collect feedback from each role (1 short form per principal/
      driver/dispatcher/parent rep) — fold into next sprint backlog

---

## 7. Known Caveats

| # | Caveat | Severity | Mitigation |
|---|---|---|---|
| 1 | Off-host backup destination not yet configured | 🟡 Medium | Schedule within 1 week of go-live; ~1 hour operator task (`docs/ops-backup-restore.md §7.3`) |
| 2 | Driver account for restored vehicle `บม 2246 ลำปาง` may need manual click-through verification | 🟡 Low | Operator attempts login with the plate-based username; if no `users` row exists, seed via existing driver creation flow |
| 3 | Operational data was globally reset 2026-06-02 09:56:55 — only `กิ่วประชาวิทยา` (school 52020143) was recovered as a sample (2 students + 1 vehicle) | 🟡 Informational | New student/vehicle onboarding for the other ~70 schools must be done deliberately via the existing UI flows; soft-deleted historical data remains intact in DB |
| 4 | Reboot drill (controlled `sudo reboot` to verify systemd resurrection) not yet performed | 🟡 Low | Schedule within 30 days post-go-live during a maintenance window |
| 5 | External uptime alerting not configured | 🟡 Low | Internal `health-check.sh` runs every 5 min; external (UptimeRobot / Healthchecks.io) is nice-to-have |
| 6 | Swap pressure on VPS (~1.3 G / 2 G) | 🟡 Low | Monitor; upgrade RAM tier if sustained traffic grows |
| 7 | `pm2-logrotate` rotateInterval is interpreted in UTC (07:00 Bangkok), not midnight Bangkok | 🟢 Negligible | Rotation still happens daily; cosmetic only |

---

## 8. Support / Escalation

### 8.1 Severity classification

| Severity | Definition | Response time target |
|---|---|---|
| 🔴 **Critical** | Backend down · DB disconnected · login impossible for all users · LINE webhook completely broken · data corruption / loss | **< 30 min** acknowledge, fix ASAP |
| 🟠 **High** | One role's dashboard broken · check-in/check-out broken for some vehicles · daily backup failed · LIFF binding broken | < 2 h acknowledge, < 24 h fix |
| 🟡 **Medium** | UI rendering issue · report number mismatch · individual account login issue · individual LINE notification delivery issue | < 1 business day acknowledge, < 1 week fix |
| 🟢 **Low** | Wording / typo · cosmetic issue · documentation update · feature request | Best-effort, batch in next sprint |

### 8.2 How operators report issues
1. Include the **URL** + **timestamp** + **role/account being used**
2. Include a **screenshot** of the error
3. Include `pm2 logs schoolbus-backend --lines 50 --nostream` tail for the
   relevant window
4. Do **not** include credentials, full LINE user IDs, or full phone numbers
   — mask middle digits

### 8.3 Operator quick commands
```bash
# Is the backend healthy?
curl -s http://127.0.0.1:3000/health
./scripts/health-check.sh

# Are PM2 + systemd OK?
systemctl is-active pm2-schoolbus
pm2 list

# Latest log
pm2 logs schoolbus-backend --lines 200 --nostream

# Did the daily backup happen?
ls -lh /home/schoolbus/backups/lampang-bus/ | tail -5
tail -20 /home/schoolbus/backups/lampang-bus/backup.log

# Did the 5-min monitor pass?
tail -30 /home/schoolbus/backups/lampang-bus/health-check.log
```

---

## 9. Rollback / Recovery Notes

| Scenario | Action | Reference |
|---|---|---|
| Need yesterday's data back | Restore from `/home/schoolbus/backups/lampang-bus/lampang_bus_YYYYmmdd_HHMMSS.sql.gz` | `docs/ops-backup-restore.md §4` |
| Test a backup before using it | `./scripts/restore-drill-db.sh <path>` (restores into `lampang_bus_restore_drill`, never production) | `docs/ops-backup-restore.md §4` |
| Need to roll back a specific school's recovery | 3 inverse UPDATEs in a transaction (mirror the script in `docs/ops-data-reset.md §9`) | `docs/ops-data-reset.md` |
| Production DB itself needs restore | Stop backend with `pm2 stop schoolbus-backend`, then `scripts/restore.sh <backup-dir>`, then `pm2 start schoolbus-backend` | `scripts/restore.sh` |
| Operational reset script gone wrong | Restore from the **pre-reset** backup that exists at `/home/schoolbus/backups/lampang-bus/lampang_bus_20260602_064612.sql.gz` (the artifact captured 2h57m before the reset) | `docs/ops-data-reset.md §9` |
| Off-host backup needed but pending | 🟡 Document this in the operator runbook; configure within 1 week | `docs/ops-backup-restore.md §7.3` |

🚫 **Do not restore over production without explicit owner approval.** The
restore-drill is always safe (separate DB); the actual production restore
modifies live data and requires a maintenance window.

---

## 10. Final Recommendation (Historical 2026-06)

🟢 **พร้อมเปิดใช้งานจริงแบบควบคุม** (controlled go-live)
**โดยมีข้อแม้ให้เร่งตั้งค่า off-host backup เป็นงานลำดับถัดไป**

### Why "controlled":
- ทุก core path ผ่าน UAT ระดับ system แล้ว
- บัญชีและสิทธิ์พร้อมใช้งานสำหรับทุก role
- Backup + restore drill + health monitor ทำงานต่อเนื่อง
- ความเสี่ยงเดียวคือ "ถ้า VPS ทั้งเครื่องเสียพร้อมกัน จะกู้ลำบาก" —
  off-host backup จะปิดความเสี่ยงนี้

### Why not "full GREEN":
- Off-host backup destination ยังไม่ได้ตั้งค่า ทำให้ disaster recovery
  ยังไม่ครบ
- งาน 1 ชั่วโมงของ operator ก็จะเสร็จ → จากนั้นเป็น **FULL GREEN**

### Suggested go-live cadence:
1. **วันที่ 1**: เปิดใช้งานจริง, monitor ใกล้ชิด, แก้ปัญหารายวัน
2. **สัปดาห์ที่ 1**: ตั้งค่า off-host backup, ยืนยันใช้งานได้
3. **เดือนที่ 1**: รัน reboot drill, ติดตั้ง external uptime monitor
4. **เดือนที่ 1+**: เริ่ม sprint สำหรับ features รอบใหม่ตาม feedback

---

## 11. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Project owner | | | |
| Lead engineer | | | |
| Operator (DBA / server) | | | |
| UAT lead | | | |
| Education stakeholder rep | | | |
| Lampang province council rep (สภาองค์กรของผู้บริโภค) | | | |

**Final status**: ▢ พร้อม go-live เต็มรูปแบบ  ▢ พร้อม go-live แบบควบคุม (มีข้อแม้)  ▢ ไม่พร้อม

ลายเซ็นผู้รับมอบ: _________________________ วันที่: _________
