# Implementation Roadmap: Evidence-to-System Mapping
# ระบบรถรับส่งนักเรียนจังหวัดลำปาง

**วันที่:** เมษายน 2569  
**วัตถุประสงค์:** เชื่อม metric ในกรอบประเมินเข้ากับ implementation จริง

---

## C) สิ่งที่ระบบเก็บได้แล้ว

| Evidence Source | Table | Records | Usable For |
|----------------|-------|---------|------------|
| Login events | `audit_logs` (action=LOGIN) | 195 | Login frequency, active rate, login timing |
| Check-in actions | `checkin_logs` + `daily_status` | 66 each | Daily completion, timing, consistency |
| Student data changes | `audit_logs` (UPDATE student) | 6 | Correction rate |
| Import events | `audit_logs` (IMPORT) | 2 | Import timeliness |
| Vehicle inspections | `vehicle_inspections` | 4 | Inspection coverage, pass rate |
| Leave records | `student_leaves` | 8 | Leave patterns, cancel rate |
| User management | `audit_logs` (CREATE/UPDATE/DELETE user) | 13 | Password resets, account lifecycle |
| LINE interactions | `line_message_logs` | 43 | Parent engagement |
| Emergency incidents | `emergency_logs` | 0 | Incident tracking (structure exists) |

### Audit log action enum (7 types):
`CREATE`, `UPDATE`, `DELETE`, `EXPORT`, `LOGIN`, `IMPORT`, `APPROVE`

### What's NOT logged today:
- Dashboard page views
- Report export downloads
- Alert/notification views
- Follow-up actions on pending items
- Session duration
- Phone call clicks
- Risk case lifecycle
- Meeting references

---

## D) Metric-to-Evidence Mapping (All 24 Metrics)

### Province (PR) — 4 metrics

| # | Metric | Type | Current Support | Data Source | Gap | Priority |
|---|--------|------|-----------------|------------|-----|----------|
| PR-1 | Dashboard before meeting | Effectiveness | ❌ missing | Need: dashboard_view event + meeting reference | Add `VIEW` action type to audit_logs + frontend event | P2 |
| PR-2 | Proactive awareness rate | Effectiveness | ❌ missing | Need: timeline correlation dashboard_view vs emergency_logs | Add dashboard_view event + baseline data | P2 |
| PR-3 | Evidence-based policy actions | Effectiveness | ❌ external | Source: meeting minutes + interview | External instrument only — no system change needed | P3 |
| PR-4 | Report engagement duration | Effectiveness | ❌ missing | Need: session duration tracking | Add frontend page-time tracker | P3 |

### Affiliation (AF) — 4 metrics

| # | Metric | Type | Current Support | Data Source | Gap | Priority |
|---|--------|------|-----------------|------------|-----|----------|
| AF-1 | Proactive detection rate | Effectiveness | ❌ missing | Need: dashboard_view timestamp vs emergency timestamp | Add dashboard_view event | P2 |
| AF-2 | Alert-to-view latency | Effectiveness | ❌ missing | Need: alert_view event | Add frontend event when viewing alert block | P2 |
| AF-3 | Proactive follow-up actions | Effectiveness | ❌ external | Need: follow-up action button + event | Add button + audit event | P2 |
| AF-4 | Pending school follow-up rate | Effectiveness | ❌ missing | Need: acknowledgment event | Add "ติดตาม" button + event | P2 |

### School (SC) — 4 metrics

| # | Metric | Type | Current Support | Data Source | Gap | Priority |
|---|--------|------|-----------------|------------|-----|----------|
| SC-1 | Data completeness rate | Efficiency | ✅ ready | `students` table: vehicle_id, parent fields | Compute from existing data | P1 |
| SC-2 | Timeliness of data entry | Efficiency | ✅ ready | `audit_logs` IMPORT timestamp vs term start | Compute from existing data | P1 |
| SC-3 | Correction rate | Efficiency | ✅ ready | `audit_logs` UPDATE student / total imported | Compute from existing data | P1 |
| SC-4 | Work burden reduction | Efficiency | ❌ external | Source: pre/post questionnaire | External instrument only | P3 |

### Driver (DR) — 4 metrics

| # | Metric | Type | Current Support | Data Source | Gap | Priority |
|---|--------|------|-----------------|------------|-----|----------|
| DR-1 | Pre-departure check-in rate | Both | ✅ ready | `daily_status.morning_ts` timing | Compute: morning_ts before departure time | P1 |
| DR-2 | Completion consistency | Efficiency | ✅ ready | `daily_status` per vehicle per date | Compute: days with 100% completion / total days | P1 |
| DR-3 | Usage continuity (streak) | Efficiency | ✅ ready | `checkin_logs` / `daily_status` | Compute: max consecutive dates per driver | P1 |
| DR-4 | UX satisfaction | Efficiency | ❌ external | Source: usability questionnaire | External instrument only | P3 |

### Transport (TR) — 4 metrics

