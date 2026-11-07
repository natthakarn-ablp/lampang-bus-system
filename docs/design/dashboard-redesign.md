# Dashboard & report redesign — spec (training 12 Nov 2569)

Status: foundation merged (shared components + this spec). Area agents A–D
migrate their pages on top of it. Everything here is **frontend-only** and uses
fields the APIs already return.

## 0. Safety rules (apply to every area)

- No DB migrations. No change to permission/scope logic (grade-teacher grade
  scope, school, affiliation, province), auth or rate limits.
- Prefer frontend-only. A backend change is allowed only if it is read-only,
  scope-filtered exactly like the existing endpoint, and has tests.
- Thai UI. Keep LABEL_STANDARDS (`npm run check:labels:strict`): e.g. never
  "ยังไม่ครบ" (use "ยังมีรายการค้าง"/"ค้าง N คน"), "สังกัด" not "เขตพื้นที่".
- Gates before PR (in `frontend/`): `npm run build`, `npm run check:labels:strict`,
  `node ../scripts/ui-redesign/page-status.mjs --gate`,
  `node ../scripts/ui-redesign/route-matrix.mjs --gate`, `npm run check:hybrid-ui`,
  `npm run test:readiness`.
- Do NOT rebuild manual PDFs. Do update wording in `docs/manual-html/*.html`
  where a label or layout you changed is described.
- Do not edit `frontend/src/components/dashboard/*` (foundation-owned). Need a
  change? Build it locally in your page file and note it in your PR.

## 1. Problems seen in live QA (qa-live/out/*)

| # | Problem | Fix |
|---|---|---|
| 1 | "แยกการเดินทางและการลา" card (mostly zeros) at the very top, above the page title (dashboards, daily/monthly/summary/policy report, province daily status). | **Done in foundation.** Card is now `TravelLeaveSummary`: hidden when all counts are 0, one-line summary + disclosure, conflict shown as danger. All mounts moved under the round numbers. `components/AttendanceBreakdown.jsx` is a deprecated alias. |
| 2 | Empty-looking box "งานแก้ไขรายการพิเศษ" (closed `<details>` with a title only) on the school dashboard. | Area A: move "ยืนยันแทนคนขับ" into the hero action area / a `SectionCard collapsible` with a sub line, or a secondary button; never a bare titled box. |
| 3 | Daily report hero says "ระบบรถรับส่งนักเรียนจังหวัดลำปาง" instead of the scope. | Area B: hero title = scope name (§4.B). |
| 4 | Red 0% before a round starts / on holidays. | Use `roundStatus()` everywhere a round is coloured. |
| 5 | Many equal-weight cards, the main answer not obvious. | One `StatusHero` at the top, `ActionList` second, everything else lower / folded. |
| 6 | Affiliation: big numbers (86 / 106 schools) with no explanation of what to do. | Area C: each count becomes an `ActionList` row that says what to do and links to a filtered list. |

## 2. Page skeleton (every dashboard, top → bottom)

1. **Header** — `RoleChip` + `PageHeader` (title, scope name · date). Quick
   actions (max 3–4 buttons; primary first).
2. **`StatusHero`** — "วันนี้เป็นอย่างไร": one headline sentence (from
   `dayStatus`), one `RoundProgress` per round (เช้า / เย็น: done / expected,
   bar, status word), at most ONE action button (the next step).
3. **`ActionList` "ต้องทำวันนี้"** — only items with a count > 0, each a row
   linking to the page where the user acts. Danger first. Never repeat the
   hero's topic. `afterAlert` when the hero is warn/danger.
4. **Secondary numbers** — `StatGrid` of `StatTile` (calm by default).
5. **`TravelLeaveSummary`** — in context under the round numbers (auto-hides).
6. **Detail** — charts, per-vehicle / per-school lists, completeness: in
   `SectionCard collapsible` or existing `FoldSection`, closed by default.
7. Load failures: one `AlertBanner` with "ลองใหม่"; failed numbers are "—",
   never 0 (`unavailable` prop on tiles/actions, `roundStatus({unavailable})`).

Empty sections render nothing (`SectionCard` hides itself; `ActionList
hideWhenEmpty` where a green "ไม่มีงานค้าง" would be noise).

