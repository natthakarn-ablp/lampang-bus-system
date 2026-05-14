# Phase 10.3A — Screenshot Checklist for User Manual

*Audit date: 2026-05-14*
*Source commit: `db9ca0e`*

This checklist enumerates every screenshot needed for the role-based user manual. Capture at production-equivalent resolution (1440×900 desktop, 390×844 mobile where called out). **No real passwords, no real PII** — use the seed test accounts and the data-prep notes below.

## Account legend (operator-side only — never paste real values in chat)

| Role | Test username | Where the password lives |
|---|---|---|
| Admin | `admin01` (or whatever seed exists in `users` table) | operator's password manager |
| Province | `lpg` / `province01` (per seed) | password manager |
| Affiliation | `lpg1` … `lpg5` / `lpglp` / `lpgpeo` | password manager |
| School (full) | `test` or a real school OBEC | password manager |
| School (grade-teacher) | a teacher account created via `/school/teacher-accounts` | password manager |
| Driver | a plate-number login (e.g. `นข 1571 ลำปาง`) | password manager |
| Transport | `transport01` (per seed) | password manager |
| Parent | LINE OA bind flow with a real LINE friend | LINE OA (no password — LINE auth) |

> **All screenshots must redact** any real personal name, ID number, phone number, or LINE user ID before being committed to docs.

## Shared / pre-login screens

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| S-01 | `/login` desktop | Login form, error-message state (wrong password) | n/a | none | 3 |
| S-02 | `/login` mobile | Same as S-01 at 390×844 | n/a | none | 3 |
| S-03 | `/change-password` | Forced after admin reset OR bulk-import first-login | any newly created account | reset a test account or import one via Phase 10.2A | 3 |

## Admin

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| A-01 | `/admin` | Full dashboard with KPI cards | admin | seed data | 5 |
| A-02 | Sidebar collapsed + expanded states | Group headers (จัดการระบบ / ตรวจสอบ / มุมมองจังหวัด / รายงาน) | admin | n/a | 5 |
| A-03 | `/admin/users` | User list with filters bar visible | admin | ≥ 10 users of mixed roles | 5 |
| A-04 | `/admin/users` → Create User modal | Modal open at role=`affiliation`, organization dropdown showing all 5 affiliations (verifies Phase 10.1A/B) | admin | run Phase 10.1A + 10.1B migrations | 5 |
| A-05 | `/admin/users` → Reset password modal | confirmation copy | admin | any test user | 5 |
| A-06 | `/admin/audit-logs` | Filter UI + table rows | admin | at least 20 log rows; mix of CREATE / UPDATE / EXPORT | 5 |
| A-07 | `/admin/pickup-points` | List + create form | admin | ≥ 3 pickup points across 2 vehicles | 5 |
| A-08 | `/admin/live-vehicles` desktop | Map + filters + plate search (Phase 9.12) | admin | ≥ 5 active GPS-emitting vehicles | 5 |
| A-09 | `/admin/live-vehicles` mobile | Stacked filter chips (Phase 9.12 Hotfix 2) | admin | same | 5 |
| A-10 | `/admin/system-health` | Operational metrics view | admin | live system | 5 |
| A-11 | `/admin/research-export` preview | Date-range + preview counts | admin | snapshots already computed | 12 |

## Province

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| P-01 | `/province` | Dashboard | province | seed | 6 |
| P-02 | Province sidebar | Six groups visible | province | n/a | 6 |
| P-03 | `/province/affiliations` | Affiliation list with drill-down links | province | 5 affiliations from Phase 10.1A/B | 6 |
| P-04 | `/province/schools` | School list with affiliation filter | province | ≥ 4 schools across 2 affiliations | 6 |
| P-05 | `/province/students` | Search results + filter bar | province | ≥ 30 students | 6 |
| P-06 | `/province/vehicles` | List + at-risk overlay | province | ≥ 5 vehicles with assorted inspection statuses | 6 |
| P-07 | `/province/status` | Daily status with plate autocomplete (Phase 9.11) | province | today's data populated | 6 |
| P-08 | `/province/live-vehicles` | Live map | province | live | 6 |
| P-09 | `/province/pickup-map` | Read-only pickup map | province | pickup points exist | 6 |
| P-10 | `/province/audit-log` | Audit log with CSV export button | province | logs present | 6 |

