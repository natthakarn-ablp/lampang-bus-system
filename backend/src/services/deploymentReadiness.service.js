'use strict';

/**
 * Deployment Readiness Service (spec §6.2 / §6.3)
 * ------------------------------------------------------------------
 * Computes an AGGREGATE readiness report for province/admin so operators
 * can see what data still has to be filled and certified before the
 * province moves from OBSERVE → ENFORCE.
 *
 * HARD RULE — NO PII. Every value this module returns is a COUNT or a
 * status label. It never selects, returns, or logs a student/parent/driver
 * name, phone number, CID, license number, or any other personal field.
 * (See deploymentReadiness.unit.test.js for the negative assertion.)
 *
 * Design notes:
 *   - `getDeploymentReadiness(pool, opts)` is the single aggregation entry
 *     point. It is pure with respect to the injected `pool`, so the unit
 *     test passes a mock pool that dispatches by SQL shape.
 *   - All queries are parameterized (the only interpolation is the trusted
 *     literal CURDATE()); no caller input is concatenated into SQL.
 *   - "Unknown is not safe" (design §3.2): a vehicle/driver with missing or
 *     unverified data is counted as NOT ready — never folded into "ready".
 */

// ── Verification-status buckets the UI renders (spec §6.3) ───────────────────
//   พร้อมใช้งาน / ต้องเติมข้อมูล / มีข้อมูลเสี่ยง / ถูกระงับ
// EXPIRING is "ready but watch" → grouped under READY with a warning flag so
// it is never shown as a plain green "passed" without the expiry caveat.
const VEHICLE_STATUS_BUCKET = {
  ELIGIBLE: 'ready',
  EXPIRING: 'ready',
  UNVERIFIED: 'needs_data',
  INELIGIBLE: 'at_risk',
  SUSPENDED: 'suspended',
};

const BUCKET_LABELS_TH = {
  ready: 'พร้อมใช้งาน',
  needs_data: 'ต้องเติมข้อมูล',
  at_risk: 'มีข้อมูลเสี่ยง',
  suspended: 'ถูกระงับ',
};

/**
 * Coerce a possibly-string COUNT() result to a non-negative integer.
 * mysql2 returns COUNT()/SUM() as number|string|null depending on type.
 */
function n(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : 0;
}

/**
 * Build a {total, ready, missing, pct} section summary.
 */
function section(total, ready, extra = {}) {
  const t = n(total);
  const r = Math.min(n(ready), t);
  return {
    total: t,
    ready: r,
    missing: Math.max(0, t - r),
    pct: t ? Math.round((r / t) * 100) : 100,
    ...extra,
  };
}

/**
 * Compute the aggregate deployment-readiness report.
 *
 * @param {{query: Function}} pool  - mysql2 pool (or a mock with .query)
 * @param {{mode?: string}} [opts]  - safety policy mode for context only
 * @returns {Promise<object>} aggregate report — counts + labels only, no PII
 */
