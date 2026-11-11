import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readAdminScope, writeAdminScope, snapshotAdminScopes, restoreAdminScopes, validAdminScope,
} from '../src/utils/adminScope.js';
import { formatThaiCalendarDate } from '../src/utils/thaiTime.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
}

function withStorage(fn) {
  const saved = { local: globalThis.localStorage, session: globalThis.sessionStorage };
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  try { fn(); } finally {
    globalThis.localStorage = saved.local;
    globalThis.sessionStorage = saved.session;
  }
}

test('the admin affiliation/school choice is remembered in localStorage', () => withStorage(() => {
  assert.equal(readAdminScope('affiliation'), '');
  writeAdminScope('affiliation', 7);
  assert.equal(localStorage.getItem('admin_affiliation_id'), '7');
  assert.equal(readAdminScope('affiliation'), '7');
  writeAdminScope('school', '12');
  assert.equal(readAdminScope('school'), '12');
  writeAdminScope('affiliation', '');
  assert.equal(readAdminScope('affiliation'), '');
  assert.equal(localStorage.getItem('admin_affiliation_id'), null);
}));

test('a legacy per-tab sessionStorage choice is still read, then superseded', () => withStorage(() => {
  sessionStorage.setItem('admin_affiliation_id', '3');
  assert.equal(readAdminScope('affiliation'), '3');
  writeAdminScope('affiliation', '5');
  assert.equal(sessionStorage.getItem('admin_affiliation_id'), null);
  assert.equal(readAdminScope('affiliation'), '5');
}));

test('the choice survives a logout that clears localStorage', () => withStorage(() => {
  writeAdminScope('affiliation', '9');
  localStorage.setItem('access_token', 'x');
  const snap = snapshotAdminScopes();
  localStorage.clear();
  restoreAdminScopes(snap);
  assert.equal(readAdminScope('affiliation'), '9');
  assert.equal(localStorage.getItem('access_token'), null);
}));

test('blocked storage never throws and falls back to nothing selected', () => {
  const saved = { local: globalThis.localStorage, session: globalThis.sessionStorage };
  const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  globalThis.localStorage = boom;
  globalThis.sessionStorage = boom;
  try {
    assert.equal(readAdminScope('affiliation'), '');
    assert.doesNotThrow(() => writeAdminScope('affiliation', '1'));
  } finally {
    globalThis.localStorage = saved.local;
    globalThis.sessionStorage = saved.session;
  }
});

test('a remembered id is only kept when it is in the loaded list', () => {
  const list = [{ id: 1, name: 'ก' }, { id: 7, name: 'ข' }];
  assert.equal(validAdminScope('7', list), '7');
  assert.equal(validAdminScope('99', list), '');
  assert.equal(validAdminScope('', list), '');
  assert.equal(validAdminScope('7', null), '');
});

test('AdminScopeSelector labels are Thai and validate the remembered choice', () => {
  const src = readFileSync(new URL('../src/components/AdminScopeSelector.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes('ผู้ดูแลระบบ — เลือกสังกัด:'));
  assert.ok(src.includes('ผู้ดูแลระบบ — เลือกโรงเรียน:'));
  assert.ok(!/Admin —/.test(src));
  assert.ok(src.includes('validAdminScope(affiliationId, affiliations)'));
});

test('report date inputs are echoed as Thai Buddhist-era dates', () => {
  assert.equal(formatThaiCalendarDate('2026-11-11'), '11 พฤศจิกายน 2569');
  assert.equal(formatThaiCalendarDate('2026-11'), 'พฤศจิกายน 2569');
  assert.equal(formatThaiCalendarDate('2026-02-30'), '');
  assert.equal(formatThaiCalendarDate(''), '');
  assert.equal(formatThaiCalendarDate(undefined), '');
  for (const f of ['DailyReport.jsx', 'MonthlyReport.jsx']) {
    const src = readFileSync(new URL(`../src/pages/reports/${f}`, import.meta.url), 'utf8');
    assert.ok(src.includes('formatThaiCalendarDate('), `${f} shows the พ.ศ. date`);
  }
});
