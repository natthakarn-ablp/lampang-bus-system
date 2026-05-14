# Phase 10.3A — Role × Route Matrix

*Audit date: 2026-05-14*
*Source commit: `db9ca0e`*

## Legend

| Column | Meaning |
|---|---|
| **Role** | One of `admin`, `province`, `affiliation`, `school` (incl. grade-teacher sub-account), `driver`, `transport`, `parent` |
| **Path** | URL path the user navigates to |
| **Menu label (TH)** | Thai label rendered in the sidebar/menu; `—` if the page is not in any sidebar |
| **Component** | React component file under `frontend/src/pages/` |
| **Purpose** | One-line summary |
| **Main actions** | What the user can do on this page (view-only / CRUD / import / export / etc.) |
| **Backend API** | Primary endpoints called |
| **Scope rule** | Server-side scope enforcement (from JWT) |
| **C / E / D / X** | Create / Edit / Delete / Export — `✓` / `—` / `✗` (✗ = endpoint exists but blocked for this role) |
| **Priority** | Manual chapter priority: **H** high / **M** medium / **L** low |

## Admin (`role='admin'`)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/admin` | ศูนย์ควบคุมระบบ | AdminDashboard | System dashboard | view summary KPIs, quick links | `/api/admin/system-health`, `/api/admin/users-needing-action` | full | — | — | — | — | **H** |
| `/admin/users` | จัดการผู้ใช้งาน | UserManagement | User CRUD | create / edit / reset-password / soft-delete | `/api/admin/users`, `/api/admin/users/:id/*` | full | ✓ | ✓ | ✓ | — | **H** |
| `/admin/audit-logs` | ประวัติการใช้งาน | AdminAuditLog | System-wide audit log | filter by action/date, CSV export | `/api/admin/audit-logs` | full | — | — | — | ✓ | **H** |
| `/admin/pickup-points` | ตรวจสอบจุดรับส่ง | AdminPickupPointManagement | Pickup-point CRUD across vehicles | create / edit / delete / link students | `/api/admin/pickup-points/*` | full | ✓ | ✓ | ✓ | — | **M** |
| `/admin/live-vehicles` | ตรวจสอบตำแหน่งรถ | AdminLiveVehicles | Real-time vehicle map | live filter, plate autocomplete | `/api/admin/live-vehicles` | full | — | — | — | — | **H** |
| `/admin/measurement` | กรอบวัดผลระบบ | MeasurementFramework | Research/measurement framework dashboard | view metrics | `/api/admin/evaluation-summary` | full | — | — | — | — | **L** |
| `/admin/research` | เปรียบ Baseline | ResearchMetrics | Baseline-vs-latest deltas per role | view trend tables | `/api/admin/evaluation-summary`, `/api/admin/snapshots` | full | — | — | — | — | **L** |
| `/admin/research-export` | ส่งออกข้อมูลวิจัย | ResearchExport | Research dataset export | preview, export CSV/Excel/JSON | `/api/admin/research-export*` | full | — | — | — | ✓ | **L** |
| `/admin/evaluation` | ประเมินผลแยก Role | EvaluationDashboard | Per-role action counts | view tables | `/api/admin/evaluation-summary` | full | — | — | — | — | **L** |
| `/admin/executive` | สรุปผู้บริหาร | ExecutiveSummary | Executive summary view | view summary, print | `/api/admin/evaluation-summary` | full | — | — | — | — | **M** |
| `/admin/system-health` | สุขภาพระบบ | SystemHealth | System health gauge | view operational metrics | `/api/admin/system-health` | full | — | — | — | — | **H** |
| `/admin/executive-print` | — | ExecutivePrint | Printable executive summary | print only | `/api/admin/evaluation-summary` | full | — | — | — | ✓ | **L** |

**Sidebar groups for admin:** ภาพรวม / จัดการระบบ / ตรวจสอบและสนับสนุน / มุมมองจังหวัด (cross-link) / รายงานและวิเคราะห์.

