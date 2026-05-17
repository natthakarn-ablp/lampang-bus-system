'use strict';

const { pool } = require('../config/database');
const env = require('../config/env');

// Lazy-init LINE client (only when credentials are configured)
let _client = null;
function getClient() {
  if (_client) return _client;
  const { messagingApi } = require('@line/bot-sdk');
  if (!env.line.channelAccessToken) return null;
  _client = new messagingApi.MessagingApiClient({ channelAccessToken: env.line.channelAccessToken });
  return _client;
}

// ─── LINE User Management ───────────────────────────────────────────────────

async function upsertLineUser(lineUserId, displayName) {
  await pool.query(
    `INSERT INTO line_users (line_user_id, user_type, display_name, created_at)
     VALUES (?, 'parent', ?, NOW())
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
    [lineUserId, displayName || null]
  );
}

async function removeLineUser(lineUserId) {
  await pool.query(
    `UPDATE line_users SET verified = FALSE, parent_id = NULL, linked_at = NULL WHERE line_user_id = ?`,
    [lineUserId]
  );
}

// ─── Linking Flow ───────────────────────────────────────────────────────────

// State machine: per-user linking state stored in memory (MVP — no Redis needed for small scale)
// States expire after 10 minutes to prevent memory leaks from abandoned linking flows.
const linkingState = new Map(); // lineUserId -> { step, phone, createdAt }
const LINKING_STATE_TTL = 10 * 60 * 1000; // 10 minutes

function getLinkState(lineUserId) {
  const state = linkingState.get(lineUserId);
  if (!state) return null;
  if (Date.now() - state.createdAt > LINKING_STATE_TTL) {
    linkingState.delete(lineUserId);
    return null;
  }
  return state;
}
function setLinkState(lineUserId, state) {
  linkingState.set(lineUserId, { ...state, createdAt: Date.now() });
}
function clearLinkState(lineUserId) { linkingState.delete(lineUserId); }

// Periodic cleanup of expired states (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of linkingState) {
    if (now - state.createdAt > LINKING_STATE_TTL) linkingState.delete(key);
  }
}, 5 * 60 * 1000);

// Phase 10.3E-UX1 — preview-then-commit linking, used by the LIFF bind page.
// `findLinkableParent` is read-only: no DB mutation. The browser shows the
// student summary to the user, and only after the user taps Confirm does
// the LIFF page call `commitLineLink`. The legacy chat handler keeps using
// `tryLinkByPhoneAndStudentId` so backward compatibility is preserved.

async function findLinkableParent(phone, studentId) {
  // Same join as tryLinkByPhoneAndStudentId, plus a student summary for the
  // confirmation screen. Returns { found: false, message } on miss, or
  // { found: true, parentId, student } on hit.
  const [[row]] = await pool.query(
    `SELECT p.id          AS parent_id,
            s.id          AS student_id,
            s.prefix, s.first_name, s.last_name,
            s.grade, s.classroom,
            sc.name       AS school_name
     FROM   parents p
     JOIN   parent_student ps ON ps.parent_id = p.id AND ps.student_id = ? AND ps.approved = TRUE
     JOIN   students  s ON s.id = ps.student_id AND s.is_deleted = FALSE
     LEFT JOIN schools sc ON sc.id = s.school_id
     WHERE  p.phone = ? AND p.is_deleted = FALSE
     LIMIT  1`,
    [studentId, phone]
  );
  if (!row) {
    return {
      found: false,
      message: 'ไม่พบข้อมูลผู้ปกครองที่ตรงกัน กรุณาตรวจสอบเบอร์โทรและรหัสนักเรียนอีกครั้ง',
    };
  }
  return {
    found: true,
    parentId: row.parent_id,
    student: {
      // Only public-facing fields. We intentionally omit student.id from
      // the response — the LIFF page only needs to display, and the actual
      // binding key is parent.phone + student.id (held in form state).
      prefix:      row.prefix,
      first_name:  row.first_name,
      last_name:   row.last_name,
      grade:       row.grade,
      classroom:   row.classroom,
      school_name: row.school_name,
    },
  };
}

async function commitLineLink(lineUserId, parentId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO line_users (line_user_id, user_type, parent_id, verified, linked_at, created_at)
       VALUES (?, 'parent', ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), verified = TRUE, linked_at = NOW(), user_type = 'parent'`,
      [lineUserId, parentId]
    );
    await conn.query(
      `UPDATE parents SET line_user_id = ? WHERE id = ?`,
      [lineUserId, parentId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  // Drop any pending chat state (await_phone / await_student_id / confirm_*)
  // left over from a chat-driven flow the user abandoned before completing
  // the LIFF bind. Without this, the next chat message gets interpreted as
  // a phone/student-id input — the exact symptom reported as "เบอร์โทร
  // ไม่ถูกต้อง" right after a successful LIFF bind.
  clearLinkState(lineUserId);
  return { success: true, parentId };
}

async function tryLinkByPhoneAndStudentId(lineUserId, phone, studentId) {
  // Find parent by phone
  const [[parent]] = await pool.query(
    `SELECT p.id FROM parents p
     JOIN parent_student ps ON ps.parent_id = p.id AND ps.student_id = ? AND ps.approved = TRUE
     WHERE p.phone = ? AND p.is_deleted = FALSE
     LIMIT 1`,
    [studentId, phone]
  );
  if (!parent) return { success: false, message: 'ไม่พบข้อมูลผู้ปกครองที่ตรงกัน กรุณาตรวจสอบเบอร์โทรและรหัสนักเรียนอีกครั้ง' };

  // Link — ensure line_users record exists first (follow event may have been missed)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO line_users (line_user_id, user_type, parent_id, verified, linked_at, created_at)
       VALUES (?, 'parent', ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), verified = TRUE, linked_at = NOW(), user_type = 'parent'`,
      [lineUserId, parent.id]
    );
    await conn.query(
      `UPDATE parents SET line_user_id = ? WHERE id = ?`,
      [lineUserId, parent.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { success: true, parentId: parent.id };
}

// ─── Link Status Checks ────────────────────────────────────────────────────

/**
 * Check if a LINE user is currently linked to a parent.
 * Returns the parent_id if linked, null otherwise.
 */
async function getLinkedParentId(lineUserId) {
  const [[row]] = await pool.query(
    `SELECT parent_id FROM line_users WHERE line_user_id = ? AND verified = TRUE AND parent_id IS NOT NULL`,
    [lineUserId]
  );
  return row?.parent_id || null;
}

/**
 * Get a summary of the linked parent + children (for "already linked" messages).
 */
async function getLinkedParentSummary(lineUserId) {
  const [[parent]] = await pool.query(
    `SELECT p.id, p.name, p.phone
     FROM line_users lu JOIN parents p ON p.id = lu.parent_id
     WHERE lu.line_user_id = ? AND lu.verified = TRUE`,
    [lineUserId]
  );
  if (!parent) return null;
  const [children] = await pool.query(
    `SELECT s.first_name, s.last_name, s.grade, sc.name AS school_name
     FROM parent_student ps
     JOIN students s ON s.id = ps.student_id AND s.is_deleted = FALSE
     LEFT JOIN schools sc ON sc.id = s.school_id
     WHERE ps.parent_id = ? AND ps.approved = TRUE`,
    [parent.id]
  );
  return { parent, children };
}

/**
 * Safe unlink: soft-remove LINE↔parent link.
 * Clears line_users.parent_id/verified and parents.line_user_id.
 */
async function unlinkAccount(lineUserId) {
  const parentId = await getLinkedParentId(lineUserId);
  if (!parentId) return { success: false, message: 'ไม่พบการผูกบัญชี' };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE line_users SET parent_id = NULL, verified = FALSE, linked_at = NULL WHERE line_user_id = ?`,
      [lineUserId]
    );
    await conn.query(
      `UPDATE parents SET line_user_id = NULL WHERE id = ? AND line_user_id = ?`,
      [parentId, lineUserId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { success: true, unlinkedParentId: parentId };
}

// ─── Parent Data Queries ────────────────────────────────────────────────────

async function getLinkedChildren(lineUserId) {
  // Phase 10.3E-HF4: include the active driver's name for the parent status
  // Flex card. Scalar subquery prevents row duplication when a vehicle has
  // multiple active assignment rows (rare but possible).
  const [rows] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            sc.name AS school_name, v.plate_no,
            (SELECT d.name
               FROM drivers d
               JOIN driver_vehicle_assignments dva ON dva.driver_id = d.id
              WHERE dva.vehicle_id = v.id
                AND dva.is_active = TRUE
                AND d.is_deleted = FALSE
              LIMIT 1) AS driver_name
     FROM line_users lu
     JOIN parents p ON p.id = lu.parent_id
     JOIN parent_student ps ON ps.parent_id = p.id AND ps.approved = TRUE
     JOIN students s ON s.id = ps.student_id AND s.is_deleted = FALSE
     LEFT JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE lu.line_user_id = ? AND lu.verified = TRUE`,
    [lineUserId]
  );
  return rows;
}

async function getChildStatusToday(studentId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [[status]] = await pool.query(
    `SELECT ds.morning_done, ds.morning_ts, ds.evening_done, ds.evening_ts
     FROM daily_status ds
     WHERE ds.student_id = ? AND ds.check_date = ?`,
    [studentId, today]
  );
  return status || { morning_done: false, morning_ts: null, evening_done: false, evening_ts: null };
}

// ─── Message Sending ────────────────────────────────────────────────────────

async function sendTextMessage(lineUserId, text) {
  const client = getClient();
  if (!client) {
    console.log('[LINE DRY-RUN] To:', lineUserId, 'Message:', text);
    return { dryRun: true };
  }
  try {
    await client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] });
    return { sent: true };
  } catch (err) {
    console.error('[LINE] Push failed:', err.message);
    return { sent: false, error: err.message };
  }
}

// ─── Emergency Group Push ───────────────────────────────────────────────────
// Phase 10.3E-HF1 — emergency reports must always reach the school LINE group.
// Phase 10.3E-HF2 — primary path is a Flex card (rich layout + GPS deep-link);
//                   plain-text remains as the fallback when Flex delivery fails.
// Never throws: emergency_logs INSERT must succeed even if LINE is unreachable.

function formatTHTimestamp(ts) {
  const d = ts instanceof Date ? ts : new Date(ts || Date.now());
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// Phase 10.3E-HF2.1 — visual polish. Single source of truth for the info row:
// muted small label (left) + bold dark value (right, wraps). No per-row icon
// noise — the only emoji-like glyphs are reserved for the header (🚨),
// GPS section title (📍), the map button (📍), and the footer shield (🛡).
function emergencyInfoRow(label, value) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: '#9CA3AF',
        weight: 'regular',
        flex: 3,
        gravity: 'top',
      },
      {
        type: 'text',
        text: value == null || value === '' ? '-' : String(value),
        size: 'md',
        color: '#111827',
        weight: 'bold',
        flex: 7,
        wrap: true,
      },
    ],
  };
}

// Compact GPS row — subtle gray-tint background, right-aligned monospace-feel
// value. Reads cleaner than stacked text rows when there are 2–3 numeric facts.
function gpsBox(label, value) {
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: '#F3F4F6',
    cornerRadius: '8px',
    paddingTop: '10px',
    paddingBottom: '10px',
    paddingStart: '14px',
    paddingEnd: '14px',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: '#6B7280',
        weight: 'regular',
        flex: 4,
        gravity: 'center',
      },
      {
        type: 'text',
        text: value,
        size: 'md',
        color: '#111827',
        weight: 'bold',
        align: 'end',
        gravity: 'center',
        flex: 6,
      },
    ],
  };
}

function buildEmergencyFlex(emergency) {
  const {
    plateNo, vehicleType, driverName, schools,
    detail, note, timestamp,
    latitude, longitude, accuracy,
  } = emergency;

  const hasGps = Number.isFinite(latitude) && Number.isFinite(longitude);
  const ts = formatTHTimestamp(timestamp);
  const altText =
    `🚨 แจ้งเหตุฉุกเฉินรถรับส่งนักเรียน (${plateNo || '-'}) ` +
    `เวลา ${ts}${detail ? ' รายละเอียด: ' + String(detail).slice(0, 80) : ''}`;

  const infoRows = [
    emergencyInfoRow('ทะเบียน',     plateNo),
    emergencyInfoRow('ประเภทรถ',    vehicleType),
    emergencyInfoRow('ผู้ขับ',      driverName),
    emergencyInfoRow('โรงเรียน',    schools),
    emergencyInfoRow('เวลา',        ts),
    emergencyInfoRow('รายละเอียด',  detail),
  ];
  if (note) infoRows.push(emergencyInfoRow('หมายเหตุ', note));

  const gpsSection = hasGps
    ? {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        margin: 'lg',
        contents: [
          {
            type: 'text',
            text: '📍 ตำแหน่งจุดแจ้งเหตุ (GPS)',
            size: 'md',
            weight: 'bold',
            color: '#DC2626',
          },
          gpsBox('Latitude',  latitude.toFixed(6)),
          gpsBox('Longitude', longitude.toFixed(6)),
          ...(Number.isFinite(accuracy)
            ? [gpsBox('Accuracy', `±${Math.round(accuracy)} เมตร`)]
            : []),
          {
            type: 'button',
            style: 'primary',
            color: '#1D4ED8',
            height: 'md',
            margin: 'lg',
            action: {
              type: 'uri',
              label: '📍 เปิดแผนที่',
              uri: `https://www.google.com/maps?q=${latitude},${longitude}`,
            },
          },
        ],
      }
    : {
        type: 'box',
        layout: 'horizontal',
        margin: 'lg',
        spacing: 'md',
        backgroundColor: '#FEF3C7',
        borderColor: '#FDE68A',
        borderWidth: '1px',
        cornerRadius: '10px',
        paddingTop: '14px',
        paddingBottom: '14px',
        paddingStart: '14px',
        paddingEnd: '14px',
        contents: [
          { type: 'text', text: '⚠️', size: 'xxl', flex: 0, gravity: 'center' },
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: 'ไม่สามารถระบุตำแหน่ง GPS ได้',
                size: 'md',
                weight: 'bold',
                color: '#92400E',
                wrap: true,
              },
              {
                type: 'text',
                text: 'คนขับอาจปฏิเสธสิทธิ์ตำแหน่ง หรือสัญญาณ GPS ไม่พร้อม',
                size: 'xs',
                color: '#92400E',
                wrap: true,
              },
            ],
          },
        ],
      };

  return {
    type: 'flex',
    altText: altText.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#DC2626',
        paddingTop: '22px',
        paddingBottom: '22px',
        paddingStart: '22px',
        paddingEnd: '22px',
        spacing: 'lg',
        contents: [
          {
            type: 'text',
            text: '🚨',
            size: '3xl',
            flex: 0,
            gravity: 'center',
          },
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: 'แจ้งเหตุฉุกเฉิน',
                color: '#FFFFFF',
                weight: 'bold',
                size: 'xxl',
              },
              {
                type: 'text',
                text: 'รถรับส่งนักเรียน',
                color: '#FECACA',
                size: 'sm',
                weight: 'regular',
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingTop: '20px',
        paddingBottom: '16px',
        paddingStart: '20px',
        paddingEnd: '20px',
        contents: [
          ...infoRows,
          { type: 'separator', margin: 'lg', color: '#E5E7EB' },
          gpsSection,
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingTop: '4px',
        paddingBottom: '16px',
        paddingStart: '20px',
        paddingEnd: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            backgroundColor: '#FEE2E2',
            borderColor: '#FCA5A5',
            borderWidth: '1px',
            cornerRadius: '10px',
            paddingTop: '16px',
            paddingBottom: '16px',
            paddingStart: '16px',
            paddingEnd: '16px',
            contents: [
              {
                type: 'text',
                text: '🛡',
                size: 'xxl',
                flex: 0,
                gravity: 'center',
              },
              {
                type: 'text',
                text: 'กรุณาตรวจสอบและดำเนินการโดยด่วน',
                size: 'md',
                weight: 'bold',
                color: '#991B1B',
                flex: 1,
                gravity: 'center',
                wrap: true,
              },
            ],
          },
          {
            type: 'text',
            text: 'ระบบแจ้งเหตุอัตโนมัติ • Lampang Bus System',
            size: 'xs',
            color: '#9CA3AF',
            align: 'center',
          },
        ],
      },
    },
  };
}

