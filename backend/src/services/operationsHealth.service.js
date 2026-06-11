'use strict';

// Phase 10.13B-9 — read-only operations health. Shared by integrity-monitor.js
// (CLI/cron) and GET /admin/operations/health. No business data writes, no PII.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKUP_DIR = '/home/schoolbus/backups/lampang-bus';
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');
const CLEANUP_LOG = '/home/schoolbus/logs/import-cleanup.log';
const DISK_PATH = '/home/schoolbus';
const BACKUP_MAX_AGE_HOURS = 36;

async function computeOperationsHealth(pool) {
  const checks = [];
  const add = (key, label, severity, value, detail) => checks.push({ key, label, severity, value: value ?? null, detail: detail || null });
  const q1 = async (sql) => (await pool.query(sql))[0][0].n;

  // ── Data integrity (DB) ────────────────────────────────────────────────────
  const dupCode = await q1("SELECT COUNT(*) n FROM (SELECT 1 FROM students WHERE COALESCE(is_deleted,0)=0 GROUP BY school_id, student_code HAVING COUNT(*)>1) t");
  add('dup_student_code', 'รหัสนักเรียนซ้ำในโรงเรียนเดียวกัน', dupCode > 0 ? 'CRITICAL' : 'OK', dupCode);
  const missingId = await q1("SELECT COUNT(*) n FROM students WHERE COALESCE(is_deleted,0)=0 AND (school_id IS NULL OR student_code IS NULL OR student_code='')");
  add('students_missing_identity', 'นักเรียนไม่มี school_id/student_code', missingId > 0 ? 'CRITICAL' : 'OK', missingId);
  const orphanAsg = await q1("SELECT COUNT(*) n FROM driver_vehicle_assignments d JOIN vehicles v ON v.id=d.vehicle_id WHERE d.is_active=1 AND v.is_deleted=1");
  add('orphan_assignment', 'งานมอบหมายชี้รถที่ถูกปิดใช้งาน', orphanAsg > 0 ? 'CRITICAL' : 'OK', orphanAsg);
  const dupAsg = await q1("SELECT COUNT(*) n FROM (SELECT 1 FROM driver_vehicle_assignments WHERE is_active=1 GROUP BY vehicle_id HAVING COUNT(*)>1) t");
  add('dup_active_assignment', 'รถมีคนขับที่ใช้งานซ้ำ', dupAsg > 0 ? 'CRITICAL' : 'OK', dupAsg);
  const canonDup = await q1("SELECT COUNT(*) n FROM (SELECT 1 FROM vehicles WHERE active_canonical_plate IS NOT NULL GROUP BY active_canonical_plate HAVING COUNT(*)>1) t");
  add('canonical_vehicle_dup', 'รถทะเบียนซ้ำที่ใช้งานอยู่', canonDup > 0 ? 'CRITICAL' : 'OK', canonDup);

  // ── Driver / vehicle integrity (mostly WARN/INFO) ──────────────────────────
  const vehNoDriver = await q1("SELECT COUNT(*) n FROM vehicles v WHERE v.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments d WHERE d.vehicle_id=v.id AND d.is_active=1)");
  add('vehicle_no_driver', 'รถที่ยังไม่มีคนขับ', vehNoDriver > 0 ? 'WARN' : 'OK', vehNoDriver);
  const unlinked = await q1("SELECT COUNT(*) n FROM users WHERE role='driver' AND COALESCE(is_active,1)=1 AND COALESCE(is_deleted,0)=0 AND driver_id IS NULL");
  add('driver_no_profile', 'คนขับที่ยังไม่ผูกโปรไฟล์', unlinked > 0 ? 'WARN' : 'OK', unlinked);
  const profNoUser = await q1("SELECT COUNT(*) n FROM drivers d WHERE COALESCE(d.is_deleted,0)=0 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.driver_id=d.id AND COALESCE(u.is_active,1)=1 AND COALESCE(u.is_deleted,0)=0)");
  add('profile_no_user', 'โปรไฟล์คนขับที่ไม่มีบัญชีใช้งาน', 'INFO', profNoUser);
  const inactiveDup = await q1("SELECT COUNT(*) n FROM users WHERE role='driver' AND COALESCE(is_active,1)=0 AND COALESCE(is_deleted,0)=0 AND must_change_password=1");
  add('inactive_dup_candidates', 'บัญชีคนขับซ้ำที่ถูกปิดใช้งาน', inactiveDup > 0 ? 'WARN' : 'OK', inactiveDup);
  const blocked24 = await q1("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='user' AND JSON_EXTRACT(new_value,'$.reactivation_blocked')=true AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)");
  add('blocked_reactivation_24h', 'การเปิดใช้งานบัญชีซ้ำที่ถูกบล็อก (24 ชม.)', blocked24 > 0 ? 'WARN' : 'OK', blocked24);

  // ── Import health ──────────────────────────────────────────────────────────
  const allFailed = await q1("SELECT COUNT(*) n FROM import_batches WHERE total_rows>0 AND error_rows>=total_rows AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
  add('import_all_failed_7d', 'การนำเข้าที่ล้มเหลวทั้งชุด (7 วัน)', allFailed > 0 ? 'WARN' : 'OK', allFailed);
  let expiredFiles = 0;
  try { expiredFiles = await q1("SELECT COUNT(*) n FROM import_batches WHERE expires_at IS NOT NULL AND expires_at < NOW() AND stored_file_path IS NOT NULL"); } catch { /* table may lack col */ }
  add('expired_import_files', 'ไฟล์นำเข้าหมดอายุที่รอลบ', expiredFiles > 0 ? 'WARN' : 'OK', expiredFiles);

  // ── Backup (age + sha256 integrity, no shelling) ───────────────────────────
  try {
    const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql.gz')) : [];
    if (!files.length) add('backup', 'สำรองข้อมูลล่าสุด', 'CRITICAL', null, 'no backup found');
    else {
      const latest = files.map((f) => ({ f, m: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
      const ageH = Math.round((Date.now() - latest.m) / 3.6e6);
      const gz = path.join(BACKUP_DIR, latest.f); const sidecar = gz + '.sha256';
      let verified = false;
      if (fs.existsSync(sidecar) && fs.statSync(gz).size < 200 * 1024 * 1024) {
        const want = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
        const got = crypto.createHash('sha256').update(fs.readFileSync(gz)).digest('hex');
        verified = want === got;
      }
      const sev = !verified ? 'CRITICAL' : ageH > BACKUP_MAX_AGE_HOURS ? 'WARN' : 'OK';
      add('backup', 'สำรองข้อมูลล่าสุด', sev, `${ageH}h`, verified ? 'sha256 OK' : 'sha256 mismatch/missing');
    }
  } catch (e) { add('backup', 'สำรองข้อมูลล่าสุด', 'WARN', null, 'check error: ' + e.code); }

  // ── Migration tracking (untracked / checksum drift) ────────────────────────
  try {
    const fileList = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    const [tracked] = await pool.query('SELECT filename, checksum FROM schema_migrations');
    const byName = Object.fromEntries(tracked.map((t) => [t.filename, t.checksum]));
    let untracked = 0, drift = 0;
    for (const f of fileList) {
      const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(MIGRATIONS_DIR, f))).digest('hex');
      if (!(f in byName)) untracked++;
      else if (byName[f] && byName[f] !== sum) drift++;
    }
    add('migration', 'การติดตามไมเกรชัน', drift > 0 ? 'CRITICAL' : untracked > 0 ? 'WARN' : 'OK', `${untracked} untracked / ${drift} drift`);
  } catch (e) { add('migration', 'การติดตามไมเกรชัน', 'WARN', null, 'check error: ' + e.code); }

  // ── Disk usage ─────────────────────────────────────────────────────────────
  try {
    const s = fs.statfsSync ? fs.statfsSync(DISK_PATH) : null;
    if (s) {
      const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      const usedPct = Math.round((1 - free / total) * 100);
      add('disk', 'พื้นที่ดิสก์', usedPct >= 90 ? 'CRITICAL' : usedPct >= 80 ? 'WARN' : 'OK', `${usedPct}%`, `${Math.round(free / 1e9)}GB free`);
    } else add('disk', 'พื้นที่ดิสก์', 'INFO', null, 'statfs unavailable');
  } catch (e) { add('disk', 'พื้นที่ดิสก์', 'INFO', null, 'check error: ' + e.code); }

  // ── Cleanup last-run evidence ──────────────────────────────────────────────
  try {
    const ageH = fs.existsSync(CLEANUP_LOG) ? Math.round((Date.now() - fs.statSync(CLEANUP_LOG).mtimeMs) / 3.6e6) : null;
    add('cleanup', 'ลบไฟล์นำเข้าหมดอายุ (ครั้งล่าสุด)', ageH === null ? 'INFO' : ageH > 48 ? 'WARN' : 'OK', ageH === null ? 'no log' : `${ageH}h`);
  } catch { add('cleanup', 'ลบไฟล์นำเข้าหมดอายุ', 'INFO', null); }

  const rank = { CRITICAL: 2, WARN: 1, OK: 0, INFO: 0 };
  const status = checks.reduce((m, c) => Math.max(m, rank[c.severity] || 0), 0);
  return { status: status === 2 ? 'CRITICAL' : status === 1 ? 'WARN' : 'OK', timestamp: new Date().toISOString(), checks };
}

module.exports = { computeOperationsHealth };
