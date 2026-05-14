'use strict';

const { pool } = require('../config/database');
const bcrypt = require('bcrypt');
const { logAudit } = require('../utils/audit');

/**
 * Get school user accounts under an affiliation.
 */
async function getSchoolAccounts(affiliationId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.is_active, u.last_login, u.created_at,
            sc.id AS school_id, sc.name AS school_name
     FROM users u
     JOIN schools sc ON sc.id = u.scope_id AND sc.affiliation_id = ?
     WHERE u.role = 'school' AND u.scope_type = 'SCHOOL' AND u.is_deleted = FALSE
     ORDER BY sc.name`,
    [affiliationId]
  );
  return rows;
}

/**
 * Create a school user account.
 */
async function createSchoolAccount({ affiliationId, schoolId, username, displayName, userId }) {
  // Verify school belongs to this affiliation
  const [[school]] = await pool.query(
    `SELECT id, name FROM schools WHERE id = ? AND affiliation_id = ? AND is_deleted = FALSE`,
    [schoolId, affiliationId]
  );
  if (!school) {
    const err = new Error('โรงเรียนไม่อยู่ในสังกัดนี้');
    err.statusCode = 403;
    throw err;
  }

  // Enforce username convention: 6-digit OBEC code
  if (!/^\d{6}$/.test(username)) {
    const err = new Error('ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก (ตัวเลขเท่านั้น)');
    err.statusCode = 400;
    throw err;
  }

  // Auto-generate initial password from school.id (school code)
  const password = school.id;
  if (!/^\d+$/.test(password) || password.length < 4) {
    const err = new Error(`รหัสโรงเรียน "${school.id}" ไม่สามารถใช้เป็นรหัสผ่านเริ่มต้นได้ กรุณาติดต่อผู้ดูแลระบบ`);
    err.statusCode = 400;
    throw err;
  }

  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, must_change_password)
     VALUES (?, ?, 'school', 'SCHOOL', ?, ?, TRUE)`,
    [username, hash, schoolId, displayName || school.name]
  );

  await logAudit({
    userId, action: 'CREATE', entityType: 'user', entityId: result.insertId,
    newValue: { username, role: 'school', schoolId, displayName },
  });

  return { id: result.insertId, username, school_id: schoolId, school_name: school.name };
}

/**
 * Reset a school account password.
 */