function buildEmergencyText(emergency) {
  const { plateNo, vehicleType, driverName, schools, detail, note, timestamp, latitude, longitude, accuracy } = emergency;
  const hasGps = Number.isFinite(latitude) && Number.isFinite(longitude);
  const lines = [
    '🚨 แจ้งเหตุฉุกเฉินรถรับส่งนักเรียน',
    '',
    `ทะเบียน: ${plateNo || '-'}`,
    `ประเภทรถ: ${vehicleType || '-'}`,
    `ผู้ขับ: ${driverName || '-'}`,
    `โรงเรียน: ${schools || '-'}`,
    `เวลา: ${formatTHTimestamp(timestamp)}`,
    `รายละเอียด: ${detail || '-'}`,
  ];
  if (note) lines.push(`หมายเหตุ: ${note}`);
  if (hasGps) {
    lines.push('', '📍 ตำแหน่งจุดแจ้งเหตุ (GPS)');
    lines.push(`ละติจูด: ${latitude.toFixed(6)}`);
    lines.push(`ลองจิจูด: ${longitude.toFixed(6)}`);
    if (Number.isFinite(accuracy)) lines.push(`ความแม่นยำ: ±${Math.round(accuracy)} เมตร`);
    lines.push(`แผนที่: https://www.google.com/maps?q=${latitude},${longitude}`);
  } else {
    lines.push('', '⚠️ ไม่สามารถระบุตำแหน่ง GPS ได้');
  }
  lines.push('', 'กรุณาตรวจสอบและดำเนินการโดยด่วน');
  return lines.join('\n');
}