## Province (`role='province'`)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/province` | ภาพรวมจังหวัด | ProvinceDashboard | Province-wide KPIs | view summary, drill-down | `/api/province/dashboard`, `/api/province/trend` | full | — | — | — | — | **H** |
| `/province/affiliations` | สังกัด | ProvAffiliationList | List of all affiliations | view + drill-down | `/api/province/affiliations` | full | — | — | — | — | **H** |
| `/province/schools` | โรงเรียน | ProvSchoolList | All schools (filterable by affiliation) | view + drill-down | `/api/province/schools` | full | — | — | — | — | **H** |
| `/province/students` | ข้อมูลนักเรียน | ProvStudentSearch | Province-wide student search | view; filters: grade/school/affiliation/vehicle | `/api/province/students` | full | — | — | — | — | **M** |
| `/province/vehicles` | รถรับส่ง | ProvVehicleList | All vehicles (PII-sanitized) | view; risk overlay | `/api/province/vehicles`, `/api/province/vehicles-at-risk` | full | — | — | — | — | **H** |
| `/province/status` | — (สถานะรายวัน, deep link) | ProvDailyStatus | Province-wide daily checkin/checkout | view + plate autocomplete | `/api/province/status-today` | full | — | — | — | — | **M** |
| `/province/live-vehicles` | ตำแหน่งปัจจุบัน | ProvinceLiveVehicles | Live vehicle map | view live, audited | `/api/province/live-vehicles` | full | — | — | — | — | **H** |
| `/province/pickup-map` | แผนที่จุดรับส่ง | ProvincePickupMap | Read-only pickup-point map | view, SearchableSelect filters | `/api/province/pickup-map` | full | — | — | — | — | **M** |
| `/province/emergencies` | เหตุฉุกเฉิน | ProvEmergencyList | Emergency reports | view | `/api/province/emergencies` | full | — | — | — | — | **M** |
| `/province/audit-log` | ประวัติการแก้ไข | ProvAuditLog | Province audit log | filter, CSV export | `/api/province/audit-logs` | full | — | — | — | ✓ | **H** |

## Affiliation (`role='affiliation'`)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/affiliation` | ภาพรวมสังกัด | AffiliationDashboard | Affiliation KPIs | view summary | `/api/affiliation/dashboard` | own affiliation | — | — | — | — | **H** |
| `/affiliation/schools` | โรงเรียนในสังกัด | SchoolList | List schools in affiliation | view + drill-down | `/api/affiliation/schools` | own affiliation | — | — | — | — | **H** |
| `/affiliation/students` | ข้อมูลนักเรียน | AffStudentSearch | Search students across affiliation | view + filters | `/api/affiliation/students` | own affiliation | — | — | — | — | **M** |
| `/affiliation/vehicles` | รถรับส่ง | AffVehicleList | Vehicles across affiliation | view | `/api/affiliation/vehicles` | own affiliation | — | — | — | — | **M** |
| `/affiliation/status` | — (deep link) | AffDailyStatus | Daily status (plate autocomplete from Phase 9.11) | view + plate filter | `/api/affiliation/status-today` | own affiliation | — | — | — | — | **M** |
| `/affiliation/live-vehicles` | ตำแหน่งปัจจุบัน | AffiliationLiveVehicles | Live map for affiliation | view live | `/api/affiliation/live-vehicles` | own affiliation | — | — | — | — | **H** |
| `/affiliation/pickup-map` | แผนที่จุดรับส่ง | AffiliationPickupMap | Read-only pickup map | view | `/api/affiliation/pickup-map` | own affiliation | — | — | — | — | **M** |
| `/affiliation/accounts` | จัดการบัญชีโรงเรียน | AffSchoolAccounts | **Add new schools** (single + bulk Excel — Phase 10.2A) | manual add / template DL / preview / commit | `/api/affiliation/school-accounts*`, `/school-accounts/import-template`, `/school-accounts/import/preview`, `/school-accounts/import/commit`, `/school-accounts/new-school` | own affiliation | ✓ | ✗ | ✗ | — | **H** |
| `/affiliation/emergencies` | เหตุฉุกเฉิน | AffEmergencyList | Emergency list | view | `/api/affiliation/emergencies` | own affiliation | — | — | — | — | **M** |
| `/affiliation/audit-log` | ประวัติการแก้ไข | AffAuditLog | Affiliation audit log | view, CSV export | `/api/affiliation/audit-log` | own affiliation | — | — | — | ✓ | **M** |