| # | Metric | Type | Current Support | Data Source | Gap | Priority |
|---|--------|------|-----------------|------------|-----|----------|
| TR-1 | Risk closure within SLA | Effectiveness | ⚠️ partial | `vehicle_inspections` — no lifecycle tracking | Need: `risk_cases` table | P2 |
| TR-2 | Non-recurrence rate | Effectiveness | ⚠️ partial | `vehicle_inspections` — can detect PASSED→FAILED pattern | Compute from sequential inspections | P2 |
| TR-3 | Unresolved risk volume | Effectiveness | ✅ ready | `vehicles` + `vehicle_inspections` | Compute: latest result ≠ PASSED or no insurance | P1 |
| TR-4 | Time-to-close risk | Effectiveness | ⚠️ partial | Need: opened_at → resolved_at | Need: `risk_cases` table | P2 |

### Admin (AD) — 4 metrics

| # | Metric | Type | Current Support | Data Source | Gap | Priority |
|---|--------|------|-----------------|------------|-----|----------|
| AD-1 | Active account rate | Efficiency | ✅ ready | `users.is_active` + `last_login` | Compute from existing data | P1 |
| AD-2 | Password reset frequency | Efficiency | ✅ ready | `audit_logs` reset_password events | Count per month | P1 |
| AD-3 | Onboarding issue rate | Efficiency | ❌ external | Need: support log or interview | External instrument | P3 |
| AD-4 | Data health score | Efficiency | ⚠️ partial | Multiple tables | Need: computation logic | P1 |

---

## E) Proposed System Additions

### E1. New audit_logs action type: `VIEW`

**Purpose:** Track meaningful dashboard/report views  
**Current enum:** `CREATE, UPDATE, DELETE, EXPORT, LOGIN, IMPORT, APPROVE`  
**Proposed addition:** `VIEW`

```sql
ALTER TABLE audit_logs MODIFY COLUMN action 
  ENUM('CREATE','UPDATE','DELETE','EXPORT','LOGIN','IMPORT','APPROVE','VIEW');
```

**Usage points:**
| Event | Page/Component | entity_type | entity_id |
|-------|---------------|-------------|-----------|
| Open dashboard | Province/Aff/School dashboard | `dashboard_view` | role name |
| View alert block | Dashboard alert section | `alert_view` | role name |
| View report | DailyReport/MonthlyReport | `report_view` | date |
| Export report | ExportButtons click | `report_export` | format |

**Metrics enabled:** PR-1, PR-2, PR-4, AF-1, AF-2

### E2. New table: `risk_cases` (Transport risk lifecycle)

```sql
CREATE TABLE risk_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id VARCHAR(20) NOT NULL,
  risk_type ENUM('no_inspection','failed_inspection','expired_insurance','no_insurance') NOT NULL,
  status ENUM('OPEN','IN_PROGRESS','RESOLVED','DISMISSED') DEFAULT 'OPEN',
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  due_at DATE NULL,
  resolved_at TIMESTAMP NULL,
  resolved_by INT NULL,
  resolution_note TEXT NULL,
  recurrence_of INT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  INDEX idx_status (status),
  INDEX idx_vehicle (vehicle_id)
);
```

**Metrics enabled:** TR-1, TR-2, TR-4

### E3. New table: `daily_snapshots` (Data completeness tracking)

```sql
CREATE TABLE daily_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  scope_type ENUM('system','school','affiliation') NOT NULL,
  scope_id VARCHAR(20) NULL,
  total_students INT DEFAULT 0,
  students_with_vehicle INT DEFAULT 0,
  students_with_parent INT DEFAULT 0,
  vehicles_with_insurance INT DEFAULT 0,
  vehicles_inspected INT DEFAULT 0,
  morning_completion_pct DECIMAL(5,2) DEFAULT 0,
  evening_completion_pct DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_date_scope (snapshot_date, scope_type, scope_id)
);
```

**Metrics enabled:** SC-1 (trend), AD-4, dashboard comparisons

### E4. Frontend VIEW events (minimal code)

Add to each dashboard page's `useEffect`:

```javascript
// In ProvinceDashboard, AffiliationDashboard, SchoolDashboard, TransportDashboard
useEffect(() => {
  api.post('/audit/view', { entity_type: 'dashboard_view', entity_id: 'province' }).catch(() => {});
}, []);
```

Backend endpoint (add to existing audit or admin routes):

```javascript
router.post('/view', authenticate, async (req, res) => {
  const { entity_type, entity_id } = req.body;
  await logAudit({ userId: req.user.id, action: 'VIEW', entityType: entity_type, entityId: entity_id, ipAddress: req.ip });
  res.json({ success: true });
});
```

**Requires:** Adding `VIEW` to audit_logs action enum first.

### E5. Research Export endpoint

```
GET /api/admin/research-export?from=2026-01-01&to=2026-04-30
```