async function pushToEmergencyGroup(text) {
  const groupId = env.line.groupId;
  if (!groupId) {
    console.warn('[LINE_EMERGENCY_PUSH] skipped: missing LINE_GROUP_ID');
    return { sent: false, skipped: 'missing-config' };
  }
  const redacted = groupId.slice(0, 8) + '...';
  const client = getClient();
  if (!client) {
    console.log('[LINE_EMERGENCY_PUSH] dry-run (no channel token)', { target: redacted });
    return { dryRun: true };
  }
  try {
    await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
    console.log('[LINE_EMERGENCY_PUSH] delivered', { target: redacted });
    return { sent: true };
  } catch (err) {
    console.error('[LINE_EMERGENCY_PUSH] failed', { target: redacted, error: err.message });
    return { sent: false, error: err.message };
  }
}

async function pushEmergencyFlexMessage(emergency) {
  const groupId = env.line.groupId;
  if (!groupId) {
    console.warn('[LINE_EMERGENCY_FLEX_PUSH] skipped: missing LINE_GROUP_ID');
    return { sent: false, skipped: 'missing-config' };
  }
  const redacted = groupId.slice(0, 8) + '...';
  const client = getClient();
  if (!client) {
    console.log('[LINE_EMERGENCY_FLEX_PUSH] dry-run (no channel token)', { target: redacted });
    return { dryRun: true };
  }
  let flex;
  try {
    flex = buildEmergencyFlex(emergency);
  } catch (err) {
    console.error('[LINE_EMERGENCY_FLEX_PUSH] builder error — falling back to text', { error: err.message });
    return pushToEmergencyGroup(buildEmergencyText(emergency));
  }
  try {
    await client.pushMessage({ to: groupId, messages: [flex] });
    console.log('[LINE_EMERGENCY_FLEX_PUSH] delivered', { target: redacted });
    return { sent: true, channel: 'flex' };
  } catch (err) {
    console.error('[LINE_EMERGENCY_FLEX_PUSH] failed — falling back to text', { target: redacted, error: err.message });
    const fb = await pushToEmergencyGroup(buildEmergencyText(emergency));
    return { sent: fb.sent === true, channel: fb.sent ? 'text-fallback' : 'failed', flexError: err.message, fallback: fb };
  }
}