## School (`role='school'` — full account)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/school` | ภาพรวมโรงเรียน | SchoolDashboard | School KPIs | view summary | `/api/school/dashboard` | own school | — | — | — | — | **H** |
| `/school/students` | ข้อมูลนักเรียน | StudentSearch | Student CRUD | view + import + export | `/api/school/students*`, `/students/import*`, `/students/export` | own school | ✓ | ✓ | ✓ | ✓ | **H** |
| `/school/vehicles` | รถรับส่ง | VehicleList | Vehicle list | view + driver/student counts | `/api/school/vehicles` | own school | — | — | — | — | **M** |
| `/school/bulk-vehicles` | เพิ่มรถรับส่ง | SchoolBulkVehicles | Bulk vehicle import | template DL / preview / commit | `/api/school/vehicles/import*` | own school (full) | ✓ | — | — | — | **M** |
| `/school/pickup-map` | แผนที่จุดรับส่ง | SchoolPickupMap | Pickup-point map + bulk-link | view + edit student assignments | `/api/school/pickup-map`, `/pickup-points*` | own school | ✓ | ✓ | — | — | **M** |
| `/school/live-vehicles` | ตำแหน่งปัจจุบัน | SchoolLiveVehicles | Live vehicle map | view live, audited | `/api/school/live-vehicles` | own school | — | — | — | — | **M** |
| `/school/approvals` | คำขอรายชื่อ | SchoolApprovals | Roster-change-request review | approve / reject | `/api/school/approvals*` | own school | — | ✓ | — | — | **H** |
| `/school/teacher-accounts` | บัญชีครูประจำสายชั้น | SchoolTeacherAccounts | Grade-teacher account CRUD | create / edit / delete | `/api/school/accounts*` | own school (full only) | ✓ | ✓ | ✓ | — | **M** |
| `/school/emergencies` | เหตุฉุกเฉิน | EmergencyList | Emergency reports | view | `/api/school/emergencies` | own school | — | — | — | — | **M** |
| `/school/audit-log` | ประวัติการแก้ไข | SchoolAuditLog | School audit log | view, CSV export | `/api/school/audit-log` | own school (full only) | — | — | — | ✓ | **L** |

**Grade-teacher (school sub-account with `grade_scope` set):** sees only ภาพรวม / นักเรียนและรถรับส่ง / แผนที่และตำแหน่ง / ติดตามและบันทึก (sub-set). **Blocked routes:** `/school/audit-log`, `/school/bulk-vehicles`, `/school/teacher-accounts`. Backend enforces via `requireFullSchoolScope()` middleware.