## Affiliation

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| F-01 | `/affiliation` | Dashboard | affiliation | own scope data | 7 |
| F-02 | Affiliation sidebar | Six groups | affiliation | n/a | 7 |
| F-03 | `/affiliation/schools` | School list (own affiliation only) | affiliation | ≥ 3 schools in scope | 7 |
| F-04 | `/affiliation/accounts` — page header + Section A collapsed | "เพิ่มโรงเรียนใหม่" + Section A button | affiliation | n/a | 7, 13 |
| F-05 | `/affiliation/accounts` — Section A expanded | Manual form (3 fields + warning card) | affiliation | n/a | 7, 13 |
| F-06 | `/affiliation/accounts` — Section B with file chosen | File name + "ตรวจสอบข้อมูล" button enabled | affiliation | template downloaded + edited | 7, 13 |
| F-07 | `/affiliation/accounts` — Section B preview table | 3 summary cards + table rows showing 1 PASS, 2 FAIL with Thai error messages | affiliation | crafted file with one valid, one duplicate, one missing school_name | 13 |
| F-08 | `/affiliation/accounts` — Section B post-commit toast | "นำเข้าสำเร็จ" success | affiliation | committed import | 13 |
| F-09 | `/affiliation/accounts` — Section C recent accounts | Read-only table | affiliation | recent imports visible | 7 |
| F-10 | `/affiliation/students` | Search + filter | affiliation | ≥ 20 students | 7 |
| F-11 | `/affiliation/status` | Daily status + plate autocomplete | affiliation | today data | 7 |
| F-12 | `/affiliation/live-vehicles` | Live map | affiliation | live | 7 |
| F-13 | `/affiliation/audit-log` | Audit log + CSV export | affiliation | logs present | 7 |

## School

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| H-01 | `/school` | Dashboard | school (full) | own data | 8 |
| H-02 | School sidebar (full account) | Six groups, all items visible | school (full) | n/a | 8 |
| H-03 | School sidebar (grade-teacher) | Three blocked items hidden | school (grade) | create a teacher account first | 8 |
| H-04 | `/school/students` | Search + filter + per-row action menu | school | ≥ 20 students | 8 |
| H-05 | `/school/students` import template download | Empty state with template link | school | n/a | 13 |
| H-06 | `/school/students` import preview table | Validation results | school | crafted file with mix | 13 |
| H-07 | `/school/vehicles` | List with driver/student counts | school | ≥ 3 vehicles | 8 |
| H-08 | `/school/bulk-vehicles` | Bulk vehicle import preview | school (full) | crafted file | 13 |
| H-09 | `/school/pickup-map` | Map + create-point modal | school | ≥ 2 points | 8 |
| H-10 | `/school/approvals` | Pending request list + approve modal | school | submit a roster-change-request from driver app first | 8 |
| H-11 | `/school/teacher-accounts` | Grade-teacher account list + create modal | school (full) | n/a | 8 |
| H-12 | `/school/audit-log` | Audit log + CSV export | school (full) | logs present | 8 |

## Driver

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| D-01 | `/driver` mobile | Today's roster summary | driver | morning roster populated | 9 |
| D-02 | Driver sidebar mobile | Three groups | driver | n/a | 9 |
| D-03 | `/driver/roster` mobile | Per-student checkin/out controls | driver | morning session active | 9 |
| D-04 | Checkin success | Toast + updated state | driver | one student | 9 |
| D-05 | `/driver/pickup-map` mobile | Map with pickup points | driver | ≥ 2 points | 9 |
| D-06 | Pickup-point edit modal | SearchableSelect for students (Phase 9.4/9.5/9.8B auto-flip) | driver | students assignable | 9 |
| D-07 | `/driver/emergency` mobile | Emergency form | driver | n/a | 9 |
| D-08 | `/driver/profile` mobile | Profile with photo upload | driver | n/a | 9 |
| D-09 | `/driver/requests` mobile | Pending roster-change-requests | driver | submit one from parent/school | 9 |