// ─── Parent Status Flex (Phase 10.3E-HF4) ───────────────────────────────────
// Parent-facing card shown when the user types "สถานะ". Parent-friendly
// blue/green palette — explicitly NOT the red emergency palette. Never throws:
// any Flex failure (builder bug or LINE 4xx/5xx) silently falls back to the
// plain-text version so the parent always gets *something*.

function formatTimeTH(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });
}

// Phase 10.3E-HF4.1 — visual polish. Richer badge palette (less pale),
// labels updated to school-bus-specific wording (ขึ้นรถ / ส่งถึงจุดรับ),
// child sections get an explicit "คนที่ X/N" tag, and >3 children trigger
// a friendly truncation notice instead of an oversized Flex bubble.

// LINE Flex rejects bubbles whose body grows past its internal size budget.
// Empirically 3 child sections + header + footer renders cleanly on 'mega'.
const PARENT_STATUS_MAX_CHILDREN = 3;

// Compact pill — one row of the [child × session] grid.
function parentStatusBadge(state, label) {
  const palette = {
    done:    { bg: '#D1FAE5', border: '#6EE7B7', text: '#064E3B', icon: '✅' },
    pending: { bg: '#FEF3C7', border: '#FCD34D', text: '#78350F', icon: '⏳' },
    leave:   { bg: '#F3F4F6', border: '#D1D5DB', text: '#374151', icon: '🌿' },
    alert:   { bg: '#FEE2E2', border: '#FCA5A5', text: '#7F1D1D', icon: '⚠️' },
  };
  const c = palette[state] || palette.pending;
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: c.bg,
    borderColor: c.border,
    borderWidth: '1px',
    cornerRadius: '20px',
    paddingTop: '8px', paddingBottom: '8px',
    paddingStart: '10px', paddingEnd: '10px',
    contents: [
      {
        type: 'text',
        text: `${c.icon} ${label}`,
        size: 'sm',
        color: c.text,
        weight: 'bold',
        align: 'center',
        gravity: 'center',
        wrap: false,
      },
    ],
  };
}

