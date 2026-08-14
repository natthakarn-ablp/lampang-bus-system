'use strict';

/**
 * schoolScope.unit.test.js
 *
 * "Different schools must not see each other's data" (#1) is enforced at the
 * TOP of every /api/school request by two pure resolvers in school.routes.js:
 *   • resolveSchoolId(req)   — a school user ALWAYS reads its own JWT scopeId
 *                              and can never name another school's id; only
 *                              admin may target a specific school.
 *   • resolveGradeScope(req) — a teacher is pinned to its own grade; an admin
 *                              may probe a grade only if it passes the canonical
 *                              whitelist (blocks arbitrary ?grade= injection).
 * Plus isScopeAllowed() from roleGuard (a pure same-scope check).
 *
 * These decide which school_id/grade reaches the service WHERE clauses, so they
 * are the decisive isolation units. DB-free; requiring the router is safe
 * because mysql2 createPool is lazy (no socket until a query fires).
 *
 * NOTE (documented gap): isScopeAllowed is exported + pure but is currently
 * UNUSED in src/ — real school routes isolate via resolveSchoolId instead. The
 * test still locks its contract in case it is wired in later.
 */

const { resolveSchoolId, resolveGradeScope } = require('../src/routes/school.routes');
const { isScopeAllowed } = require('../src/middleware/roleGuard');

const req = (user, query = {}, body = {}) => ({ user, query, body });

describe('resolveSchoolId — cross-school isolation linchpin', () => {
  test('school user reads its own scopeId and IGNORES a spoofed ?school_id', () => {
    const r = req({ role: 'school', scopeId: 'SCH0001' }, { school_id: 'SCH0002' });
    expect(resolveSchoolId(r)).toBe('SCH0001');
  });

  test('school user IGNORES a spoofed body.school_id too', () => {
    const r = req({ role: 'school', scopeId: 'SCH0001' }, {}, { school_id: 'SCH0002' });
    expect(resolveSchoolId(r)).toBe('SCH0001');
  });

  test('school user with null scope resolves to null (→ handler 403s, never sees another school)', () => {
    const r = req({ role: 'school', scopeId: null }, { school_id: 'SCH0002' });
    expect(resolveSchoolId(r)).toBeNull();
  });

  test('admin may target a school via ?school_id', () => {
    expect(resolveSchoolId(req({ role: 'admin' }, { school_id: 'SCH0002' }))).toBe('SCH0002');
  });

  test('admin may target a school via body.school_id when no query', () => {
    expect(resolveSchoolId(req({ role: 'admin' }, {}, { school_id: 'SCH0003' }))).toBe('SCH0003');
  });

  test('admin with neither → null (list-all)', () => {
    expect(resolveSchoolId(req({ role: 'admin' }, {}, {}))).toBeNull();
  });
});

describe('resolveGradeScope — per-grade teacher pin + admin whitelist guard', () => {
  test('teacher is pinned to its JWT gradeScope', () => {
    expect(resolveGradeScope(req({ role: 'school', gradeScope: 'ป.1' }))).toBe('ป.1');
  });

  test('teacher CANNOT widen via ?grade= (query ignored for non-admin)', () => {
    const r = req({ role: 'school', gradeScope: 'ป.1' }, { grade: 'ป.6' });
    expect(resolveGradeScope(r)).toBe('ป.1');
  });

  test('full-school account (no gradeScope) → null (sees all grades)', () => {
    expect(resolveGradeScope(req({ role: 'school', gradeScope: null }))).toBeNull();
  });

  test('admin may probe a grade via ?grade= when canonical', () => {
    expect(resolveGradeScope(req({ role: 'admin' }, { grade: 'ป.2' }))).toBe('ป.2');
  });

  test('admin may probe via ?grade_scope= when canonical', () => {
    expect(resolveGradeScope(req({ role: 'admin' }, { grade_scope: 'ม.3' }))).toBe('ม.3');
  });

  test('admin ?grade= that is NOT canonical → null (blocks arbitrary grade injection)', () => {
    expect(resolveGradeScope(req({ role: 'admin' }, { grade: 'ป.7' }))).toBeNull();
    expect(resolveGradeScope(req({ role: 'admin' }, { grade: "ป.4' OR 1=1" }))).toBeNull();
  });

  test('any other role → null', () => {
    expect(resolveGradeScope(req({ role: 'province' }, { grade: 'ป.1' }))).toBeNull();
    expect(resolveGradeScope(req({ role: 'affiliation' }, { grade: 'ป.1' }))).toBeNull();
  });
});

describe('isScopeAllowed (pure same-scope check; currently unused in src/)', () => {
  test('matching scope → true, foreign scope → false', () => {
    expect(isScopeAllowed({ user: { role: 'school', scopeId: 'SCH0001' } }, 'SCH0001')).toBe(true);
    expect(isScopeAllowed({ user: { role: 'school', scopeId: 'SCH0001' } }, 'SCH0002')).toBe(false);
  });

  test('affiliation scope isolation', () => {
    expect(isScopeAllowed({ user: { role: 'affiliation', scopeId: 'AFF001' } }, 'AFF002')).toBe(false);
  });

  test('province + admin bypass scope', () => {
    expect(isScopeAllowed({ user: { role: 'province', scopeId: 'LPG' } }, 'SCH0002')).toBe(true);
    expect(isScopeAllowed({ user: { role: 'admin', scopeId: null } }, 'SCH0002')).toBe(true);
  });

  test('coerces resourceScopeId to string before comparing', () => {
    expect(isScopeAllowed({ user: { role: 'school', scopeId: '5' } }, 5)).toBe(true);
  });
});
