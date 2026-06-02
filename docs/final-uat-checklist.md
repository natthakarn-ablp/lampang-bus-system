# Final UAT Checklist — Lampang Bus System

> รายการทดสอบครั้งสุดท้ายก่อนเปิดใช้งานจริง
> Phase 10.11A • 2026-06-02

---

## 1. Purpose

เอกสารนี้ใช้สำหรับทดสอบระบบรอบสุดท้ายในสภาพแวดล้อม production
ก่อน go-live เพื่อให้ครอบคลุมทุกบทบาท (role) ทุก capability ที่ปิด
งานมาแล้วใน Phase 10.7 ถึง 10.10 และทั้งฝั่ง LINE OA

ผู้ทดสอบจะกรอกผลลงในตาราง result ในข้อ §9 ของแต่ละ role-block
(PASS / FAIL / N/A พร้อม evidence/notes)

---

## 2. Environment

| รายการ | ค่า |
|---|---|
| Production URL | https://schoolbuslampang.com |
| Backend health endpoint (loopback) | http://127.0.0.1:3000/health |
| Backend health endpoint (public) | https://schoolbuslampang.com/api/health (ผ่าน nginx proxy) |
| Current HEAD ที่ทดสอบ | `6a5fd7d` (frontend bundle from 2a802b2 — script-only commits since then) |
| Frontend build | `frontend/dist/assets/index-Ct8cd_LJ.js` |
| Database | MySQL 8.0 — `lampang_bus` |
| Node runtime | 20.20.2 (PM2 fork mode, ผ่าน systemd `pm2-schoolbus.service`) |
| Timezone | Asia/Bangkok |

UAT credentials เก็บแยกใน password manager — ไม่อยู่ในเอกสารนี้

---

## 3. Common pre-conditions (ทำก่อนเริ่ม UAT ทุกครั้ง)

- [ ] เปิดในเบราว์เซอร์มือถือจริง (Chrome/Safari บน Android หรือ iOS) ไม่ใช่
  desktop emulator
- [ ] เปิดทั้ง mobile viewport (375 px) และ desktop viewport (1280 px) เพื่อ
  เทียบ layout
- [ ] เคลียร์ cache หรือใช้ private window เพื่อกัน state เก่าค้าง
- [ ] เตรียมบัญชีทดสอบของแต่ละบทบาทแยกกัน (อย่าใช้บัญชี admin ทำหน้า driver)
- [ ] เปิด `pm2 logs schoolbus-backend --lines 50` ค้างไว้อีก terminal หนึ่ง
  เพื่อดู error เรียลไทม์

---

## 4. Generic checks ที่ใช้ซ้ำในทุก role

ใช้แต่ละข้อนี้กับทุก role ที่ทดสอบ ไม่ต้องเขียนซ้ำในรายการ role-specific

| Generic check | Pass criteria |
|---|---|
| Login | กรอก username + password ถูกแล้วถูก redirect ไปหน้า dashboard ของบทบาทตัวเอง ภายใน 2 วินาที |
| Login wrong password | ขึ้นข้อความ "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" + ไม่ redirect |
| Logout | กดออกจากระบบ แล้วถูก redirect ไป `/login` ทันที |
| Dashboard load | ไม่มี loading ค้าง > 5 วินาที; ไม่มี error toast |
| Empty state | ใน table/list ที่ไม่มีข้อมูล แสดง `<EmptyState />` component ที่มีไอคอน + ข้อความ ไม่ใช่ table ว่างเปล่า |
| Loading state | ก่อนข้อมูลโหลดเสร็จ แสดง `<LoadingState />` component ไม่ใช่หน้าจอเปล่า |
| Error state | เมื่อ API ตอบ 5xx แสดง `<ErrorState />` + ปุ่ม "ลองอีกครั้ง" |
| Mobile 375px | ไม่มี horizontal scroll; ปุ่มหลักกดได้ด้วยนิ้วโป้ง; MobileBottomNav แสดงเฉพาะ role ที่มี (school/affiliation/province/driver) |
| Hidden permission | กดเข้า URL ของ role อื่น (เช่น `/admin` เมื่อ login เป็น school) แล้วถูก redirect กลับ ไม่เห็นข้อมูล role อื่น |
| Privacy / PDPA | ไม่เห็นเลขบัตรประชาชน 13 หลักเต็ม; เบอร์โทรอาจถูก mask ใน role ที่ไม่ต้องใช้ |

---

