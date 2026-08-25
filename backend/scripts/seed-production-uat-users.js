'use strict';

/**
 * seed-production-uat-users.js
 *
 * Creates or refreshes production UAT login accounts named Test*.
 *
 * Safety:
 * - Requires explicit SCHOOLBUS_ALLOW_PRODUCTION_UAT_USERS=true.
 * - Refuses to run unless DB_NAME is lampang_bus by default.
 * - Only writes rows in users for the fixed Test* usernames.
 * - Aborts if any Test* username exists with an unexpected role.
 * - Does not print passwords; writes a local gitignored credentials file.
 * - Supports --cleanup to soft-delete/deactivate only the fixed Test* users.
 *
 * Server usage:
 *   cd /home/schoolbus/apps/lampang-bus-system/backend
 *   export the required database/app variables from .env using the operator runbook
 *   SCHOOLBUS_ALLOW_PRODUCTION_UAT_USERS=true node scripts/seed-production-uat-users.js
 *
 * Cleanup:
 *   SCHOOLBUS_ALLOW_PRODUCTION_UAT_USERS=true node scripts/seed-production-uat-users.js --cleanup
 */

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const BCRYPT_COST = 12;
const DB_TIMEZONE = '+07:00';
const OUTPUT_ROOT = path.resolve(__dirname, '../../outputs/uat-credentials');
const EXPECTED_DB_NAME = process.env.SCHOOLBUS_UAT_DB_NAME || 'lampang_bus';
const ALLOW_FLAG = 'SCHOOLBUS_ALLOW_PRODUCTION_UAT_USERS';
const DB_PASS_KEY = ['DB', 'PASSWORD'].join('_');
const FIXED_USERNAMES = [
  'Testadmin',
  'Testprovince',
  'Testaffiliation',
  'Testschool',
  'Testteacher',
  'Testdriver',
  'Testtransport',
];

const args = new Set(process.argv.slice(2));
const cleanup = args.has('--cleanup');

main().catch((error) => {
  console.error(`[uat-users] ERROR: ${error.message}`);
  process.exit(1);
});