## Transport

| ID | Page | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| T-01 | `/transport` | Dashboard (KPI cards) | transport | ≥ 3 vehicles with inspections | 10 |
| T-02 | Transport sidebar | Two groups | transport | n/a | 10 |
| T-03 | `/transport/vehicles` | Vehicle list filtered by PENDING | transport | mix of statuses | 10 |
| T-04 | `/transport/vehicles` create-vehicle modal | New plate form | transport | n/a | 10 |
| T-05 | `/transport/inspections` | Inspection record list | transport | several rows | 10 |
| T-06 | `/transport/inspections` create modal | Inspection form (result dropdown PASSED/FAILED/NEEDS_FIX/PENDING) | transport | n/a | 10 |
| T-07 | `/transport/inspections` edit modal | Same form prefilled | transport | existing inspection | 10 |

## Parent / LINE OA

| ID | Surface | What to capture | Account | Data prep | Manual chapter |
|---|---|---|---|---|---|
| L-01 | LINE OA chat | Welcome message after add-friend | new LINE account | LINE OA configured | 11 |
| L-02 | LINE OA chat | Bind flow: phone number → student id → success | parent | a student with matching phone in DB | 11 |
| L-03 | LINE OA chat | `สถานะ` command response | linked parent | today's data | 11 |
| L-04 | LINE OA chat | `ข้อมูลบุตร` command response | linked parent | n/a | 11 |
| L-05 | LINE OA chat | `ยกเลิกผูกบัญชี` confirm flow | linked parent | n/a | 11 |
| L-06 | LIFF view (`/parent`) | Children list + status cards | linked parent | n/a | 11 |
| L-07 | LIFF view child history | 7-day history | linked parent | history data | 11 |
| L-08 | Auto-notification | Checkin-arrival LINE push card | linked parent | trigger from driver checkin | 11 |
| L-09 | Auto-notification | Checkout / emergency push card | linked parent | trigger | 11 |

## Common error / empty states

| ID | Where | What to capture | Manual chapter |
|---|---|---|---|
| E-01 | Empty student list page | "ยังไม่มีนักเรียน" state | 14 |
| E-02 | Login wrong password | Error toast in Thai | 14 |
| E-03 | 403 unauthorized | Page-level fallback | 14 |
| E-04 | Excel import — duplicate row | Validation table row with red "ไม่ผ่าน" badge | 13 |
| E-05 | Excel import — wrong format | Reject toast | 13, 14 |
| E-06 | Driver location lost / stale | Live-vehicles map "ความแม่นยำต่ำ" chip | 14 |
| E-07 | `/health` `database.connected=false` (simulated) | Smoke output (for ops appendix) | 16 |

## Counts

- **Total screenshots planned:** ~85
- **Admin:** 11 · **Province:** 10 · **Affiliation:** 13 · **School:** 12 · **Driver:** 9 · **Transport:** 7 · **Parent:** 9 · **Shared / errors:** 14
- **Mobile-specific:** 5 (driver dashboard, roster, pickup-map, emergency, profile)

## Capture rules

1. Browser zoom = 100 %, no devtools panel visible
2. Redact: real names → "นาย/นาง [ตัวอย่าง]"; phone → `08X-XXX-XXXX`; LINE user ID → `Uxxx…xxx`; school code → `XXXXXX`
3. Use placeholder student names that match the seed dataset, not real students
4. Screenshots committed to `docs/manual/screenshots/` follow naming `S01-login-desktop.png`, `A01-admin-dashboard.png`, etc., matching the IDs above
