'use strict';

// M3 one-time LINE bind codes issued by the school (parent audit 2026-11-08,
// owner-approved: built and usable, NOT required until the owner says so).
//
// A school issues an 8-character code per pupil and gives it to the parent on
// paper. The parent binds with phone + that code (no student code needed).
// Only SHA-256 of the code is stored; the plain code is returned once, at
// issue time. Issuing a new code revokes the pupil's earlier unused codes.

const crypto = require('crypto');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');

// No 0/O, 1/I/L — read off paper by a parent.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
const VALID_DAYS = 30;
const BULK_MAX = 300;

function generateCode() {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

// What the parent typed → canonical form, or null when it cannot be a code.
function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function formatCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

async function issueOne(conn, studentId, userId) {
  await conn.query(
    `UPDATE parent_claim_codes SET revoked_at = NOW()
      WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [studentId]
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await conn.query(
        `INSERT INTO parent_claim_codes (student_id, code_hash, issued_by, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${VALID_DAYS} DAY))`,
        [studentId, hashCode(code), userId]
      );
      return formatCode(code);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err; // astronomically rare: retry
    }
  }
  throw new Error('could not generate a unique claim code');
}

// Issue codes for pupils of ONE school. `studentIds` must already be scoped by
// the caller's query; rows not in `schoolId` are ignored here too.
async function issueForStudents({ schoolId, studentIds, userId, ip, ua }) {
  const ids = [...new Set(studentIds)].slice(0, BULK_MAX);
  if (!ids.length) return [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [students] = await conn.query(
      `SELECT id, student_code, prefix, first_name, last_name, grade, classroom
         FROM students
        WHERE school_id = ? AND is_deleted = FALSE AND id IN (${ids.map(() => '?').join(',')})
        ORDER BY grade, classroom, first_name`,
      [schoolId, ...ids]
    );
    const out = [];
    for (const s of students) {
      const code = await issueOne(conn, s.id, userId);
      out.push({ ...s, code });
    }
    await logAudit({
      userId, action: 'CREATE', entityType: 'parent_claim_code', entityId: schoolId,
      newValue: { student_ids: students.map(s => s.id), count: students.length, valid_days: VALID_DAYS },
      ipAddress: ip, userAgent: ua, conn, required: true,
    });
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Phone + claim code → the same shape as line.service.findLinkablePhoneByStudentAndPhone
// plus claimId. The phone must belong to an approved parent of the code's pupil.
async function findLinkableParentByClaim(phone, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { found: false };
  const [[row]] = await pool.query(
    `SELECT pcc.id AS claim_id, p.id AS parent_id, s.student_code,
            s.prefix, s.first_name, s.last_name, s.grade, s.classroom, sc.name AS school_name
       FROM parent_claim_codes pcc
       JOIN students s ON s.id = pcc.student_id AND s.is_deleted = FALSE
       JOIN parent_student ps ON ps.student_id = s.id AND ps.approved = TRUE
       JOIN parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE AND p.phone = ?
       LEFT JOIN schools sc ON sc.id = s.school_id
      WHERE pcc.code_hash = ? AND pcc.used_at IS NULL AND pcc.revoked_at IS NULL
        AND pcc.expires_at > NOW()
      LIMIT 1`,
    [phone, hashCode(code)]
  );
  if (!row) return { found: false };
  return {
    found: true,
    claimId: row.claim_id,
    parentId: row.parent_id,
    studentCode: row.student_code,
    student: {
      prefix: row.prefix, first_name: row.first_name, last_name: row.last_name,
      grade: row.grade, classroom: row.classroom, school_name: row.school_name,
    },
  };
}

async function markUsed(claimId, lineUserId) {
  const [res] = await pool.query(
    `UPDATE parent_claim_codes SET used_at = NOW(), used_by = ?
      WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [lineUserId, claimId]
  );
  return res.affectedRows === 1;
}

module.exports = {
  issueForStudents, findLinkableParentByClaim, markUsed, normalizeCode, hashCode,
  generateCode, formatCode, CODE_LEN, VALID_DAYS, BULK_MAX,
};
