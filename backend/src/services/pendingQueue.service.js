'use strict';

/**
 * pendingQueue.service.js — "what is waiting for me" for every approver role
 * (owner request 2026-11-13: the site must run without the admin chasing
 * every request by hand).
 *
 * One definition per queue: which rows are waiting, who decides them, and who
 * is told when they sit too long. Two consumers:
 *   - GET /api/<role>/pending-summary  (badge + "งานรออนุมัติ" page)
 *   - backend/scripts/pending-queue-alert.js (cron) which records, ONCE per
 *     item, an in-app alert for the approver after OVERDUE days and for the
 *     level above after ESCALATE days.
 *
 * In-app alerts are audit_logs rows (entity_type 'pending_alert', entity_id =
 * the dedupe key) — the same no-migration pattern as gps_stale_alert and
 * school_notification. The `notifications` table is NOT used: it is the LINE
 * outbox (target_line_user_id, no staff recipient column), and nothing here may
 * reach LINE.
 *
 * No student names, phones or ids leave this module: titles carry the request
 * type, plate and school names only, so the same rows can be shown to the
 * level above.
 */

const env = require('../config/env');
const { logAudit } = require('../utils/audit');

const ALERT_ENTITY = 'pending_alert';
const DAY_S = 86400;

function intEnv(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function thresholds() {
  const overdueDays = intEnv('PENDING_OVERDUE_DAYS', 3);
  const escalateDays = Math.max(intEnv('PENDING_ESCALATE_DAYS', 7), overdueDays);
  return { overdueDays, escalateDays };
}

const VEHICLE_REQUEST_LABEL = {
  RESTORE_SOFT_DELETED_VEHICLE: 'ขอกู้คืนรถ',
  USE_EXISTING_SHARED_VEHICLE: 'ขอใช้รถร่วม',
  ADD_MISSING_VEHICLE: 'ขอเพิ่มรถ',
  REVIEW_VEHICLE_CONFLICT: 'ขอตรวจทะเบียนซ้ำ',
};

const DOC_LABEL = {
  VEHICLE_REGISTRATION: 'สำเนาทะเบียนรถ',
  COMPULSORY_INSURANCE: 'พ.ร.บ.',
  TAX: 'ภาษีรถ',
  INSURANCE: 'ประกันภัย',
  DRIVER_LICENCE: 'ใบขับขี่',
  OTHER: 'เอกสารอื่น',
  VEHICLE_PHOTO: 'รูปถ่ายรถ',
  ID_CARD: 'สำเนาบัตรประชาชน',
};

/**
 * Every query returns: item_id, age_s, school_id, school_name, affiliation_id
 * plus the columns its title() reads. `approver` is the level that decides;
 * `escalate` is who hears about it after ESCALATE days.
 */
const QUEUES = [
  {
    key: 'transfer_incoming',
    code: 'TI',
    label: 'คำขอรับนักเรียนย้ายเข้า (ต่างสังกัด)',
    approver: 'school',
    escalate: 'affiliation',
    link: { school: '/school/transfer-requests', admin: '/admin/transfer-requests' },
    // Cross-affiliation transfers are decided by the destination school
    // (studentTransfer.service isCrossAffiliation: NULL = NULL is "same").
    sql: `SELECT CAST(q.id AS CHAR) AS item_id, TIMESTAMPDIFF(SECOND, q.created_at, NOW()) AS age_s,
                 q.destination_school_id AS school_id, ds.name AS school_name, ds.affiliation_id,
                 ss.name AS from_school
            FROM student_transfer_requests q
            LEFT JOIN schools ss ON ss.id = q.source_school_id
            LEFT JOIN schools ds ON ds.id = q.destination_school_id
           WHERE q.status = 'PENDING' AND NOT (ss.affiliation_id <=> ds.affiliation_id)`,
    title: (r) => `ย้ายเข้าจาก ${r.from_school || 'โรงเรียนอื่น'}`,
  },
  {
    key: 'roster_requests',
    code: 'RR',
    label: 'คำขอปรับรายชื่อนักเรียนบนรถ (จากคนขับ)',
    approver: 'school',
    escalate: 'affiliation',
    link: { school: '/school/approvals', admin: '/admin' },
    sql: `SELECT CAST(r.id AS CHAR) AS item_id, TIMESTAMPDIFF(SECOND, r.created_at, NOW()) AS age_s,
                 r.school_id, sc.name AS school_name, sc.affiliation_id,
                 r.request_type, v.plate_no
            FROM roster_change_requests r
            JOIN schools sc ON sc.id = r.school_id
            LEFT JOIN vehicles v ON v.id = r.vehicle_id
           WHERE r.status = 'pending'`,
    title: (r) => `${r.request_type === 'remove' ? 'ขอนำนักเรียนออก' : 'ขอเพิ่มนักเรียน'} · รถ ${r.plate_no || '-'}`,
  },
  {
    key: 'registration_review',
    code: 'RG',
    label: 'คำขอขึ้นทะเบียนรถจากคนขับ',
    approver: 'school',
    escalate: 'affiliation',
    flag: () => env.features.driverRegistration,
    link: { school: '/school/registration-review' },
    // Only rosters a driver submitted (school-created applications also get an
    // aps row that defaults to PENDING_SCHOOL_REVIEW, but nobody is waiting on
    // it). Age counts from the latest roster change, because adding a child
    // re-opens an approved slice.
    sql: `SELECT CONCAT(a.id, ':', aps.school_id) AS item_id,
                 TIMESTAMPDIFF(SECOND, COALESCE(
                   (SELECT MAX(rr.created_at) FROM registration_roster_students rr
                     WHERE rr.application_id = a.id AND rr.school_id = aps.school_id),
                   aps.created_at), NOW()) AS age_s,
                 aps.school_id, sc.name AS school_name, sc.affiliation_id, v.plate_no
            FROM inspection_application_schools aps
            JOIN vehicle_inspection_applications a ON a.id = aps.application_id
            JOIN schools sc ON sc.id = aps.school_id
            JOIN vehicles v ON v.id = a.vehicle_id
           WHERE aps.approval_status = 'PENDING_SCHOOL_REVIEW'
             AND aps.submitted_by_driver IS NOT NULL
             AND a.status NOT IN ('CANCELLED','SUPERSEDED','EXPIRED')`,
    title: (r) => `ขึ้นทะเบียนรถ ${r.plate_no || '-'}`,
  },
  {
    key: 'transfer_internal',
    code: 'TA',
    label: 'คำขอโอนย้ายนักเรียนในสังกัด',
    approver: 'affiliation',
    escalate: 'province',
    link: { affiliation: '/affiliation/transfer-requests', admin: '/admin/transfer-requests' },
    sql: `SELECT CAST(q.id AS CHAR) AS item_id, TIMESTAMPDIFF(SECOND, q.created_at, NOW()) AS age_s,
                 q.source_school_id AS school_id, ss.name AS school_name, ds.affiliation_id,
                 ds.name AS to_school
            FROM student_transfer_requests q
            LEFT JOIN schools ss ON ss.id = q.source_school_id
            LEFT JOIN schools ds ON ds.id = q.destination_school_id
           WHERE q.status = 'PENDING' AND ss.affiliation_id <=> ds.affiliation_id`,
    title: (r) => `โอนย้าย ${r.school_name || '-'} → ${r.to_school || '-'}`,
  },
  {
    key: 'vehicle_requests',
    code: 'VR',
    label: 'คำขอเกี่ยวกับรถ',
    approver: 'affiliation',
    escalate: 'province',
    link: { affiliation: '/affiliation/vehicle-requests', admin: '/admin/vehicle-requests' },
    sql: `SELECT CAST(q.id AS CHAR) AS item_id, TIMESTAMPDIFF(SECOND, q.created_at, NOW()) AS age_s,
                 q.school_id, sc.name AS school_name, sc.affiliation_id,
                 q.request_type,
                 COALESCE(q.input_plate, NULLIF(CONCAT_WS(' ', q.plate_prefix, q.plate_number), '')) AS plate
            FROM vehicle_requests q
            LEFT JOIN schools sc ON sc.id = q.school_id
           WHERE q.status = 'PENDING'`,
    title: (r) => `${VEHICLE_REQUEST_LABEL[r.request_type] || 'คำขอเกี่ยวกับรถ'} ${r.plate || ''}`.trim(),
  },
  {
    key: 'inspection_waiting',
    code: 'IW',
    label: 'รถรอตรวจสภาพ',
    approver: 'transport',
    escalate: 'province',
    link: { transport: '/transport/verification' },
    // An application with an open attempt is counted by inspection_open_attempts.
    sql: `SELECT CAST(a.id AS CHAR) AS item_id,
                 TIMESTAMPDIFF(SECOND,
                   CASE WHEN a.status = 'INSPECTION_PENDING' THEN a.updated_at
                        ELSE COALESCE(a.submitted_at, a.ready_at, a.created_at) END, NOW()) AS age_s,
                 a.issuing_school_id AS school_id, sc.name AS school_name, sc.affiliation_id,
                 v.plate_no, a.request_no
            FROM vehicle_inspection_applications a
            JOIN vehicles v ON v.id = a.vehicle_id
            JOIN schools sc ON sc.id = a.issuing_school_id
           WHERE a.status IN ('READY_TO_PRINT','SUBMITTED','INSPECTION_PENDING')
             AND NOT EXISTS (SELECT 1 FROM inspection_attempts ia
                              WHERE ia.application_id = a.id AND ia.result = 'IN_PROGRESS')`,
    title: (r) => `ตรวจสภาพรถ ${r.plate_no || '-'} (${r.request_no || '-'})`,
  },
  {
    key: 'inspection_open_attempts',
    code: 'IA',
    label: 'การตรวจที่เริ่มแล้วแต่ยังไม่สรุปผล',
    approver: 'transport',
    escalate: 'province',
    link: { transport: '/transport/verification' },
    sql: `SELECT CAST(ia.id AS CHAR) AS item_id, TIMESTAMPDIFF(SECOND, ia.started_at, NOW()) AS age_s,
                 a.issuing_school_id AS school_id, sc.name AS school_name, sc.affiliation_id,
                 v.plate_no, u.display_name AS inspector_name
            FROM inspection_attempts ia
            JOIN vehicle_inspection_applications a ON a.id = ia.application_id
            JOIN vehicles v ON v.id = a.vehicle_id
            JOIN schools sc ON sc.id = a.issuing_school_id
            LEFT JOIN users u ON u.id = ia.inspected_by
           WHERE ia.result = 'IN_PROGRESS'`,
    title: (r) => `รถ ${r.plate_no || '-'} · ผู้ตรวจ ${r.inspector_name || '-'}`,
  },
  {
    key: 'document_review',
    code: 'DR',
    label: 'เอกสารรถ/คนขับรอตรวจ',
    approver: 'transport',
    escalate: 'province',
    flag: () => env.features.driverRegistration,
    link: { transport: '/transport/verification' },
    sql: `SELECT CONCAT('V', d.id) AS item_id, TIMESTAMPDIFF(SECOND, d.created_at, NOW()) AS age_s,
                 NULL AS school_id, NULL AS school_name, NULL AS affiliation_id,
                 d.doc_type, v.plate_no
            FROM vehicle_documents d
            JOIN vehicles v ON v.id = d.vehicle_id
           WHERE d.review_status = 'PENDING' AND d.is_deleted = FALSE
          UNION ALL
          SELECT CONCAT('D', d.id), TIMESTAMPDIFF(SECOND, d.created_at, NOW()),
                 NULL, NULL, NULL, d.doc_type, NULL
            FROM driver_documents d
           WHERE d.review_status = 'PENDING' AND d.is_deleted = FALSE`,
    title: (r) => `${DOC_LABEL[r.doc_type] || 'เอกสาร'}${r.plate_no ? ` · รถ ${r.plate_no}` : ' · คนขับ'}`,
  },
  // ─── School transport certification (มพบ. 2564, migration 063) ───────────
  {
    key: 'inspection_appointments',
    code: 'AP',
    label: 'คำขอนัดตรวจรถที่โรงเรียน',
    approver: 'transport',
    escalate: 'province',
    flag: () => env.features.schoolCertification,
    link: { transport: '/transport/verification' },
    sql: `SELECT CAST(ap.id AS CHAR) AS item_id, TIMESTAMPDIFF(SECOND, ap.created_at, NOW()) AS age_s,
                 ap.school_id, sc.name AS school_name, sc.affiliation_id,
                 DATE_FORMAT(ap.proposed_date, '%Y-%m-%d') AS proposed_date,
                 (SELECT COUNT(*) FROM inspection_appointment_vehicles iav
                   WHERE iav.appointment_id = ap.id) AS vehicle_count
            FROM inspection_appointments ap
            JOIN schools sc ON sc.id = ap.school_id
           WHERE ap.status = 'REQUESTED'`,
    title: (r) => `นัดตรวจรถที่ ${r.school_name || '-'} ${Number(r.vehicle_count) || 0} คัน · เสนอวันที่ ${r.proposed_date || '-'}`,
  },
  {
    // Not a request anyone decides — a reminder on the school's badge that a
    // certificate ends within 30 days. Never alerted (noAlert), never escalated.
    key: 'certificate_expiring',
    code: 'CE',
    label: 'หนังสือรับรองรถใกล้หมดอายุ (30 วัน)',
    approver: 'school',
    escalate: 'affiliation',
    noAlert: true,
    flag: () => env.features.schoolCertification,
    link: { school: '/school/vehicle-verification' },
    sql: `SELECT CAST(c.id AS CHAR) AS item_id, 0 AS age_s,
                 c.school_id, sc.name AS school_name, sc.affiliation_id,
                 v.plate_no, DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until
            FROM school_transport_certificates c
            JOIN schools sc ON sc.id = c.school_id
            JOIN vehicles v ON v.id = c.vehicle_id
           WHERE c.revoked_at IS NULL
             AND c.valid_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             AND NOT EXISTS (SELECT 1 FROM school_transport_certificates n
                              WHERE n.vehicle_id = c.vehicle_id AND n.school_id = c.school_id
                                AND n.revoked_at IS NULL AND n.valid_until > c.valid_until)`,
    title: (r) => `หนังสือรับรองรถ ${r.plate_no || '-'} หมดอายุ ${r.valid_until || '-'}`,
  },
  {
    // FAILED / NEEDS_FIX past the 15-day fix deadline with no resubmission.
    // Alerted ONCE to the issuing school and ONCE to transport as soon as it
    // appears (immediate); nothing is cancelled automatically.
    key: 'fix_overdue',
    code: 'FX',
    label: 'รถไม่ผ่านตรวจ เลยกำหนดยื่นใหม่ (15 วัน)',
    approver: 'school',
    escalate: 'transport',
    immediate: true,
    flag: () => env.features.schoolCertification,
    link: { school: '/school/vehicle-verification', transport: '/transport/verification' },
    sql: `SELECT CAST(a.id AS CHAR) AS item_id,
                 GREATEST(0, TIMESTAMPDIFF(SECOND, a.fix_deadline, NOW())) AS age_s,
                 a.issuing_school_id AS school_id, sc.name AS school_name, sc.affiliation_id,
                 v.plate_no, a.request_no, DATE_FORMAT(a.fix_deadline, '%Y-%m-%d') AS fix_deadline
            FROM vehicle_inspection_applications a
            JOIN vehicles v ON v.id = a.vehicle_id
            JOIN schools sc ON sc.id = a.issuing_school_id
           WHERE a.status IN ('FAILED','NEEDS_FIX')
             AND a.fix_deadline IS NOT NULL AND a.fix_deadline < CURDATE()
             AND NOT EXISTS (SELECT 1 FROM vehicle_inspection_applications n
                              WHERE n.vehicle_id = a.vehicle_id AND n.id > a.id
                                AND n.status NOT IN ('CANCELLED','REJECTED'))`,
    title: (r) => `รถ ${r.plate_no || '-'} (${r.request_no || '-'}) เลยกำหนดยื่นใหม่ ${r.fix_deadline || '-'}`,
  },
];

const BY_KEY = new Map(QUEUES.map((q) => [q.key, q]));
const BY_CODE = new Map(QUEUES.map((q) => [q.code, q]));

function activeQueues() {
  return QUEUES.filter((q) => !q.flag || q.flag());
}

/** Who must act on an item (approver) and who is told after ESCALATE days. */
function targetsFor(queue, item) {
  const scopeOf = (role) => {
    if (role === 'school') return item.school_id ? String(item.school_id) : null;
    if (role === 'affiliation') return item.affiliation_id != null ? String(item.affiliation_id) : null;
    return null;
  };
  const approver = { role: queue.approver, scopeId: scopeOf(queue.approver) };
  let escalate = { role: queue.escalate, scopeId: scopeOf(queue.escalate) };
  // A school with no affiliation has nobody between it and the province.
  if (escalate.role === 'affiliation' && !escalate.scopeId) escalate = { role: 'province', scopeId: null };
  return { approver, escalate };
}

function toItem(queue, row, cfg) {
  const ageS = Math.max(0, Number(row.age_s) || 0);
  const ageDays = Math.floor(ageS / DAY_S);
  return {
    queue: queue.key,
    item_id: String(row.item_id),
    title: queue.title(row),
    school_id: row.school_id != null ? String(row.school_id) : null,
    school_name: row.school_name || null,
    affiliation_id: row.affiliation_id != null ? String(row.affiliation_id) : null,
    age_days: ageDays,
    overdue: ageS >= cfg.overdueDays * DAY_S,
    escalated: ageS >= cfg.escalateDays * DAY_S,
  };
}

async function loadQueue(db, queue, cfg, filter = null) {
  const params = [];
  let sql = `SELECT * FROM (${queue.sql}) x`;
  if (filter && filter.col === 'school') { sql += ' WHERE x.school_id = ?'; params.push(filter.value); }
  if (filter && filter.col === 'affiliation') { sql += ' WHERE x.affiliation_id = ?'; params.push(filter.value); }
  sql += ' ORDER BY x.age_s DESC LIMIT 500';
  const [rows] = await db.query(sql, params);
  return rows.map((r) => toItem(queue, r, cfg));
}

function summarise(queue, items, viewerRole) {
  const oldest = items.reduce((m, i) => Math.max(m, i.age_days), 0);
  return {
    key: queue.key,
    label: queue.label,
    count: items.length,
    overdue: items.filter((i) => i.overdue).length,
    oldest_days: items.length ? oldest : null,
    link: queue.link[viewerRole] || null,
  };
}

/**
 * viewer = { role, scopeId, gradeScope }. Returns counts always; item lists
 * only when detail=true (the page), so the badge poll stays light.
 */
async function getSummary(db, viewer, { detail = false } = {}) {
  const cfg = thresholds();
  const role = viewer.role;
  const out = {
    role,
    overdue_days: cfg.overdueDays,
    escalate_days: cfg.escalateDays,
    total: 0,
    overdue_total: 0,
    queues: [],
    escalated: { count: 0, items: [] },
    alerts: [],
  };
  // A grade teacher cannot decide any of these (every queue here is gated by
  // requireFullSchoolScope at its own route), so their badge stays empty.
  if (role === 'school' && viewer.gradeScope) return out;
  if (['school', 'affiliation'].includes(role) && !viewer.scopeId) return out;

  const queues = activeQueues();
  const own = queues.filter((q) => (role === 'admin' ? true : q.approver === role));
  const ownFilter = role === 'school' ? { col: 'school', value: viewer.scopeId }
    : role === 'affiliation' ? { col: 'affiliation', value: viewer.scopeId } : null;

  const live = new Map(); // `${queue}|${item}` -> item, for matching alerts
  for (const q of own) {
    const items = await loadQueue(db, q, cfg, ownFilter);
    items.forEach((i) => live.set(`${q.key}|${i.item_id}`, i));
    const s = summarise(q, items, role);
    if (detail) s.items = items.slice(0, 100);
    out.queues.push(s);
    out.total += s.count;
    out.overdue_total += s.overdue;
  }

  // Items from the level below that have waited ESCALATE days.
  let below = [];
  if (role === 'affiliation') below = queues.filter((q) => q.escalate === 'affiliation');
  if (role === 'province') below = queues.filter((q) => q.escalate === 'province' || q.escalate === 'affiliation');
  if (role === 'transport') below = queues.filter((q) => q.escalate === 'transport');
  for (const q of below) {
    const items = await loadQueue(db, q, cfg, role === 'affiliation' ? { col: 'affiliation', value: viewer.scopeId } : null);
    for (const i of items) {
      if (!i.escalated && !q.immediate) continue;
      const t = targetsFor(q, i).escalate;
      if (t.role !== role) continue; // province sees school items only when no affiliation sits between
      live.set(`${q.key}|${i.item_id}`, i);
      out.escalated.count += 1;
      if (detail && out.escalated.items.length < 200) {
        out.escalated.items.push({ ...i, queue_label: q.label });
      }
    }
  }
  out.total += out.escalated.count;

  out.alerts = await loadAlerts(db, viewer, live);
  return out;
}

/** In-app alerts addressed to this viewer whose item is still waiting. */
async function loadAlerts(db, viewer, live) {
  if (viewer.role === 'admin') return [];
  const [rows] = await db.query(
    `SELECT id, entity_id, new_value, created_at
       FROM audit_logs
      WHERE entity_type = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.target_role')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.target_scope_id')) = ?
      ORDER BY id DESC
      LIMIT 200`,
    // Province/transport alerts are stored with target_scope_id '' (a JSON null
    // would unquote to the string 'null' and never match).
    [ALERT_ENTITY, viewer.role, ['school', 'affiliation'].includes(viewer.role) ? String(viewer.scopeId) : ''],
  );
  const out = [];
  for (const r of rows) {
    const v = typeof r.new_value === 'string' ? safeJson(r.new_value) : (r.new_value || {});
    const item = live.get(`${v.queue}|${v.item_id}`);
    if (!item) continue; // already decided — the alert is history, not news
    out.push({
      id: r.id,
      created_at: r.created_at,
      kind: v.kind,
      queue: v.queue,
      queue_label: (BY_KEY.get(v.queue) || {}).label || v.queue,
      item_id: v.item_id,
      title: item.title,
      school_name: item.school_name,
      age_days: item.age_days,
    });
  }
  return out.slice(0, 50);
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function alertKey(queue, itemId, kind) {
  return `pq:${queue.code}:${itemId}:${kind === 'ESCALATED' ? 'E' : 'O'}`.slice(0, 50);
}

/**
 * The alerts that should exist now: one OVERDUE per item for its approver, one
 * ESCALATED per item for the level above.
 */
async function computeAlerts(db, cfg = thresholds()) {
  const wanted = [];
  for (const q of activeQueues()) {
    if (q.noAlert) continue;
    const items = await loadQueue(db, q, cfg, null);
    for (const i of items) {
      if (!i.overdue && !q.immediate) continue;
      const t = targetsFor(q, i);
      const base = { queue: q.key, item_id: i.item_id, age_days: i.age_days, school_id: i.school_id };
      wanted.push({ key: alertKey(q, i.item_id, 'OVERDUE'), kind: 'OVERDUE', target: t.approver, ...base, title: i.title });
      if (i.escalated || q.immediate) {
        wanted.push({ key: alertKey(q, i.item_id, 'ESCALATED'), kind: 'ESCALATED', target: t.escalate, ...base, title: i.title });
      }
    }
  }
  return wanted;
}

async function existingKeys(db, keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const [rows] = await db.query(
      'SELECT entity_id FROM audit_logs WHERE entity_type = ? AND entity_id IN (?)',
      [ALERT_ENTITY, chunk],
    );
    rows.forEach((r) => found.add(r.entity_id));
  }
  return found;
}

/** One cron pass. dryRun=true reports what would be created and writes nothing. */
async function runOnce({ db, dryRun = false } = {}) {
  const cfg = thresholds();
  const wanted = await computeAlerts(db, cfg);
  const have = wanted.length ? await existingKeys(db, wanted.map((w) => w.key)) : new Set();
  const created = [];
  for (const w of wanted) {
    if (have.has(w.key)) continue;
    if (!dryRun) {
      await logAudit({
        action: 'CREATE',
        entityType: ALERT_ENTITY,
        entityId: w.key,
        newValue: {
          kind: w.kind,
          queue: w.queue,
          item_id: w.item_id,
          age_days: w.age_days,
          target_role: w.target.role,
          target_scope_id: w.target.scopeId || '',
          school_id: w.school_id,
        },
        userAgent: 'pending-queue-alert',
        conn: db,
        required: true,
      });
    }
    created.push(w);
  }
  return { cfg, considered: wanted.length, created, skipped_existing: wanted.length - created.length };
}

module.exports = {
  QUEUES,
  BY_CODE,
  ALERT_ENTITY,
  thresholds,
  targetsFor,
  toItem,
  getSummary,
  computeAlerts,
  runOnce,
  alertKey,
};