## 5. Role-based UAT checklist

### 5.1 Admin

| # | Check | Method | Result |
|---|---|---|---|
| A1 | Login | กรอก admin user/pass → ดูถูก redirect ไป `/admin` หรือ overview | ▢ |
| A2 | System overview loads | เปิด `/admin/system-health` → เห็นสรุปสถานะ | ▢ |
| A3 | Users/accounts | เปิดหน้าจัดการบัญชี → list users ครบ | ▢ |
| A4 | Audit log | เปิดดู audit_logs → กรองวันได้, แสดง action ครบ | ▢ |
| A5 | Reports & dashboards | เปิดทุก dashboard ที่ admin มีสิทธิ์ → ไม่มี 403 | ▢ |
| A6 | Hidden permission test | login เป็น admin → ลองเปิด `/parent` หรือ `/driver` → ระบบจะ render หรือ redirect ตาม design | ▢ |

Evidence/Notes:

```
(เติม URL ที่กด + screenshot path + คอมเมนต์)
```

---

### 5.2 Province

| # | Check | Method | Result |
|---|---|---|---|
| P1 | Login → `/province` | redirect ถูก, ไม่ติด login loop | ▢ |
| P2 | 5-card executive dashboard | เห็น cards ทั้ง 5 (วันนี้/รถ/โรงเรียน/แจ้งเตือน/รายงาน) | ▢ |
| P3 | Vehicle/school KPI buckets | กดเข้า detail แต่ละ bucket → load ข้อมูลครบ | ▢ |
| P4 | Live vehicle map | `/province/live-vehicles` → map แสดงตำแหน่งรถ; ไม่มี console error | ▢ |
| P5 | Emergency overview | เห็น emergency_logs ล่าสุด (filter `is_deleted=FALSE` แล้ว) | ▢ |
| P6 | Reports | เปิด `/reports/daily` แล้วเลือกวันได้, ไม่มี data leak จากเขตอื่น | ▢ |
| P7 | MobileBottomNav | บน 375px เห็น tab `หน้าแรก / โรงเรียน / ตำแหน่ง / รายงาน` | ▢ |
| P8 | Privacy | ไม่เห็นเลข CID เต็ม; เบอร์ผู้ปกครองอาจถูก mask | ▢ |

---

### 5.3 Affiliation (สังกัด)

| # | Check | Method | Result |
|---|---|---|---|
| AF1 | Login → `/affiliation` | redirect ถูก | ▢ |
| AF2 | 5-card school checklist dashboard | เห็น cards adoption / data quality / signal | ▢ |
| AF3 | School adoption indicators | ตัวเลขโรงเรียน active / pending / risk match กับ DB | ▢ |
| AF4 | Data quality indicators | dashboard ระบุได้ว่าโรงเรียนไหนข้อมูลไม่ครบ | ▢ |
| AF5 | School list | กดเข้าโรงเรียนเฉพาะที่อยู่ในสังกัด — โรงเรียนสังกัดอื่น 403 | ▢ |
| AF6 | Live vehicles | เห็นรถเฉพาะของโรงเรียนในสังกัดตัวเอง | ▢ |
| AF7 | Risk/action panels | กดดู panel → list มี link ไปยังโรงเรียนที่ต้องดำเนินการ | ▢ |
| AF8 | MobileBottomNav | บน 375px เห็น tab ตามที่ออกแบบ | ▢ |
| AF9 | Hidden permission | เปิด `/admin` → 403; เปิด affiliation อื่น → 403 | ▢ |

---

### 5.4 Transport (ขนส่ง)

| # | Check | Method | Result |
|---|---|---|---|
| T1 | Login → `/transport` | redirect ถูก | ▢ |
| T2 | PDPA-clean dashboard | **ไม่มีตัวเลขจำนวนนักเรียนใด ๆ** บนหน้าจอ; ไม่มี student list | ▢ |
| T3 | Document expiry cards | เห็นรายการรถใกล้หมดประกัน / ใกล้หมดอายุการตรวจสภาพ | ▢ |
| T4 | Inspection flow | เปิด inspection form → กรอก result (PASSED/FAILED/NEEDS_FIX) + วันหมดอายุ → save → record ปรากฏใน list | ▢ |
| T5 | Pickup map | เปิด map → เห็นจุดรับ-ส่งแต่ละรถ; **ไม่ระบุชื่อนักเรียนรายบุคคล** | ▢ |
| T6 | Action row | เห็นปุ่ม "เพิ่มผลตรวจ" + "ส่งออกรายงาน" ที่ด้านบน | ▢ |
| T7 | Reports export | export ผลตรวจสภาพรถเป็น Excel/CSV/PDF ได้ | ▢ |
| T8 | Hidden permission | เปิด `/school` หรือ `/parent` → 403 | ▢ |
| T9 | Mobile 375px | layout ใช้ได้, ไม่มี horizontal scroll | ▢ |