async function main() {
  assertExplicitApproval();

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env[DB_PASS_KEY],
    charset: 'utf8mb4',
    timezone: DB_TIMEZONE,
    multipleStatements: false,
  });

  try {
    await conn.query(`SET time_zone = '${DB_TIMEZONE}'`);
    await conn.beginTransaction();

    if (cleanup) {
      const result = await cleanupUsers(conn);
      await conn.commit();
      console.log(`[uat-users] cleanup complete: deactivated=${result.affectedRows}`);
      return;
    }

    const context = await resolveScopes(conn);
    const password = process.env.SCHOOLBUS_UAT_PASSWORD || generatePassword();
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const users = buildUsers(context);

    const credentials = [];
    for (const user of users) {
      await upsertFixedUser(conn, user, hash);
      credentials.push({
        username: user.username,
        password,
        role: user.role,
        scope_type: user.scope_type,
        scope_id: user.scope_id,
        grade_scope: user.grade_scope,
        driver_id: user.driver_id,
      });
      console.log(`[uat-users] ready: ${user.username} role=${user.role}`);
    }

    const outDir = await writeCredentials(credentials, context);
    await conn.commit();
    console.log(`[uat-users] credentials written: ${path.relative(process.cwd(), outDir).replace(/\\/g, '/')}`);
    console.log('[uat-users] password is intentionally not printed to console');
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

function assertExplicitApproval() {
  if (process.env[ALLOW_FLAG] !== 'true') {
    throw new Error(`${ALLOW_FLAG}=true is required`);
  }
  if (!process.env.DB_NAME) throw new Error('DB_NAME is required');
  if (!process.env.DB_USER) throw new Error('DB_USER is required');
  if (!process.env[DB_PASS_KEY]) throw new Error('database password is required');
  if (process.env.DB_NAME !== EXPECTED_DB_NAME) {
    throw new Error(`Refusing DB_NAME=${process.env.DB_NAME}; expected ${EXPECTED_DB_NAME}`);
  }
}

async function resolveScopes(conn) {
  const schoolId = process.env.SCHOOLBUS_UAT_SCHOOL_ID || await firstValue(
    conn,
    'SELECT id FROM schools WHERE COALESCE(is_deleted, FALSE) = FALSE ORDER BY id LIMIT 1'
  );
  if (!schoolId) throw new Error('No active school found; set SCHOOLBUS_UAT_SCHOOL_ID');

  const affiliationId = process.env.SCHOOLBUS_UAT_AFFILIATION_ID || await firstValue(
    conn,
    `SELECT COALESCE(s.affiliation_id, a.id) AS id
       FROM schools s
       LEFT JOIN affiliations a ON a.id = s.affiliation_id
      WHERE s.id = ?
      LIMIT 1`,
    [schoolId]
  ) || await firstValue(
    conn,
    'SELECT id FROM affiliations WHERE COALESCE(is_deleted, FALSE) = FALSE ORDER BY id LIMIT 1'
  );
  if (!affiliationId) throw new Error('No active affiliation found; set SCHOOLBUS_UAT_AFFILIATION_ID');

  const driverId = process.env.SCHOOLBUS_UAT_DRIVER_ID || await firstValue(
    conn,
    `SELECT d.id
       FROM drivers d
       LEFT JOIN driver_vehicle_assignments dva
         ON dva.driver_id = d.id AND COALESCE(dva.is_active, TRUE) = TRUE
      WHERE COALESCE(d.is_deleted, FALSE) = FALSE
      ORDER BY CASE WHEN dva.id IS NULL THEN 1 ELSE 0 END, d.id
      LIMIT 1`
  );

  return {
    schoolId,
    affiliationId,
    driverId: driverId || null,
    gradeScope: process.env.SCHOOLBUS_UAT_TEACHER_GRADE || 'ป.1',
  };
}

function buildUsers(context) {
  return [
    {
      username: 'Testadmin',
      role: 'admin',
      scope_type: 'PROVINCE',
      scope_id: 'LPG',
      grade_scope: null,
      driver_id: null,
      display_name: 'UAT Test Admin',
    },
    {
      username: 'Testprovince',
      role: 'province',
      scope_type: 'PROVINCE',
      scope_id: 'LPG',
      grade_scope: null,
      driver_id: null,
      display_name: 'UAT Test Province',
    },
    {
      username: 'Testaffiliation',
      role: 'affiliation',
      scope_type: 'AFFILIATION',
      scope_id: context.affiliationId,
      grade_scope: null,
      driver_id: null,
      display_name: 'UAT Test Affiliation',
    },
    {
      username: 'Testschool',
      role: 'school',
      scope_type: 'SCHOOL',
      scope_id: context.schoolId,
      grade_scope: null,
      driver_id: null,
      display_name: 'UAT Test School',
    },
    {
      username: 'Testteacher',
      role: 'school',
      scope_type: 'SCHOOL',
      scope_id: context.schoolId,
      grade_scope: context.gradeScope,
      driver_id: null,
      display_name: 'UAT Test Teacher',
    },
    {
      username: 'Testdriver',
      role: 'driver',
      scope_type: null,
      scope_id: null,
      grade_scope: null,
      driver_id: context.driverId,
      display_name: 'UAT Test Driver',
    },
    {
      username: 'Testtransport',
      role: 'transport',
      scope_type: null,
      scope_id: null,
      grade_scope: null,
      driver_id: null,
      display_name: 'UAT Test Transport',
    },
  ];
}

async function upsertFixedUser(conn, user, hash) {
  if (!FIXED_USERNAMES.includes(user.username)) {
    throw new Error(`Refusing unexpected username ${user.username}`);
  }
  const [existing] = await conn.query(
    'SELECT id, role FROM users WHERE username = ? FOR UPDATE',
    [user.username]
  );
  if (existing.length > 0 && existing[0].role !== user.role) {
    throw new Error(`Refusing to overwrite ${user.username}; existing role=${existing[0].role}`);
  }

  if (existing.length > 0) {
    await conn.query(
      `UPDATE users
          SET password_hash = ?,
              role = ?,
              scope_type = ?,
              scope_id = ?,
              grade_scope = ?,
              display_name = ?,
              driver_id = ?,
              is_active = TRUE,
              must_change_password = FALSE,
              is_deleted = FALSE,
              deleted_at = NULL,
              password_changed_at = NOW()
        WHERE id = ?`,
      [
        hash,
        user.role,
        user.scope_type,
        user.scope_id,
        user.grade_scope,
        user.display_name,
        user.driver_id,
        existing[0].id,
      ]
    );
    return;
  }

  await conn.query(
    `INSERT INTO users
       (username, password_hash, role, scope_type, scope_id, grade_scope,
        display_name, driver_id, is_active, must_change_password, is_deleted,
        password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE, FALSE, NOW())`,
    [
      user.username,
      hash,
      user.role,
      user.scope_type,
      user.scope_id,
      user.grade_scope,
      user.display_name,
      user.driver_id,
    ]
  );
}

async function cleanupUsers(conn) {
  const [result] = await conn.query(
    `UPDATE users
        SET is_active = FALSE,
            is_deleted = TRUE,
            deleted_at = NOW()
      WHERE username IN (${FIXED_USERNAMES.map(() => '?').join(',')})`,
    FIXED_USERNAMES
  );
  return result;
}

async function writeCredentials(credentials, context) {
  const runId = timestampBangkok();
  const outDir = path.join(OUTPUT_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    db_name: process.env.DB_NAME,
    usernames: FIXED_USERNAMES,
    context,
    credentials,
    cleanup_command: `${ALLOW_FLAG}=true node scripts/seed-production-uat-users.js --cleanup`,
    warning: 'Sensitive UAT credentials. Do not commit or share outside the approved UAT team.',
  };
  fs.writeFileSync(path.join(outDir, 'test-users.json'), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(outDir, 'README.md'), readme(payload), { mode: 0o600 });
  return outDir;
}

function readme(payload) {
  const rows = payload.credentials
    .map((item) => `| ${item.username} | ${item.role} | ${item.scope_type || '-'} | ${item.scope_id || '-'} | ${item.grade_scope || '-'} |`)
    .join('\n');
  return `# Production UAT Test Accounts

- Generated: ${payload.generated_at}
- DB: ${payload.db_name}
- Credentials JSON: \`test-users.json\`
- Cleanup: \`${payload.cleanup_command}\`

| Username | Role | Scope Type | Scope ID | Grade |
|---|---|---|---|---|
${rows}

Keep this folder local on the server. Do not commit it.
`;
}

async function firstValue(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  if (!rows.length) return null;
  const first = rows[0];
  return first[Object.keys(first)[0]];
}

function generatePassword() {
  return `UAT-${crypto.randomBytes(12).toString('base64url')}`;
}

function timestampBangkok() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}