## Driver (`role='driver'`)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/driver` | ภาพรวมสถานะรับส่ง | DriverDashboard | Today's roster summary | view + quick checkin | `/api/driver/status-today`, `/api/driver/roster` | own vehicle | — | ✓ | — | — | **H** |
| `/driver/roster` | — (linked from dashboard) | StudentList | Full roster per session | view + per-student checkin/out | `/api/driver/roster`, `/driver/checkin`, `/driver/checkout`, `/driver/checkin-all` | own vehicle | — | ✓ | — | — | **H** |
| `/driver/pickup-map` | แผนที่จุดรับส่ง | DriverPickupMap | Pickup-point map for own vehicle | view / create / edit pickup point + assign students | `/api/driver/pickup-points*`, `/driver/pickup-students` | own vehicle | ✓ | ✓ | ✓ | — | **H** |
| `/driver/requests` | คำขอรายชื่อ | DriverRosterRequests | Pending roster-change-requests for vehicle | view | `/api/driver/roster-requests` | own vehicle | — | — | — | — | **M** |
| `/driver/pretrip` | — (linked from dashboard) | DriverPretrip | Pre-trip checklist | record pre-trip status | `/api/driver/pretrip*` (verify) | own vehicle | ✓ | — | — | — | **M** |
| `/driver/emergency` | แจ้งเหตุฉุกเฉิน | EmergencyPage | Emergency report | submit | `/api/driver/emergency` | own vehicle | ✓ | — | — | — | **H** |
| `/driver/profile` | ข้อมูลคนขับ | DriverProfile | Driver profile + photo + leaves | view / edit photo+phone / request leave | `/api/driver/profile`, `/upload-photo`, `/leaves*` | own driver | — | ✓ | — | — | **M** |

Background: `POST /api/driver/location` (rate-limited 6/min) is called automatically by the driver app to feed live-vehicle maps.

## Transport (`role='transport'`)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/transport` | ภาพรวมตรวจสภาพรถ | TransportDashboard | Inspection KPIs | view, filter expiring/pending | `/api/transport/dashboard`, `/transport/vehicles` | full | — | — | — | — | **H** |
| `/transport/vehicles` | — (linked from dashboard) | TransportVehicleList | Vehicle list with inspection status | filter by status + create new vehicle | `/api/transport/vehicles*`, `/api/transport/schools` | full | ✓ | — | — | — | **H** |
| `/transport/inspections` | บันทึกตรวจสภาพ | InspectionForm | Inspection records | create / edit / view | `/api/transport/inspections*` | full | ✓ | ✓ | — | — | **H** |
| `/transport/pickup-map` | แผนที่จุดรับส่ง | TransportPickupMap | Read-only pickup map (overlay) | view | `/api/transport/pickup-map` | full | — | — | — | — | **L** |

## Parent / LINE OA (`no JWT — line_user_id`)

| Path | Menu label (TH) | Component | Purpose | Main actions | Backend API | Scope rule | C | E | D | X | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/parent` (LIFF) | — (LIFF webview) | ParentStatus | Parent view of their children's status | view today + history | `/api/parent/children`, `/api/parent/children/:id/status`, `/api/parent/children/:id/history` | parent ↔ student link only | — | — | — | — | **H** |
| LINE OA chat | — | (LINE app) | Chat with bot to bind/unbind/status | `ผูกบัญชี` / `สถานะ` / `ข้อมูลบุตร` / `ยกเลิกผูกบัญชี` / `เปลี่ยนบัญชี` | `POST /api/line/webhook` (server-side) | LINE signature only | — | ✓ | ✓ | — | **H** |

## Shared

| Path | Component | Purpose | Notes | Priority |
|---|---|---|---|---|
| `/login` | Login | Authenticate; obtain JWT + refresh-token | All roles | **H** |
| `/change-password` | ChangePassword | Forced when `must_change_password=TRUE` after admin create / reset / Phase 10.2A bulk import | Any logged-in role | **H** |
| `/` | (redirect) | `ROLE_HOME` map redirects to role-specific landing | — | **L** |

## Notes on role overlap

- **Admin** can access every role-scoped UI by virtue of the `requireRole(role, 'admin')` pattern + a `?affiliation_id=` / `?school_id=` style query parameter. Manual should make clear: admin's experience differs from a true affiliation/school user because admin sees all scopes and has additional sidebar items.
- **Province** can read but not write across all affiliations.
- **Affiliation** can read its own affiliation's schools/students/vehicles and create new schools + accounts (Phase 10.2A).
- **School (full)** is the principal/director account.
- **School (grade-teacher sub-account)** is read-only at the school level; the manual should call this out.