## 3. Status colours (time-aware) — `components/dashboard/roundStatus.js`

Round clock (Asia/Bangkok). Only `DRIVER_SESSION_SWITCH_HOUR` (12) exists as a
server setting; the rest are product defaults in `ROUND_TIMES` (one place):

| Round | opens | due by | closes |
|---|---|---|---|
| เช้า (ส่งถึงโรงเรียน) | 06:00 | 09:00 | 12:00 |
| เย็น (ส่งถึงบ้าน) | 14:30 | 17:30 | 19:00 |

Phases: `off_day` (Sat/Sun, or API `is_school_day === false`), `future`,
`before`, `open`, `overdue`, `closed` (today, after close), `past` (earlier date).

| State | Tone | Label |
|---|---|---|
| feed failed | neutral | ไม่มีข้อมูล ("—") |
| attendance conflict | **danger** | ข้อมูลขัดกัน |
| expected = 0 | neutral | ไม่มีผู้ใช้รถ / วันหยุด |
| done ≥ expected | success | ครบแล้ว |
| off day | neutral | วันหยุด |
| future / before open | neutral | ยังไม่ถึงวัน / ยังไม่ถึงเวลา (shows start time) |
| open, nothing yet | neutral | รอเริ่มรอบ |
| open, some done | info (calm blue) | กำลังรับส่ง |
| after due, pending | warn (amber) | ค้าง N คน |
| today after close, pending | **danger** | ยังไม่ยืนยัน N คน |
| past date, pending | warn | ค้าง N คน (a record to check, not an emergency) |

Red is reserved for: emergencies, conflicts, pupils still not confirmed after a
round closed today, expired documents that block service. Never for 0% before a
round, holidays, or counts of "data incomplete" (those are info/warn).

`dayStatus(rounds, { emergencies })` turns round statuses into one headline:
emergency → danger "มีเหตุฉุกเฉิน N รายการ"; else the worst round; else the
round in progress; "รอบเช้าครบแล้ว / รอบเย็นยังไม่ถึงเวลา"; "รับส่งครบทุกคนแล้ว";
"วันนี้เป็นวันหยุด".

Expected counts: after `attendanceStatistics.decorateDaily`, API
`morning_total` / `evening_total` (and `*_expected` rows) **already exclude
self-travel and leave**; `*_registered` is the raw count; `*_pending =
total − done`. Use `expected = morning_total` (or `done + pending`). Do not
subtract `morning_leave` again (SchoolDashboard currently does — area A fix).

## 4. Per role

### A. School / school-wide teacher / grade teacher — `SchoolDashboard.jsx`

Questions: นักเรียนของฉันขึ้นรถ/ถึงโรงเรียนครบไหม? รอบเย็นส่งถึงบ้านครบไหม?
ต้องเช็กชื่อใคร? มีอะไรต้องแก้ (นักเรียนไม่ผูกรถ ผู้ปกครองไม่ครบ คำขอจากคนขับ)?

Hierarchy:
1. Header: school name · affiliation (`/school/dashboard` → `school.name`,
   `school.affiliation_name`, `date`). Grade teacher: the existing scope chip
   (SchoolLayout) + "ชั้น …" in the eyebrow. Primary button "เช็กชื่อวันนี้"
   (`/school/teacher-check`).
2. `StatusHero`: rounds from `morning_done/morning_total`,
   `evening_done/evening_total`; `emergencies` = today's emergencies if known,
   else leave to the ActionList (`recent_emergencies` is 7-day → ActionList
   danger row, not the hero). Action: focus round warn/danger → "เช็กชื่อวันนี้"
   or "ดูรถที่ยังค้าง" (opens vehicle fold).
3. `ActionList`: emergencies 7d (danger, `/school/emergencies`), roster
   requests (warn, `/school/approvals`, hidden for grade teacher), no vehicle
   (warn, `/school/students?has_vehicle=no`), parent data (info,
   `/school/students`), leaves today (info, fold; hidden for grade teacher).
4. `TravelLeaveSummary data={dash}`.
5. Secondary `StatTile`s (calm): students total, vehicles, leave today.
6. Folded: 7-day chart (`useRecentDays`), per-vehicle ranking + list
   (`/school/status-today`), leave list, completeness, override
   ("ยืนยันแทนคนขับ", full-scope only).