function buildChildSection(child, status, idx, total) {
  const fullName  = `${child.prefix || ''}${child.first_name} ${child.last_name}`.trim();
  const gradeRoom = [child.grade, child.classroom].filter(Boolean).join(' / ');
  const metaLine  = [gradeRoom, child.school_name].filter(Boolean).join(' · ');

  const mState = status.morning_done ? 'done' : 'pending';
  const mLabel = status.morning_done
    ? `ขึ้นรถแล้ว ${formatTimeTH(status.morning_ts)}`.trim()
    : 'ยังไม่ขึ้นรถ';
  const eState = status.evening_done ? 'done' : 'pending';
  const eLabel = status.evening_done
    ? `ส่งถึงจุดรับแล้ว ${formatTimeTH(status.evening_ts)}`.trim()
    : 'ยังไม่ส่งถึงจุดรับ';

  const isFirst = idx === 0;
  const contents = [];
  if (!isFirst) {
    contents.push({ type: 'separator', margin: 'xl', color: '#F3F4F6' });
  }

  // "คนที่ X/N" tag — only shown when there's more than one child.
  if (total > 1) {
    contents.push({
      type: 'text',
      text: `คนที่ ${idx + 1}/${total}`,
      size: 'xxs',
      color: '#9CA3AF',
      weight: 'bold',
      margin: isFirst ? 'none' : 'lg',
    });
  }

  contents.push({
    type: 'text',
    text: '👦 ' + fullName,
    size: 'lg',
    weight: 'bold',
    color: '#111827',
    margin: total > 1 ? 'xs' : (isFirst ? 'none' : 'lg'),
    wrap: true,
  });

  if (metaLine) {
    contents.push({
      type: 'text',
      text: metaLine,
      size: 'sm',
      color: '#6B7280',
      margin: 'xs',
      wrap: true,
    });
  }

  contents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'lg',
    spacing: 'md',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'sm',
        contents: [
          { type: 'text', text: 'รอบเช้า', size: 'xs', color: '#6B7280', weight: 'bold', align: 'center' },
          parentStatusBadge(mState, mLabel),
        ],
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'sm',
        contents: [
          { type: 'text', text: 'รอบเย็น', size: 'xs', color: '#6B7280', weight: 'bold', align: 'center' },
          parentStatusBadge(eState, eLabel),
        ],
      },
    ],
  });

  // Vehicle/driver block — two lines, "-" for missing. Explicit per HF4.1 spec.
  contents.push({
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    spacing: 'xs',
    contents: [
      {
        type: 'text',
        text: `🚌 รถ: ${child.plate_no || '-'}`,
        size: 'sm',
        color: '#374151',
        wrap: true,
      },
      {
        type: 'text',
        text: `👤 ผู้ขับ: ${child.driver_name || '-'}`,
        size: 'sm',
        color: '#374151',
        wrap: true,
      },
    ],
  });

  return contents;
}

