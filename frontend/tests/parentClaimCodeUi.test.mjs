import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// M3 one-time LINE bind codes (parent audit 2026-11-08).
const link = readFileSync(new URL('../src/pages/parent/ParentLink.jsx', import.meta.url), 'utf8');
const school = readFileSync(new URL('../src/pages/school/StudentSearch.jsx', import.meta.url), 'utf8');

test('bind form asks the backend whether school codes are on', () => {
  assert.match(link, /\/api\/parent\/line\/bind-config/);
  assert.match(link, /\{bindConfig\.claim_code_enabled && \(/);
});

test('bind form sends claim_code on preview and confirm when used', () => {
  const sends = link.match(/\.\.\.\(usingClaim \? \{ claim_code: claimCode\.trim\(\) \} : \{\}\)/g) || [];
  assert.equal(sends.length, 2);
});

test('school list issues codes only for full school accounts with the flag on', () => {
  assert.match(school, /!isTeacher && claimEnabled && \(/);
  assert.match(school, /\/school\/students\/\$\{studentId\}\/claim-code/);
  assert.match(school, /api\.post\('\/school\/claim-codes', body\)/);
});

test('printed slips escape names and tell the parent the rules', () => {
  assert.match(school, /const esc = \(v\) =>/);
  assert.match(school, /ใช้ได้ครั้งเดียว/);
});
