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

module.exports = { getSchoolAccounts, createSchoolAccount, resetSchoolPassword, toggleSchoolAccount, createSchoolWithAccount };