function buildParentStatusFlex(childrenWithStatus) {
  const total = childrenWithStatus.length;
  const truncated = total > PARENT_STATUS_MAX_CHILDREN;
  const shown    = truncated ? childrenWithStatus.slice(0, PARENT_STATUS_MAX_CHILDREN) : childrenWithStatus;

  const bodyContents = [];
  shown.forEach((entry, idx) => {
    bodyContents.push(...buildChildSection(entry.child, entry.status, idx, total));
  });
  if (truncated) {
    bodyContents.push({ type: 'separator', margin: 'xl', color: '#F3F4F6' });
    bodyContents.push({
      type: 'text',
      text: `แสดง ${PARENT_STATUS_MAX_CHILDREN} จาก ${total} คน · มีข้อมูลเพิ่มเติม กรุณาติดต่อโรงเรียน`,
      size: 'xs',
      color: '#92400E',
      weight: 'bold',
      align: 'center',
      margin: 'lg',
      wrap: true,
    });
  }

  const updatedAt = formatTHTimestamp(new Date());
  const altText = total > 1
    ? `📋 สถานะรับ-ส่งวันนี้ (${total} คน)`
    : '📋 สถานะรับ-ส่งวันนี้';

  return {
    type: 'flex',
    altText: altText.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#2563EB',
        paddingTop: '18px',
        paddingBottom: '18px',
        paddingStart: '18px',
        paddingEnd: '18px',
        spacing: 'lg',
        contents: [
          {
            type: 'text',
            text: '🚌',
            size: '3xl',
            flex: 0,
            gravity: 'center',
          },
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: 'สถานะรับ-ส่งวันนี้',
                color: '#FFFFFF',
                weight: 'bold',
                size: 'xl',
              },
              {
                type: 'text',
                text: 'ระบบรถรับส่งนักเรียนจังหวัดลำปาง',
                color: '#DBEAFE',
                size: 'xs',
                weight: 'regular',
                wrap: true,
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingTop: '18px',
        paddingBottom: '14px',
        paddingStart: '16px',
        paddingEnd: '16px',
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        paddingTop: '0px',
        paddingBottom: '14px',
        paddingStart: '16px',
        paddingEnd: '16px',
        contents: [
          { type: 'separator', color: '#E5E7EB' },
          {
            type: 'text',
            text: `อัปเดตล่าสุด: ${updatedAt}`,
            size: 'xs',
            color: '#374151',
            weight: 'bold',
            align: 'center',
            margin: 'md',
          },
          {
            type: 'text',
            text: 'ข้อมูลนี้แสดงเฉพาะบุตรหลานที่ผูกบัญชีไว้เท่านั้น',
            size: 'xxs',
            color: '#6B7280',
            align: 'center',
            margin: 'xs',
            wrap: true,
          },
          {
            type: 'text',
            text: 'หากข้อมูลไม่ถูกต้อง กรุณาติดต่อโรงเรียน',
            size: 'xxs',
            color: '#9CA3AF',
            align: 'center',
            margin: 'xs',
            wrap: true,
          },
        ],
      },
    },
  };
}