async function resetSchoolPassword({ affiliationId, accountId, newPassword, userId }) {
  // Verify user belongs to a school in this affiliation
  const [[account]] = await pool.query(
    `SELECT u.id, u.username, sc.affiliation_id
     FROM users u
     JOIN schools sc ON sc.id = u.scope_id
     WHERE u.id = ? AND u.role = 'school' AND sc.affiliation_id = ? AND u.is_deleted = FALSE`,
    [accountId, affiliationId]
  );
  if (!account) {
    const err = new Error('ไม่พบบัญชีนี้ในสังกัด');
    err.statusCode = 404;
    throw err;
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query(`UPDATE users SET password_hash = ?, must_change_password = TRUE WHERE id = ?`, [hash, accountId]);

  await logAudit({
    userId, action: 'UPDATE', entityType: 'user', entityId: accountId,
    newValue: { action: 'password_reset' },
  });

  return { id: accountId, username: account.username };
}

/**
 * Toggle active status.
 */
async function toggleSchoolAccount({ affiliationId, accountId, isActive, userId }) {
  const [[account]] = await pool.query(
    `SELECT u.id FROM users u
     JOIN schools sc ON sc.id = u.scope_id
     WHERE u.id = ? AND u.role = 'school' AND sc.affiliation_id = ? AND u.is_deleted = FALSE`,
    [accountId, affiliationId]
  );
  if (!account) {
    const err = new Error('ไม่พบบัญชีนี้ในสังกัด');
    err.statusCode = 404;
    throw err;
  }

  await pool.query(`UPDATE users SET is_active = ? WHERE id = ?`, [isActive, accountId]);
  await logAudit({ userId, action: 'UPDATE', entityType: 'user', entityId: accountId, newValue: { isActive } });
  return { id: accountId, is_active: isActive };
}

/**
 * Create a new school + user account in a single transaction.
 */
async function createSchoolWithAccount({ affiliationId, schoolCode, schoolName, username, userId }) {
  // Validate school code: must be digits, used as school.id and as initial password
  if (!/^\d{6,10}$/.test(schoolCode)) {
    const err = new Error('รหัสโรงเรียนต้องเป็นตัวเลข 6-10 หลัก');
    err.statusCode = 400;
    throw err;
  }
  if (!schoolName || !schoolName.trim()) {
    const err = new Error('กรุณากรอกชื่อโรงเรียน');
    err.statusCode = 400;
    throw err;
  }
  if (!/^\d{6}$/.test(username)) {
    const err = new Error('ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก (ตัวเลขเท่านั้น)');
    err.statusCode = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Check duplicate school code
    const [[existingSchool]] = await conn.query(
      `SELECT id FROM schools WHERE id = ?`, [schoolCode]
    );
    if (existingSchool) {
      const err = new Error(`รหัสโรงเรียน ${schoolCode} มีอยู่ในระบบแล้ว`);
      err.statusCode = 409;
      throw err;
    }

    // Check duplicate username
    const [[existingUser]] = await conn.query(
      `SELECT id FROM users WHERE username = ? AND is_deleted = FALSE`, [username]
    );
    if (existingUser) {
      const err = new Error(`ชื่อผู้ใช้ ${username} มีอยู่ในระบบแล้ว`);
      err.statusCode = 409;
      throw err;
    }

    // Create school
    await conn.query(
      `INSERT INTO schools (id, name, affiliation_id) VALUES (?, ?, ?)`,
      [schoolCode, schoolName.trim(), affiliationId]
    );

    // Create user account (password = school code, must change on first login)
    const hash = await bcrypt.hash(schoolCode, 12);
    const [userResult] = await conn.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, must_change_password)
       VALUES (?, ?, 'school', 'SCHOOL', ?, ?, TRUE)`,
      [username, hash, schoolCode, schoolName.trim()]
    );

    await logAudit({
      userId, action: 'CREATE', entityType: 'school', entityId: schoolCode,
      newValue: { schoolCode, schoolName: schoolName.trim(), username, affiliationId },
      conn,
    });

    await conn.commit();
    return { school_id: schoolCode, school_name: schoolName.trim(), user_id: userResult.insertId, username };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Phase 10.2A — Bulk school-account import helpers.
 *
 * Two-phase flow (preview → commit) to let the affiliation user
 * review validation results before any DB write. The frontend
 * re-uploads the same Excel file on commit; the server re-runs
 * validation against the live DB to avoid stale-state writes.
 *
 * Security contract:
 *  - bcrypt cost 12 for every row, matching the rest of the app.
 *  - must_change_password = TRUE for every account created.
 *  - The initial_password value (whether operator-supplied or
 *    defaulted to school_code) NEVER leaves this module: it is
 *    consumed inline by bcrypt.hash() and dropped on the next
 *    line. The preview response never echoes it, and the commit
 *    response never echoes it.
 *  - Scope is derived from JWT in the route layer and passed in
 *    as affiliationId; the service does not trust any caller-
 *    supplied affiliation id.
 */

// Per-row error codes. Stable strings — the frontend keys off these.
const ERR = Object.freeze({
  INVALID_SCHOOL_CODE:         'INVALID_SCHOOL_CODE',         // not 6-10 digits
  MISSING_SCHOOL_NAME:         'MISSING_SCHOOL_NAME',         // empty after trim
  USERNAME_REQUIRED:           'USERNAME_REQUIRED',           // can't auto-derive
  INVALID_USERNAME:            'INVALID_USERNAME',            // provided but not 6 digits
  WEAK_PASSWORD:               'WEAK_PASSWORD',               // < 4 chars after defaulting
  SCHOOL_CODE_EXISTS:          'SCHOOL_CODE_EXISTS',          // present in DB
  USERNAME_EXISTS:             'USERNAME_EXISTS',             // present in DB
  DUPLICATE_IN_FILE:           'DUPLICATE_IN_FILE',           // same school_code twice in upload
  DUPLICATE_USERNAME_IN_FILE:  'DUPLICATE_USERNAME_IN_FILE',  // same username twice in upload
});

const ERR_MSG_TH = {
  INVALID_SCHOOL_CODE:         'รหัสโรงเรียนต้องเป็นตัวเลข 6-10 หลัก',
  MISSING_SCHOOL_NAME:         'กรุณากรอกชื่อโรงเรียน',
  USERNAME_REQUIRED:           'ต้องระบุชื่อผู้ใช้ (รหัสโรงเรียนไม่ใช่ 6 หลัก จึงไม่สามารถใช้เป็นค่าเริ่มต้นได้)',
  INVALID_USERNAME:            'ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก (ตัวเลขเท่านั้น)',
  WEAK_PASSWORD:               'รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 4 ตัวอักษร',
  SCHOOL_CODE_EXISTS:          'รหัสโรงเรียนนี้มีอยู่ในระบบแล้ว',
  USERNAME_EXISTS:             'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว',
  DUPLICATE_IN_FILE:           'รหัสโรงเรียนซ้ำกับแถวอื่นในไฟล์เดียวกัน',
  DUPLICATE_USERNAME_IN_FILE:  'ชื่อผู้ใช้ซ้ำกับแถวอื่นในไฟล์เดียวกัน',
};

/**
 * Normalize one raw parsed Excel/CSV row into the canonical shape used by
 * preview + commit. Trims whitespace, defaults username and initial_password.
 * Returns { rowNum, school_code, school_name, username, has_password }.
 *
 * Note: the password VALUE is intentionally NOT placed on the returned object
 * so it can never escape this module via a preview response. Callers that
 * need the actual password (commit path) call resolveRowPassword() directly.
 */
function normalizeRow(raw) {
  const school_code = String(raw.school_code || '').trim();
  const school_name = String(raw.school_name || '').trim();
  const usernameIn  = String(raw.username || '').trim();
  const username    = usernameIn || (/^\d{6}$/.test(school_code) ? school_code : '');
  return {
    rowNum: raw.rowNum,
    school_code,
    school_name,
    username,
    has_password: Boolean(String(raw.initial_password || '').trim()),
  };
}

/**
 * Return the effective password for a normalized row WITHOUT exposing it.
 * The raw `initial_password` if provided, else the school_code as a default.
 * Used at commit time only.
 */
function resolveRowPassword(raw, normalized) {
  const provided = String(raw.initial_password || '').trim();
  return provided || normalized.school_code;
}

/**
 * Per-row validation. Pure function; no I/O.
 *  - row:                    output of normalizeRow()
 *  - rawPassword:            output of resolveRowPassword() (commit-time)
 *  - existingSchoolCodes:    Set<string> of school_code values already in DB
 *  - existingUsernames:      Set<string> of usernames already in DB
 *  - fileSchoolCodes:        Set<string> of school_codes seen earlier in upload
 *  - fileUsernames:          Set<string> of usernames seen earlier in upload
 * Returns { valid: boolean, errors: string[] }  (error codes only).
 */
function validateImportRow(row, rawPassword, existingSchoolCodes, existingUsernames, fileSchoolCodes, fileUsernames) {
  const errors = [];
  if (!/^\d{6,10}$/.test(row.school_code))            errors.push(ERR.INVALID_SCHOOL_CODE);
  if (!row.school_name)                               errors.push(ERR.MISSING_SCHOOL_NAME);
  if (!row.username)                                  errors.push(ERR.USERNAME_REQUIRED);
  else if (!/^\d{6}$/.test(row.username))             errors.push(ERR.INVALID_USERNAME);
  if (!rawPassword || rawPassword.length < 4)         errors.push(ERR.WEAK_PASSWORD);
  if (row.school_code && existingSchoolCodes.has(row.school_code)) errors.push(ERR.SCHOOL_CODE_EXISTS);
  if (row.username    && existingUsernames.has(row.username))      errors.push(ERR.USERNAME_EXISTS);
  if (row.school_code && fileSchoolCodes.has(row.school_code))     errors.push(ERR.DUPLICATE_IN_FILE);
  if (row.username    && fileUsernames.has(row.username))          errors.push(ERR.DUPLICATE_USERNAME_IN_FILE);
  return { valid: errors.length === 0, errors };
}

/**
 * Run validation against the live DB but DO NOT write anything.
 * Returns { rows, summary }, where each row is { rowNum, school_code,
 * school_name, username, status: 'ok'|'error', errors: [{code, message}] }.
 * `initial_password` is intentionally absent from every returned row.
 */
async function previewSchoolImport(rawRows, affiliationId) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return {
      rows: [],
      summary: { total: 0, valid: 0, invalid: 0 },
    };
  }

  // Snapshot DB state once. Scope check on schools = entire `schools` table
  // because school_code IS the PK and must be globally unique regardless of
  // affiliation — duplicates against any affiliation are still collisions.
  const [schoolRows] = await pool.query(`SELECT id FROM schools`);
  const existingSchoolCodes = new Set(schoolRows.map(r => String(r.id)));

  const [userRows] = await pool.query(`SELECT username FROM users WHERE is_deleted = FALSE`);
  const existingUsernames = new Set(userRows.map(r => String(r.username)));

  const fileSchoolCodes = new Set();
  const fileUsernames   = new Set();
  const results = [];

  for (const raw of rawRows) {
    const row = normalizeRow(raw);
    const rawPassword = resolveRowPassword(raw, row);
    const { valid, errors } = validateImportRow(
      row, rawPassword,
      existingSchoolCodes, existingUsernames,
      fileSchoolCodes, fileUsernames
    );
    // Mark this row's identifiers as "seen" AFTER validation so the first
    // occurrence is considered legitimate and subsequent ones get the
    // DUPLICATE_*_IN_FILE flag.
    if (row.school_code) fileSchoolCodes.add(row.school_code);
    if (row.username)    fileUsernames.add(row.username);

    results.push({
      rowNum: row.rowNum,
      school_code: row.school_code,
      school_name: row.school_name,
      username: row.username,
      // password is NEVER in the response — only the "operator wrote one" flag.
      has_password: row.has_password,
      status: valid ? 'ok' : 'error',
      errors: errors.map(code => ({ code, message: ERR_MSG_TH[code] || code })),
    });
  }

  const valid   = results.filter(r => r.status === 'ok').length;
  return {
    rows: results,
    summary: { total: results.length, valid, invalid: results.length - valid },
  };
}

/**
 * Commit valid rows in a single transaction. Re-runs validation against the
 * live DB so a stale preview (rows added since preview ran) doesn't slip
 * through. Skipped rows are reported but do not abort the transaction.
 * Returns { rows, summary: { total, created, skipped, invalid } }.
 *
 * NEVER returns the plaintext initial_password.
 */
async function commitSchoolImport(rawRows, affiliationId, userId) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return {
      rows: [],
      summary: { total: 0, created: 0, skipped: 0, invalid: 0 },
    };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Snapshot DB state inside the transaction (read consistency).
    const [schoolRows] = await conn.query(`SELECT id FROM schools`);
    const existingSchoolCodes = new Set(schoolRows.map(r => String(r.id)));
    const [userRows] = await conn.query(`SELECT username FROM users WHERE is_deleted = FALSE`);
    const existingUsernames = new Set(userRows.map(r => String(r.username)));

    const fileSchoolCodes = new Set();
    const fileUsernames   = new Set();
    const out = [];
    let created = 0;
    let invalid = 0;

    for (const raw of rawRows) {
      const row = normalizeRow(raw);
      const rawPassword = resolveRowPassword(raw, row);
      const { valid, errors } = validateImportRow(
        row, rawPassword,
        existingSchoolCodes, existingUsernames,
        fileSchoolCodes, fileUsernames
      );
      if (row.school_code) fileSchoolCodes.add(row.school_code);
      if (row.username)    fileUsernames.add(row.username);

      if (!valid) {
        invalid += 1;
        out.push({
          rowNum: row.rowNum,
          school_code: row.school_code,
          school_name: row.school_name,
          username: row.username,
          status: 'skipped',
          errors: errors.map(code => ({ code, message: ERR_MSG_TH[code] || code })),
        });
        continue;
      }

      // Insert school + user. The plaintext password leaves memory after
      // bcrypt.hash() returns; never logged, never persisted as plaintext.
      const hash = await bcrypt.hash(rawPassword, 12);
      await conn.query(
        `INSERT INTO schools (id, name, affiliation_id) VALUES (?, ?, ?)`,
        [row.school_code, row.school_name, affiliationId]
      );
      const [userResult] = await conn.query(
        `INSERT INTO users (username, password_hash, role, scope_type, scope_id,
                            display_name, must_change_password)
         VALUES (?, ?, 'school', 'SCHOOL', ?, ?, TRUE)`,
        [row.username, hash, row.school_code, row.school_name]
      );

      // Keep the in-memory snapshot in sync so later rows in the same batch
      // see the newly-inserted school/user as "existing".
      existingSchoolCodes.add(row.school_code);
      existingUsernames.add(row.username);

      await logAudit({
        userId, action: 'CREATE', entityType: 'school', entityId: row.school_code,
        newValue: {
          schoolCode: row.school_code, schoolName: row.school_name,
          username: row.username, affiliationId,
          source: 'bulk_import',
          password_provided: row.has_password,  // boolean only, never the value
        },
        conn,
      });

      created += 1;
      out.push({
        rowNum: row.rowNum,
        school_code: row.school_code,
        school_name: row.school_name,
        username: row.username,
        status: 'created',
        user_id: userResult.insertId,
        errors: [],
      });
    }

    await conn.commit();
    return {
      rows: out,
      summary: { total: rawRows.length, created, skipped: invalid, invalid },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getSchoolAccounts,
  createSchoolAccount,
  resetSchoolPassword,
  toggleSchoolAccount,
  createSchoolWithAccount,
  // Phase 10.2A:
  previewSchoolImport,
  commitSchoolImport,
  // Exposed for tests:
  _validateImportRow: validateImportRow,
  _normalizeRow:      normalizeRow,
  _ERR:               ERR,
};
