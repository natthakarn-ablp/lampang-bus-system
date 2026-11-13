# สารบัญเอกสาร (docs/INDEX.md)

ปรับปรุง 2026-11-08 (DOC-001). หลัก: **โค้ด > เอกสารปัจจุบัน > เอกสารประวัติ**. เอกสารที่จัดเป็น "ประวัติ" ไม่ได้ถูกลบหรือย้าย (ยกเว้นสเปกเดิมของ CLAUDE.md) — ใช้เพื่อดูที่มา ไม่ใช่สถานะปัจจุบัน

## สิ่งที่ถูกเผยแพร่สู่สาธารณะ
- เว็บไซต์ให้บริการเฉพาะ `frontend/dist` (SPA) และ `/manual/` = **ทุกไฟล์ใน `docs/manual-html/`** — ห้ามวางรายงานภายใน ข้อมูลจริง หรือ screenshot ที่มีข้อมูลเด็กในโฟลเดอร์นี้ (ตรวจ 2026-11-08: path อื่นเช่น `/CLAUDE.md`, `/docs/...`, `/.git/HEAD` ได้หน้า SPA ไม่ใช่ไฟล์)
- repository เป็น **public** — ทุกไฟล์ที่ commit ถือว่าเผยแพร่แล้ว

## ปัจจุบัน — เริ่มที่นี่
| เอกสาร | ใช้เมื่อ |
|---|---|
| [`/README.md`](../README.md) | ภาพรวม + เริ่มพัฒนา |
| [`/CLAUDE.md`](../CLAUDE.md) | กติกากลาง (RBAC, rules) สำหรับ AI/ผู้พัฒนา |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | runtime, โครงสร้างโค้ด, CI/deploy, migration, backup |
| [`modules/`](modules/README.md) | 13 โมดูล: จุดเข้า โค้ด ตาราง กติกา test |
| [`status/audit-2026-11-08-tracking.md`](status/audit-2026-11-08-tracking.md) | finding → PR → หลักฐาน → สถานะ production |
| [`status/night-work-2026-11-08.md`](status/night-work-2026-11-08.md) | บันทึกงาน/checkpoint ล่าสุด (branch `night/tracker`) |

### ปฏิบัติการ (ops)
| เอกสาร | หัวข้อ |
|---|---|
| [`ops/DEPLOY_CI_GATE.md`](ops/DEPLOY_CI_GATE.md) | deploy ต้องผ่าน CI gate (OPS-001) |
| [`ops/backup-restore-readiness.md`](ops/backup-restore-readiness.md) | backup 4 ขั้น, แจ้งเตือน, rclone client_id, restore drill |
| [`ops/automation-crons.md`](ops/automation-crons.md) | cron คิวงานค้าง (แจ้งในระบบ), snapshot รายวัน, เฝ้าระวัง backup/health — เวลา UTC; ติดตั้งด้วย `scripts/install-automation-crons.sh` |
| [`OPERATOR_RUNBOOK.md`](OPERATOR_RUNBOOK.md), [`ops-backup-restore.md`](ops-backup-restore.md), [`ops-data-reset.md`](ops-data-reset.md), [`ops-admin-password-recovery.md`](ops-admin-password-recovery.md) | runbook เดิม — ตรวจกับสคริปต์ก่อนใช้ |
| [`ops/deploy-record-template.md`](ops/deploy-record-template.md), `ops/deploy-*.md` | แม่แบบ/บันทึก deploy รายครั้ง (ประวัติ) |
| `../ops/backup/README.md` | เครื่องมือ backup แบบเข้ารหัส + ตัวตรวจสถานะ |
| [`INCIDENT_PDPA_SOP_2026-08.md`](INCIDENT_PDPA_SOP_2026-08.md) | ขั้นตอนเหตุข้อมูลส่วนบุคคล |
| `security/` | ข้อเสนอ/บันทึกด้านความปลอดภัย |

### ผู้ใช้งาน
- คู่มือที่เผยแพร่: `manual-html/` (สร้าง PDF ด้วย `scripts/build-manual-pdf.sh`) — **ฉบับปัจจุบัน**
- `user-guide-*.md`, `user-manual.md`, `SCHOOL_USER_GUIDE_IMPORTS.md`, `training-agenda.md`, `manual-training-2026-08/` — ฉบับร่าง/อบรมเดิม อาจไม่ตรงหน้าจอปัจจุบัน

### ออกแบบ/นโยบายที่ยังใช้อ้างอิง
`ui-design-system.md`, `ui-label-enforcement.md`, `ui-review-checklist.md`, `design/`, `policy-notice-decision-register.md`, `policy-notice-workflow-implementation.md`, `pdpa-consent-and-data-confirmation-plan.md`, `driver-permission-verification-workflow.md`, `transport-verification-workflow-20261017.md`, `measurement-framework.md`, `affiliation-term-report-workflow.md`, `password-recovery-all-roles-roadmap.md`

## ประวัติ (ลงวันที่ / สถานะ ณ เวลานั้น)
- สเปกตั้งต้น: [`history/CLAUDE-original-spec.md`](history/CLAUDE-original-spec.md)
- สถานะ/อัปเดตรายวัน มิ.ย. 2569: `STATUS-2026-06-2*.md`, `UPDATE-2026-06-2*.md`, `PRODUCTION-RECOVERY-2026-06-23.md`, `UX-UI-2026-06-23.md`, `roleplay-audit-2026-06-24.md`, `SECURITY_FOLLOWUP_BACKLOG_2026_06_18.md`
- เฟส/ประตูเปิดใช้: `phase-2-qa-report.md`, `phase-9-*.md`, `PHASE9_*`, `READINESS_SCORECARD_2026-08.md`, `PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md`, `MVP-CUT-2026-08.md`, `RELEASE_10.13B_ADMIN_FREE.md`, `FIELD_ROLLOUT_*`, `INFRA_REENTRY_CHECKLIST_10.13C.md`, `OPERATOR_INPUT_REQUESTS_10.13C.md`, `UX_POLISH_BACKLOG_10.13C.md`, `UAT*`, `final-uat-checklist.md`, `uat-deployment-guide.md`, `go-live-handoff.md`, `operator-go-live-checklist.md`, `production-launch-checklist.md`, `production-readiness.md`, `production-polish-backlog.md`, `deploy-readiness-report.md`, `deployment-hardening.md`, `implementation-roadmap.md`, `line-oa-mvp.md`, `TRAINING_PACK_2026-08.md`, `ADMIN_WORKFLOWS.md`, `transport-permission-verification-workflow.md`, `role-menu-participatory-research-audit-2026-09-04.md`
- โฟลเดอร์: `audit/`, `project-closure/`, `release/`, `performance/`, `research/`, `ui/`, `ui-baseline/`, `ui-redesign-*.md`, `manual-audit/`, `superpowers/`, `data/`
- รายงานตรวจระบบภายนอก repo: รายงานตรวจสิทธิ์รายบทบาท (2026-11-07/08) และ `SYSTEM_AUDIT_2026-11-08_1325.md` เก็บในเครื่องเจ้าของ (มีรายละเอียดภายใน production)