function buildParentStatusText(childrenWithStatus) {
  // Plain-text fallback. Mirrors the Flex wording so the experience stays
  // consistent if the parent falls through to the text path.
  let msg = '📋 สถานะรับ-ส่งวันนี้\n';
  const total = childrenWithStatus.length;
  childrenWithStatus.forEach(({ child, status }, idx) => {
    const mLabel = status.morning_done
      ? `✅ ขึ้นรถแล้ว ${formatTimeTH(status.morning_ts)}`.trim()
      : '⏳ ยังไม่ขึ้นรถ';
    const eLabel = status.evening_done
      ? `✅ ส่งถึงจุดรับแล้ว ${formatTimeTH(status.evening_ts)}`.trim()
      : '⏳ ยังไม่ส่งถึงจุดรับ';
    const gradeRoom = [child.grade, child.classroom].filter(Boolean).join('/');
    if (total > 1) msg += `\n— คนที่ ${idx + 1}/${total} —`;
    msg += `\n👦 ${child.prefix || ''}${child.first_name} ${child.last_name}`;
    msg += `\n   ${gradeRoom} - ${child.school_name || ''}`;
    msg += `\n   รอบเช้า: ${mLabel}`;
    msg += `\n   รอบเย็น: ${eLabel}`;
    msg += `\n   🚌 รถ: ${child.plate_no || '-'}`;
    msg += `\n   👤 ผู้ขับ: ${child.driver_name || '-'}`;
    msg += '\n';
  });
  msg += '\nข้อมูลนี้แสดงเฉพาะบุตรหลานที่ผูกบัญชีไว้เท่านั้น';
  msg += '\nหากข้อมูลไม่ถูกต้อง กรุณาติดต่อโรงเรียน';
  return msg.trim();
}

// Generic parent-side Flex push with text fallback. Used by every webhook
// handler in line.routes.js. Never throws. lineUserId is never logged.
//
//   await pushParentFlex(lineUserId, {
//     flex:        builtFlexObject,
//     fallbackText: 'plain text version of the same message',
//     logPrefix:   '[LINE_PARENT_BIND_FLEX]',
//   });
async function pushParentFlex(lineUserId, { flex, fallbackText, logPrefix }) {
  const tag = logPrefix || '[LINE_PARENT_FLEX]';
  const client = getClient();
  if (!client) {
    console.log(`${tag} dry-run (no channel token)`);
    return { dryRun: true };
  }
  try {
    await client.pushMessage({ to: lineUserId, messages: [flex] });
    console.log(`${tag} delivered`);
    return { sent: true, channel: 'flex' };
  } catch (err) {
    console.error(`${tag} failed — falling back to text`, { error: err.message });
    try {
      await client.pushMessage({
        to: lineUserId,
        messages: [{ type: 'text', text: fallbackText || 'ระบบมีข้อผิดพลาด กรุณาลองใหม่' }],
      });
      console.log(`${tag} fallback_text`);
      return { sent: true, channel: 'fallback_text', flexError: err.message };
    } catch (err2) {
      console.error(`${tag} fallback_text failed`, { error: err2.message });
      return { sent: false, channel: 'failed', flexError: err.message, fallbackError: err2.message };
    }
  }
}