> **ข้อสำคัญ T2 + T5**: transport เห็นเฉพาะข้อมูลรถและการตรวจสภาพ ไม่มีสิทธิ์
> เห็นจำนวนหรือชื่อนักเรียน — ถ้าเห็น แจ้ง dev ทันที (regression)

---

### 5.5 School — full account

| # | Check | Method | Result |
|---|---|---|---|
| S1 | Login → `/school` | redirect ถูก | ▢ |
| S2 | Action-first dashboard | ปุ่ม action หลักอยู่ด้านบน (เพิ่มนักเรียน, จัดการรถ, รายงานวันนี้) | ▢ |
| S3 | Session hero cards | hero cards แสดงสรุปรอบเช้า/เย็น พร้อมสถานะ | ▢ |
| S4 | Student search | `/school/students` → ค้นหาชื่อภาษาไทย → ผลตรง | ▢ |
| S5 | Vehicle management | `/school/vehicles` → CRUD รถได้ ไม่มี crash | ▢ |
| S6 | Reports | `/school/reports/daily` แสดงข้อมูลวันนี้; export ได้ทั้ง 3 format | ▢ |
| S7 | School override "ยืนยันแทนคนขับ" | เปิด modal → เลือกนักเรียน → เลือก session/status → กรอกเหตุผล → save → DB มี checkin_logs + audit_log บันทึก `override_by_school=true` | ▢ |
| S8 | Override notification | หลัง save ที่ S7 → ผู้ปกครองที่ผูก LINE ของนักเรียนนั้น (และพี่น้องที่ใช้เบอร์เดียวกัน) ได้รับ Flex card | ▢ |
| S9 | Driver badge sync | login เป็น driver ของรถนั้นทันทีหลัง S7 → roster เห็น chip "ครูยืนยันแทนแล้ว" บนแถวนักเรียน | ▢ |
| S10 | MobileBottomNav | บน 375px เห็น tab `หน้าแรก / ค้นหา / ตำแหน่ง / รายงาน` | ▢ |
| S11 | Hidden permission | เปิดข้อมูลโรงเรียนอื่น → 403; เปิด `/admin` → 403 | ▢ |

---

### 5.6 School — grade-scoped teacher (ครูสายชั้น)

| # | Check | Method | Result |
|---|---|---|---|
| ST1 | Login (teacher account ที่มี `scope_grade` ผูกไว้) | redirect ไป `/school` | ▢ |
| ST2 | Scope chip | header ของ dashboard แสดงชิป "ครู ป.X" หรือชั้นที่ผูก | ▢ |
| ST3 | Hidden write actions | ปุ่ม "เพิ่มนักเรียน", "จัดการรถ", "ยืนยันแทนคนขับ" **ต้องไม่ปรากฏ** | ▢ |
| ST4 | Student search scope | ค้นหานักเรียน → เห็นเฉพาะชั้นของตัวเอง (ไม่เห็นทุกชั้น) | ▢ |
| ST5 | Report access | `/reports/daily` ที่ scope เห็นได้ → render ไม่ 403 | ▢ |
| ST6 | API guard | hit `POST /api/school/checkin-override` ผ่าน devtools → backend ตอบ 403 ด้วย `requireFullSchoolScope` | ▢ |
| ST7 | Vehicle page | `/school/vehicles` → ถ้าไม่มีสิทธิ์ → redirect หรือเห็น "ไม่มีสิทธิ์" | ▢ |

> **ข้อสำคัญ ST3 + ST6**: ครูสายชั้นไม่มีสิทธิ์ override; UI ต้องซ่อนปุ่ม
> และ backend ต้องบล็อกถ้ามีคนพยายาม forge request

---

### 5.7 Driver