Returns anonymized CSV/JSON:
- audit_logs (user_id → hashed, no IP)
- daily_status aggregates
- vehicle_inspections
- risk_cases (if exists)
- daily_snapshots (if exists)

**Metrics enabled:** All — provides raw data for researcher analysis

---

## F) Prioritized Implementation Roadmap

### Phase 1: Quick Wins (1-2 days, no schema changes needed)

| # | Task | Effort | Metrics Enabled | Layer |
|---|------|--------|-----------------|-------|
| 1.1 | Compute SC-1 (data completeness) from existing students table | 2h | SC-1 | Backend query |
| 1.2 | Compute SC-2 (timeliness) from audit_logs IMPORT timestamps | 1h | SC-2 | Backend query |
| 1.3 | Compute SC-3 (correction rate) from audit_logs UPDATE/IMPORT ratio | 1h | SC-3 | Backend query |
| 1.4 | Compute DR-1, DR-2, DR-3 from daily_status/checkin_logs | 2h | DR-1,2,3 | Backend query |
| 1.5 | Compute AD-1 (active rate) from users table | 30min | AD-1 | Backend query |
| 1.6 | Compute AD-2 (reset frequency) from audit_logs | 30min | AD-2 | Backend query |
| 1.7 | Compute TR-3 (unresolved risk) from vehicles+inspections | 1h | TR-3 | Backend query |

**Total Phase 1:** 9 metrics measurable, ~8 hours work, zero schema changes

### Phase 2: Evidence Collection Layer (3-5 days)

| # | Task | Effort | Metrics Enabled | Layer |
|---|------|--------|-----------------|-------|
| 2.1 | Add `VIEW` to audit_logs action enum | 30min | Foundation | DB migration |
| 2.2 | Add dashboard view events (4 dashboards) | 2h | PR-1, AF-1 | Frontend + backend |
| 2.3 | Add report view/export events | 1h | PR-4 | Frontend |
| 2.4 | Create `daily_snapshots` table + cron job | 4h | SC-1 trend, AD-4 | DB + backend |
| 2.5 | Create `risk_cases` table + auto-open logic | 4h | TR-1, TR-4 | DB + backend |
| 2.6 | Add follow-up buttons (affiliation dashboard) | 2h | AF-3, AF-4 | Frontend + backend |
| 2.7 | Add AD-4 data health score computation | 2h | AD-4 | Backend |

**Total Phase 2:** 6 additional metrics, ~15 hours, 2 new tables + 1 enum change

### Phase 3: Research & Evaluation Layer (5-7 days)

| # | Task | Effort | Metrics Enabled | Layer |
|---|------|--------|-----------------|-------|
| 3.1 | Research export endpoint (anonymized CSV) | 4h | All metrics | Backend |
| 3.2 | Baseline snapshot tool | 2h | All baseline comparisons | Backend |
| 3.3 | Evaluation dashboard (admin-only) | 8h | Visual comparison | Frontend |
| 3.4 | Dashboard comparison text (vs yesterday/last week) | 4h | Context for all KPIs | Frontend |
| 3.5 | External instrument integration points | 2h | PR-3, SC-4, DR-4, AD-3 | Documentation |
| 3.6 | Risk case lifecycle UI (transport) | 6h | TR-1, TR-2, TR-4 | Frontend |

**Total Phase 3:** Remaining metrics + research tools, ~26 hours

---

## Summary: Readiness After Each Phase

| Phase | Metrics Ready | Metrics Partial | Metrics Missing | Metrics External |
|-------|--------------|-----------------|-----------------|-----------------|
| **Current** | 9/24 (38%) | 4/24 (17%) | 6/24 (25%) | 5/24 (21%) |
| **After Phase 1** | 9/24 (38%) | 4/24 | 6/24 | 5/24 |
| **After Phase 2** | 15/24 (63%) | 3/24 | 1/24 | 5/24 |
| **After Phase 3** | 18/24 (75%) | 1/24 | 0/24 | 5/24 |

*Note: 5 metrics (21%) permanently require external instruments (questionnaires, meeting minutes, interviews) — these cannot be automated.*

---

## G) Minimum Viable Measurement Upgrade

**Recommended first action:** Phase 1 (Quick Wins)

**Why:** 9 metrics become measurable immediately with zero schema changes — just add computation queries to existing data. This gives researchers a baseline dataset from day one.

**Specific first implementation:**
1. Create `/api/admin/research-metrics` endpoint that computes all Phase 1 metrics from existing tables
2. Return JSON with per-role KPI snapshots
3. Admin can access via dashboard or export

**This single endpoint would provide:**
- School: completeness %, timeliness, correction rate
- Driver: check-in rate, consistency, streak
- Transport: unresolved risk count
- Admin: active rate, reset frequency

**Effort: ~1 day. Impact: 38% of all metrics immediately measurable.**

---

*เอกสารนี้จัดทำเพื่อใช้เป็นแผนเชิงเทคนิคสำหรับการเชื่อมระบบกับงานวิจัย — เมษายน 2569*
