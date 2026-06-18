'use strict';

/**
 * lineBindAudit.test.js — Phase 10.13C-4A
 *
 * ISOLATED — mocks ONLY the MySQL pool and loads the REAL line.service.auditBind to
 * prove the audit row never contains a raw phone number or id_token. Run with an
 * isolated jest config (no globalSetup):
 *   npx jest --config '{"testEnvironment":"node"}' --testPathPattern lineBind --runInBand
 */

const mockQuery = jest.fn().mockResolvedValue([{}]);
jest.mock('../src/config/database', () => ({ pool: { query: mockQuery } }));

const lineSvc = require('../src/services/line.service');

const RAW_PHONE = '0811112222';

beforeEach(() => mockQuery.mockClear());

test('auditBind masks the phone and never writes the raw phone or a token', async () => {
  await lineSvc.auditBind({
    sub: 'Uparentparentparentparentparen01',
    phone: RAW_PHONE,
    studentCode: '21199',
    action: 'LINE_BIND_PREVIEW_FAILED',
    reason: 'CREDENTIAL_MISMATCH',
    ip: '203.0.113.9',
    ua: 'Mozilla/5.0',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('INSERT INTO line_message_logs');
  expect(params[1]).toBe('LINE_BIND_PREVIEW_FAILED'); // message_text = action
  expect(params[2]).toBe('CREDENTIAL_MISMATCH');       // result = reason

  const detail = JSON.parse(params[3]);
  expect(detail.masked_phone).toBe('081****222');
  expect(detail.student_code).toBe('21199');
  // ip/ua/sub are short fingerprints, never raw.
  expect(detail.ip_fp).toMatch(/^[a-f0-9]{12}$/);
  expect(detail.ua_fp).toMatch(/^[a-f0-9]{12}$/);
  expect(detail.sub_fp).toMatch(/^[a-f0-9]{12}$/);

  // No raw PII / token anywhere in the persisted row.
  const serialized = JSON.stringify(params);
  expect(serialized).not.toContain(RAW_PHONE);
  expect(serialized).not.toContain('203.0.113.9');
  expect(serialized).not.toContain('Mozilla/5.0');
});

test('auditBind swallows DB errors (audit must never break the bind flow)', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  await expect(lineSvc.auditBind({ phone: RAW_PHONE, action: 'LINE_BIND_LOCKED', reason: 'LOCKED_PAIR' })).resolves.toBeUndefined();
});