| # | Check | Method | Result |
|---|---|---|---|
| D1 | Login ด้วยทะเบียนรถ (e.g. `นข 1571 ลำปาง`) | redirect ไป `/driver` | ▢ |
| D2 | Simplified dashboard | เห็น pretrip status pill + remaining check-in counter | ▢ |
| D3 | Roster load | รายชื่อนักเรียนในรถ + status morning/evening แต่ละคน | ▢ |
| D4 | Check-in | กดเช็คอินนักเรียน 1 คน → status เปลี่ยน + DB เขียน `checkin_logs` + `daily_status` ใน transaction | ▢ |
| D5 | Check-out | กดเช็คเอาท์ → status เปลี่ยน + DB อัพเดต | ▢ |
| D6 | Check-in-all | กดเช็คอินทั้งคัน → ทุกคนกลายเป็น CHECKED_IN | ▢ |
| D7 | "ครูยืนยันแทนแล้ว" badge | หลังโรงเรียน override นักเรียน 1 คน → driver roster แสดง chip บนแถวนั้น (read-only, ไม่ block check-in) | ▢ |
| D8 | Emergency action | กดปุ่ม emergency → กรอก detail → save → DB เขียน `emergency_logs` + push LINE | ▢ |
| D9 | Mobile-first | ใช้บนมือถือจริงระหว่างขับ — touch target ≥ 44px, ปุ่มหลักนิ้วโป้งถึง | ▢ |
| D10 | Hidden permission | เปิด `/school` หรือ `/admin` → 403 หรือ redirect | ▢ |
| D11 | LINE notification | หลัง check-in/check-out → ผู้ปกครองที่ผูก LINE ได้รับ push (ดู `notifications` table) | ▢ |

---

### 5.8 Parent / LINE OA

| # | Check | Method | Result |
|---|---|---|---|
| L1 | Follow bot `@943glwjf` | LINE app → เพิ่มเพื่อน → ได้ welcome flex card | ▢ |
| L2 | "ผูกบัญชี" via LIFF | พิมพ์ `ผูกบัญชี` → bot ส่ง flex พร้อมปุ่ม "📝 เปิดฟอร์มผูกบัญชี" | ▢ |
| L3 | LIFF page loads | กดปุ่ม → page เปิดเป็น `/parent/link` (ไม่ใช่ root) — defensive redirect ทำงาน | ▢ |
| L4 | Binding success | กรอกเบอร์ + รหัสนักเรียน → success message; DB มี `line_bindings.is_active=1` ใหม่ และ `line_users.verified=1` | ▢ |
| L5 | "สถานะ" command | พิมพ์ `สถานะ` → bot ส่ง Flex card แสดงบุตรหลานทุกคน + สถานะวันนี้ | ▢ |
| L6 | Sibling support | ถ้าผู้ปกครองมีลูกหลายคนที่ใช้เบอร์โทรเดียวกัน → ทุกคนแสดงใน `สถานะ` (ทดสอบ phone-based resolver) | ▢ |
| L7 | Phone-based notification | เมื่อ driver เช็คอินลูกคนแรก → ผู้ปกครองได้ push; ถ้าโรงเรียน override ลูกคนที่สอง → ผู้ปกครองคนเดียวกันได้ push อีกครั้งสำหรับลูกคนที่สอง | ▢ |
| L8 | "ยกเลิกผูกบัญชี" | พิมพ์ `ยกเลิกผูกบัญชี` → bot ส่ง confirm card → กด/พิมพ์ยืนยัน → DB row ถูกลบจาก `line_bindings`; `line_users.parent_id=NULL` | ▢ |
| L9 | Re-bind | หลัง L8 → พิมพ์ `ผูกบัญชี` อีกครั้ง → ผูกใหม่ได้ (idempotent) | ▢ |
| L10 | LIFF Endpoint fallback | (defensive test) ถ้า LINE Console LIFF Endpoint เผลอตั้งเป็น `/` → ปุ่มยังพาไปหน้า `/parent/link` ได้ (10.9D-2 fix) | ▢ |

> **ข้อสำคัญ L4 + L7**: ทดสอบเคสที่ตอบโจทย์ resolver phase 10.9B —
> sibling under same phone ต้องได้รับ notification ครบทุกคน

---

### 5.9 Backup / Restore / Health (Operations)

