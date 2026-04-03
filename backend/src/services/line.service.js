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
const linkingState = new Map(); // lineUserId -> { step, phone }

function getLinkState(lineUserId) { return linkingState.get(lineUserId) || null; }
function setLinkState(lineUserId, state) { linkingState.set(lineUserId, state); }
function clearLinkState(lineUserId) { linkingState.delete(lineUserId); }

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

  // Link
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE line_users SET parent_id = ?, verified = TRUE, linked_at = NOW(), user_type = 'parent'
       WHERE line_user_id = ?`,
      [parent.id, lineUserId]
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

// ─── Parent Data Queries ────────────────────────────────────────────────────

async function getLinkedChildren(lineUserId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            sc.name AS school_name, v.plate_no
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
      `เวลา: ${data.checkedAt ? new Date(data.checkedAt).toLocaleString('th-TH') : '-'}`;

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
  getLinkedChildren, getChildStatusToday,
  sendTextMessage, logMessage,
  processUnsentNotifications,
};