Grade teacher: same page, numbers are already grade-scoped by the backend;
hide write-only actions with `isGradeTeacher(user)` exactly as today.

### B. Reports — `reports/*` (all roles)

Questions: วันนี้/เดือนนี้ของขอบเขตฉันเป็นอย่างไร? ที่ไหนค้าง? ส่งออกไฟล์.

- Daily hero: eyebrow "รายงานรายวัน", title = scope name:
  school → `data.schools[0].school_name` when exactly one school, else
  `user.display_name`; affiliation/province/admin → `user.display_name`
  (fallback "ภาพรวมจังหวัด"). Then the date picker.
- Then `StatusHero` with `roundStatus({ session, done: morning_done, expected:
  morning_total, date, conflict: morning_conflict })` — `date` = the report date
  so past days are warn, never red. Replaces `roundsNotStarted` + red tiles.
- "จุดที่ต้องติดตาม" → `ActionList` (pending rounds, `emergency_count`).
- `TravelLeaveSummary` (already moved under the totals), then per-school /
  per-vehicle tables, then export footer.
- Monthly/summary: calm `StatTile`s for KPIs (tone only when below
  threshold `pctTone`), summary box, tables. `TravelLeaveSummary monthly`.
- PDF/print output unchanged unless a label is renamed (then update manual).

### C. Affiliation — `AffiliationDashboard.jsx`, `AffDailyStatus.jsx`

Questions: โรงเรียนในสังกัดเช็กชื่อครบไหม? โรงเรียนไหนต้องโทรตาม? รถไหนเอกสารมีปัญหา?

- Hero: rounds from `morning_done/morning_total`, `evening_done/evening_total`,
  `isSchoolDay: is_school_day`. Headline add-on: "N โรงเรียนยังไม่เช็กชื่อ"
  from `schools_not_complete` (morning_done = 0 and morning_expected > 0) —
  danger only after the morning round closes; before that warn/neutral.
  Action "ดูโรงเรียนที่ต้องติดตาม".
- ActionList rows that explain the action:
  - `vehicles-at-risk` total → "รถต้องแก้เอกสาร · ประกัน/ตรวจสภาพหมดอายุ" →
    vehicles list.
  - `schools_missing_vehicle_data` → "โรงเรียนที่ยังผูกนักเรียนกับรถไม่ครบ ·
    แจ้งโรงเรียนให้ผูกรถ" → `/affiliation/schools` (filtered if supported).
  - `school_not_using_recently` (of `school_total`) → "โรงเรียนที่ยังไม่เริ่มใช้
    ระบบ (14 วัน) · ติดต่อให้เริ่มเช็กชื่อ" → schools list. Tone info, not red.
  Show "N จาก school_total โรงเรียน" in the sub so the size is clear.
- Calm tiles: schools using (`school_used_recently / school_total`),
  students, vehicles, emergencies 7d (warn/danger only if > 0).
- AffDailyStatus: hero per round for the whole affiliation, then the school
  list with per-school `RoundProgress`-style pills; `TravelLeaveSummary` stays
  under the header.

### D. Province — `ProvinceDashboard.jsx`, `ProvDailyStatus.jsx`; Admin — `AdminDashboard.jsx`

Province questions: ทั้งจังหวัดวันนี้เป็นอย่างไร? สังกัดไหนต้องติดตาม? ระบบติดตามรถ
ทำงานไหม?
- Hero from `/province/dashboard` round totals; ActionList: emergencies
  (`/province/emergencies`), at-risk vehicles, affiliations below threshold
  (from `affiliations[].morning_kpi`), vehicles offline (`vehicle_stale`,
  `vehicle_no_location`) as info.
- Scale tiles (calm): students, schools, affiliations, vehicles.
- Folded: trend, per-affiliation ranking, live tracking detail.

Admin questions: มีงานรออนุมัติ/ผู้ใช้ต้องจัดการไหม? ระบบโดยรวมปกติไหม?
- ActionList first (pending requests, users needing action, roster requests,
  deletions yesterday) — admin acts on these; hero is a compact province
  round summary (same helper).

## 5. Mobile (390px) and desktop (1366px)