async function pushParentStatusFlex(lineUserId, childrenWithStatus) {
  const client = getClient();
  if (!client) {
    console.log('[LINE_PARENT_STATUS_FLEX] dry-run (no channel token)');
    return { dryRun: true };
  }
  let flex;
  try {
    flex = buildParentStatusFlex(childrenWithStatus);
  } catch (err) {
    console.error('[LINE_PARENT_STATUS_FLEX] builder error — falling back to text', { error: err.message });
    const r = await sendTextMessage(lineUserId, buildParentStatusText(childrenWithStatus));
    console.log('[LINE_PARENT_STATUS_FLEX] fallback_text', { sent: r.sent === true });
    return { sent: r.sent === true, channel: 'fallback_text', error: err.message };
  }
  try {
    await client.pushMessage({ to: lineUserId, messages: [flex] });
    console.log('[LINE_PARENT_STATUS_FLEX] delivered');
    return { sent: true, channel: 'flex' };
  } catch (err) {
    console.error('[LINE_PARENT_STATUS_FLEX] failed — falling back to text', { error: err.message });
    const r = await sendTextMessage(lineUserId, buildParentStatusText(childrenWithStatus));
    console.log('[LINE_PARENT_STATUS_FLEX] fallback_text', { sent: r.sent === true });
    return { sent: r.sent === true, channel: 'fallback_text', flexError: err.message };
  }
}

async function logMessage(lineUserId, sourceType, messageText, result, detail) {
  await pool.query(
    `INSERT INTO line_message_logs (line_user_id, source_type, message_text, result, detail, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [lineUserId, sourceType || 'user', messageText || null, result || null, detail || null]
  );
}

// ─── Notification Processor ─────────────────────────────────────────────────

async function processUnsentNotifications(limit = 50) {
  const [rows] = await pool.query(
    `SELECT id, target_line_user_id, notification_type, student_id, message_json
     FROM notifications
     WHERE sent = FALSE AND retry_count < 3
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit]
  );

  let sent = 0, failed = 0;
  for (const n of rows) {
    const data = typeof n.message_json === 'string' ? JSON.parse(n.message_json) : n.message_json;
    const typeLabel = { checkin: 'ส่งเช้า', checkout: 'รับเย็น', emergency: 'เหตุฉุกเฉิน', system: 'แจ้งเตือน' };
    const text = `📢 แจ้งเตือน: ${typeLabel[n.notification_type] || n.notification_type}\n` +
      `นักเรียน: ${data.studentName || '-'}\n` +
      `สถานะ: ${data.status || '-'}\n` +
      `รอบ: ${data.session === 'morning' ? 'เช้า' : 'เย็น'}\n` +
      `เวลา: ${data.checkedAt ? new Date(data.checkedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}`;

    const result = await sendTextMessage(n.target_line_user_id, text);
    if (result.sent || result.dryRun) {
      await pool.query('UPDATE notifications SET sent = TRUE, sent_at = NOW() WHERE id = ?', [n.id]);
      sent++;
    } else {
      await pool.query('UPDATE notifications SET retry_count = retry_count + 1, error_message = ? WHERE id = ?',
        [result.error || 'unknown', n.id]);
      failed++;
    }
  }
  return { processed: rows.length, sent, failed };
}

module.exports = {
  upsertLineUser, removeLineUser,
  getLinkState, setLinkState, clearLinkState,
  tryLinkByPhoneAndStudentId,
  findLinkableParent, commitLineLink,
  getLinkedParentId, getLinkedParentSummary, unlinkAccount,
  getLinkedChildren, getChildStatusToday,
  sendTextMessage, pushToEmergencyGroup, pushEmergencyFlexMessage,
  pushParentStatusFlex, pushParentFlex, logMessage,
  processUnsentNotifications,
};