| # | Check | Method | Result |
|---|---|---|---|
| O1 | Manual backup | `./scripts/backup-db.sh` → ไฟล์ `lampang_bus_YYYYmmdd_HHMMSS.sql.gz` ถูกสร้างใน `/home/schoolbus/backups/lampang-bus/` | ▢ |
| O2 | Checksum | `sha256sum -c <latest>.sha256` → `OK` | ▢ |
| O3 | Gzip integrity | `gzip -t <latest>.sql.gz` → silent (success) | ▢ |
| O4 | Restore drill | `./scripts/restore-drill-db.sh` → restored table count = production table count; row count summary ปรินต์ครบ; production DB ไม่เปลี่ยน | ▢ |
| O5 | Health check | `./scripts/health-check.sh` → 8/8 OK, exit 0 | ▢ |
| O6 | Cron scheduled | `crontab -l` → backup 02:30 + health 5-min present; `systemctl is-active cron` → active | ▢ |
| O7 | PM2 systemd | `systemctl is-active pm2-schoolbus` → active; `pm2 list` → backend + logrotate online | ▢ |
| O8 | Off-host backup | (pending operator config) → ดู §9 ของเอกสารนี้ ถ้ายัง YELLOW ระบุไว้ | ▢ |

---

## 6. Generic privacy / PDPA sweep

| # | Check | Method | Result |
|---|---|---|---|
| PV1 | ไม่มีเลข CID เต็มในหน้า UI | ดูทุก role ที่ทดสอบ | ▢ |
| PV2 | ไม่มี secrets ใน browser devtools console | F12 → console → ดูว่าไม่มี LINE token, JWT secret ปรากฏ | ▢ |
| PV3 | Transport ไม่เห็นจำนวนนักเรียน | ดู §5.4 T2 | ▢ |
| PV4 | Transport ไม่เห็นชื่อนักเรียนใน pickup map | ดู §5.4 T5 | ▢ |
| PV5 | API ไม่ตอบ data ของ role อื่นแม้ uri ถูก guess | ทดสอบใน §5.x หัวข้อ Hidden permission | ▢ |

---

## 7. Performance smoke

| # | Check | Method | Result |
|---|---|---|---|
| PF1 | Initial page load < 3s บน 4G | Chrome DevTools throttle → Fast 4G | ▢ |
| PF2 | Dashboard API < 1s | Network tab → ดู /api/.../dashboard | ▢ |
| PF3 | No CLS spike | Lighthouse → CLS < 0.1 | ▢ |
| PF4 | Mobile menu open < 200ms | tap nav bar → menu ปรากฏ | ▢ |

---

## 8. Closeout

หลังทดสอบครบทุก section:

- [ ] รวบรวมผล PASS/FAIL ในแต่ละ role section
- [ ] FAIL ทุกข้อต้องมี evidence (screenshot/log) + เปิด issue สำหรับ dev
- [ ] PASS ที่มี caveat ใส่ใน Notes
- [ ] Submit UAT closeout summary ให้ project owner
- [ ] หาก critical FAIL: หยุด go-live; แก้แล้วทดสอบใหม่
- [ ] หาก non-critical FAIL: list เป็น "known issue" และตัดสินใจร่วมกัน

---

## 9. Known caveats at UAT time (2026-06-02)

🟡 **Off-host backup destination ยังไม่ได้ตั้งค่า** — backup ปัจจุบันอยู่บน VPS
เดียวกับ database; ความเสี่ยง disk-loss/VM-loss ยังไม่ปิด.
ทำตาม [docs/ops-backup-restore.md §7.3](ops-backup-restore.md) เพื่อ
ตั้ง rclone หรือ rsync target ก่อน go-live เต็มรูปแบบ

🟡 **Swap pressure** บน VPS อยู่ที่ ~1.3G/2G (ระดับเตือน) — ถ้า traffic สูงขึ้น
มากระยะยาว ควรพิจารณาเพิ่ม RAM

🟢 ทุก capability หลักทดสอบและปิดงานในการพัฒนามาแล้ว — เหลือเพียง UAT
จริงในสภาพการใช้งานจริง

---

## 10. Sign-off block

| ผู้ทดสอบ | บทบาท | วันที่ | ผลรวม | Signature |
|---|---|---|---|---|
| (กรอก) | Admin | | PASS / FAIL | |
| (กรอก) | Province | | | |
| (กรอก) | Affiliation | | | |
| (กรอก) | Transport | | | |
| (กรอก) | School (full) | | | |
| (กรอก) | School (teacher) | | | |
| (กรอก) | Driver | | | |
| (กรอก) | Parent / LINE | | | |
| (กรอก) | Ops engineer | | | |

**Project owner sign-off**: ▢ ผ่าน  ▢ ผ่านพร้อมเงื่อนไข  ▢ ไม่ผ่าน

ลายเซ็น: __________________________  วันที่: __________