async function getDeploymentReadiness(pool, opts = {}) {
  const mode = String(opts.mode || 'OBSERVE').toUpperCase();

  // ── Vehicles: total, by verification_status, with capacity, with valid
  // inspection (latest PASSED and not expired), with valid documents. ───────
  const [vehicleRows] = await pool.query(
    `SELECT
        COUNT(*) AS total,
        SUM(verification_status = 'ELIGIBLE')   AS status_eligible,
        SUM(verification_status = 'EXPIRING')   AS status_expiring,
        SUM(verification_status = 'UNVERIFIED') AS status_unverified,
        SUM(verification_status = 'INELIGIBLE') AS status_ineligible,
        SUM(verification_status = 'SUSPENDED')  AS status_suspended,
        SUM(certified_capacity IS NOT NULL)     AS with_capacity,
        SUM(
          insurance_expiry IS NOT NULL   AND insurance_expiry   >= CURDATE() AND
          registration_expiry IS NOT NULL AND registration_expiry >= CURDATE() AND
          compulsory_insurance_expiry IS NOT NULL AND compulsory_insurance_expiry >= CURDATE() AND
          tax_expiry IS NOT NULL AND tax_expiry >= CURDATE()
        ) AS with_valid_documents
      FROM vehicles
     WHERE COALESCE(is_deleted, 0) = 0`
  );
  const v = vehicleRows[0] || {};

  // Latest inspection per vehicle is PASSED and not expired (today or future).
  const [inspectionRows] = await pool.query(
    `SELECT COUNT(*) AS with_passed_inspection
       FROM vehicles ve
       JOIN vehicle_inspections vi
         ON vi.vehicle_id = ve.id
      WHERE COALESCE(ve.is_deleted, 0) = 0
        AND vi.id = (
          SELECT vi2.id FROM vehicle_inspections vi2
           WHERE vi2.vehicle_id = ve.id
           ORDER BY vi2.inspection_date DESC, vi2.id DESC
           LIMIT 1
        )
        AND vi.result = 'PASSED'
        AND (vi.expiry_date IS NULL OR vi.expiry_date >= CURDATE())`
  );
  const insp = inspectionRows[0] || {};

  // ── Driver accounts: active driver-role users, linked vs not, and those
  // with a VERIFIED + in-date qualification. ────────────────────────────────
  const [driverRows] = await pool.query(
    `SELECT
        COUNT(*) AS total,
        SUM(u.driver_id IS NOT NULL) AS linked,
        SUM(u.driver_id IS NULL)     AS unlinked,
        SUM(
          u.driver_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM driver_qualifications q
             WHERE q.driver_id = u.driver_id
               AND q.is_current = 1
               AND q.qualification_status = 'VERIFIED'
               AND q.license_expiry >= CURDATE()
          )
        ) AS with_verified_qualification
      FROM users u
     WHERE u.role = 'driver'
       AND u.is_active = 1
       AND COALESCE(u.is_deleted, 0) = 0`
  );
  const d = driverRows[0] || {};

  // ── Vehicles with at least one AUTHORIZED active driver assignment, plus
  // backup-driver coverage (warning metric, not a hard gate — design §12). ──
  const [assignmentRows] = await pool.query(
    `SELECT
        COUNT(DISTINCT ve.id) AS total,
        COUNT(DISTINCT CASE WHEN dva.id IS NOT NULL THEN ve.id END) AS with_authorized_driver,
        COUNT(DISTINCT CASE WHEN dva.assignment_role = 'BACKUP' THEN ve.id END) AS with_backup_driver
       FROM vehicles ve
       LEFT JOIN driver_vehicle_assignments dva
         ON dva.vehicle_id = ve.id
        AND dva.is_active = 1
        AND dva.authorization_status = 'AUTHORIZED'
      WHERE COALESCE(ve.is_deleted, 0) = 0`
  );
  const a = assignmentRows[0] || {};

  // ── Build vehicle status buckets (spec §6.3) ─────────────────────────────
  const vehicleStatusCounts = {
    ELIGIBLE: n(v.status_eligible),
    EXPIRING: n(v.status_expiring),
    UNVERIFIED: n(v.status_unverified),
    INELIGIBLE: n(v.status_ineligible),
    SUSPENDED: n(v.status_suspended),
  };
  const buckets = { ready: 0, needs_data: 0, at_risk: 0, suspended: 0 };
  for (const [status, count] of Object.entries(vehicleStatusCounts)) {
    buckets[VEHICLE_STATUS_BUCKET[status]] += count;
  }

  const vehicleTotal = n(v.total);
  const driverTotal = n(d.total);
  const assignmentTotal = n(a.total);

  const sections = {
    vehicles: section(vehicleTotal, buckets.ready, {
      with_capacity: n(v.with_capacity),
      with_passed_inspection: n(insp.with_passed_inspection),
      with_valid_documents: n(v.with_valid_documents),
      by_status: vehicleStatusCounts,
    }),
    drivers: section(driverTotal, n(d.with_verified_qualification), {
      linked: n(d.linked),
      unlinked: n(d.unlinked),
      with_verified_qualification: n(d.with_verified_qualification),
    }),
    assignments: section(assignmentTotal, n(a.with_authorized_driver), {
      with_authorized_driver: n(a.with_authorized_driver),
      with_backup_driver: n(a.with_backup_driver),
      without_backup_driver: Math.max(0, assignmentTotal - n(a.with_backup_driver)),
    }),
  };

  // ── Readiness buckets summary for the four UI cards ──────────────────────
  const status_buckets = Object.entries(buckets).map(([key, count]) => ({
    key,
    label_th: BUCKET_LABELS_TH[key],
    count,
  }));

  // ── Gaps: each is an actionable item with owner + Thai next action.
  // Counts only. Backup-driver coverage is a WARNING, not a hard gate. ──────
  const gaps = [];
  const addGap = (key, label_th, owner_role, count, next_action_th, hard_gate = true) => {
    if (count > 0) gaps.push({ key, label_th, owner_role, count, next_action_th, hard_gate });
  };

  addGap(
    'vehicle_capacity_missing',
    'รถยังไม่มีความจุรับรอง',
    'school',
    Math.max(0, vehicleTotal - n(v.with_capacity)),
    'โรงเรียนกรอกความจุรับรองของรถ'
  );
  addGap(
    'vehicle_inspection_missing',
    'รถยังไม่มีผลตรวจที่ผ่านและไม่หมดอายุ',
    'transport',
    Math.max(0, vehicleTotal - n(insp.with_passed_inspection)),
    'ขนส่งตรวจรถและรับรองผลตรวจ'
  );
  addGap(
    'vehicle_documents_invalid',
    'รถมีเอกสารหมดอายุหรือยังไม่กรอก',
    'school',
    Math.max(0, vehicleTotal - n(v.with_valid_documents)),
    'โรงเรียนปรับปรุงประกัน ทะเบียน พ.ร.บ. และภาษีให้เป็นปัจจุบัน'
  );
  addGap(
    'vehicle_suspended',
    'รถถูกระงับใช้งาน',
    'transport',
    vehicleStatusCounts.SUSPENDED,
    'ขนส่งตรวจสอบเหตุที่รถถูกระงับและแก้ไข'
  );
  addGap(
    'driver_account_unlinked',
    'บัญชีคนขับยังไม่ผูกโปรไฟล์คนขับ',
    'province',
    n(d.unlinked),
    'จังหวัดผูกบัญชีคนขับกับโปรไฟล์คนขับ'
  );
  addGap(
    'driver_qualification_missing',
    'คนขับยังไม่มีใบอนุญาตที่รับรองและไม่หมดอายุ',
    'transport',
    Math.max(0, driverTotal - n(d.with_verified_qualification)),
    'ขนส่งรับรองใบอนุญาตคนขับ'
  );
  addGap(
    'vehicle_no_authorized_driver',
    'รถยังไม่มีคนขับที่ได้รับอนุญาต',
    'transport',
    Math.max(0, assignmentTotal - n(a.with_authorized_driver)),
    'ขนส่งมอบหมายและรับรองคนขับให้รถ'
  );
  // Warning-only metric — resilience target, NOT a deploy hard gate (design §12).
  addGap(
    'vehicle_no_backup_driver',
    'รถยังไม่มีคนขับสำรอง',
    'transport',
    Math.max(0, assignmentTotal - n(a.with_backup_driver)),
    'แนะนำให้ขนส่งจัดคนขับสำรองเพิ่มความยืดหยุ่น',
    false
  );

  const hard_gate_count = gaps
    .filter((g) => g.hard_gate)
    .reduce((sum, g) => sum + g.count, 0);
  const warning_count = gaps
    .filter((g) => !g.hard_gate)
    .reduce((sum, g) => sum + g.count, 0);

  return {
    policy_mode: mode,
    generated_at: new Date().toISOString(),
    scope: 'province',
    sections,
    status_buckets,
    gaps,
    hard_gate_count,
    warning_count,
  };
}

module.exports = {
  getDeploymentReadiness,
  // Exposed for unit testing the pure helpers.
  section,
  VEHICLE_STATUS_BUCKET,
  BUCKET_LABELS_TH,
};