- One column on phones; hero round cards stack; `StatGrid` is 2 columns.
- Numbers ≥ `text-3xl` for the main figure; labels ≥ `text-sm`.
- Tap targets ≥ 44px (ActionList rows are 64px, whole row is the link).
- No horizontal scroll: long school names wrap (`text-pretty`, `min-w-0`).
- Desktop: hero rounds side by side; ActionList full width; detail in two
  columns where it already is.

## 6. Shared components (`frontend/src/components/dashboard`, foundation-owned)

```js
import { StatusHero, RoundProgress, ActionList, StatTile, StatGrid, SectionCard,
  TravelLeaveSummary, roundStatus, dayStatus, roundPhase } from '../../components/dashboard';
```

- `roundStatus({ session, done, expected, date?, now?, isSchoolDay?, conflict?, unavailable? })`
  → `{ session, state, tone, label, detail, done, expected, pending, pct, phase }`
- `dayStatus(statuses, { emergencies? })` → `{ tone, headline, sub, focus }`
- `roundPhase(session, { date?, now?, isSchoolDay? })`, `isWeekend(date)`,
  `bangkokClock(now)`, `ROUND_TIMES`, `SESSION_LABEL`.
- `<StatusHero rounds={[{ status, to?, title? }]} day? emergencies? action?={label,to|onClick} eyebrow? loading? />`
- `<RoundProgress status to? title? />`
- `<ActionList title? items={[{ key, tone, count, title, sub, to|onClick, actionLabel?, keepZero?, unavailable? }]} max? hideWhenEmpty? afterAlert? emptyText? />`
- `<StatTile label value unit? sub? tone?='calm'|'success'|'warn'|'danger'|'info' icon? to? unavailable? />`, `<StatGrid cols? label?>`
- `<SectionCard title sub? action? empty? hideWhenEmpty?=true emptyText? collapsible? defaultOpen?>`
- `<TravelLeaveSummary data monthly? defaultOpen? className? />`, `isTravelLeaveEmpty(data)`

Tests: `frontend/tests/dashboardRoundStatus.test.mjs` (in `npm run test:readiness`).

## 7. File ownership (no two agents edit the same file)

| Owner | Files |
|---|---|
| Foundation (this PR) | `frontend/src/components/dashboard/**`, `frontend/src/components/AttendanceBreakdown.jsx`, `frontend/tests/dashboardRoundStatus.test.mjs`, `docs/design/dashboard-redesign.md`, `frontend/package.json` (scripts) |
| **A** school | `frontend/src/pages/school/SchoolDashboard.jsx`; manual: `docs/manual-html/user-guide-school.html`, `docs/manual-html/user-guide-teacher.html` (dashboard sections only) |
| **B** reports | `frontend/src/pages/reports/DailyReport.jsx`, `MonthlyReport.jsx`, `SummaryReport.jsx`, `PolicyReport.jsx`, `ReportsLayout.jsx`, `frontend/src/utils/reportRounds.js`; backend report changes if any (`backend/src/routes/report.routes.js`, `backend/src/services/report.service.js` + tests); manual: report sections of any `docs/manual-html/*.html` — coordinate by editing only the report section text |
| **C** affiliation | `frontend/src/pages/affiliation/AffiliationDashboard.jsx`, `frontend/src/pages/affiliation/AffDailyStatus.jsx`; manual: `docs/manual-html/user-guide-affiliation.html` (non-report sections) |
| **D** province + admin | `frontend/src/pages/province/ProvinceDashboard.jsx`, `frontend/src/pages/province/ProvDailyStatus.jsx`, `frontend/src/pages/admin/AdminDashboard.jsx`; manual: `docs/manual-html/user-guide-province.html`, `docs/manual-html/user-guide-admin.html` (non-report sections) |

Shared files nobody edits in this effort: `components/ui/*`, `Layout.jsx`,
`Sidebar.jsx`, `TopNavbar.jsx`, `constants/uiLabels.js` (add page-local
constants instead), all backend files except B's report files.
If a manual HTML file is shared (e.g. affiliation guide has a report section),
B edits only the report paragraphs and C/D only their dashboard paragraphs;
resolve text conflicts by keeping both edits.
