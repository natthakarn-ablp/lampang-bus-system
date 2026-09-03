'use strict';

const mockQuery = jest.fn();
const mockConn = {
  query: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
  release: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  pool: { query: mockQuery, getConnection: jest.fn(() => mockConn) },
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, username: 'admin-test', role: req.headers['x-test-role'] || 'admin' };
    next();
  },
}));
jest.mock('../src/services/lineIdToken.service', () => ({ verifyIdToken: jest.fn() }));
jest.mock('../src/services/line.service', () => ({ sendTextMessage: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const { verifyIdToken } = require('../src/services/lineIdToken.service');
const { sendTextMessage } = require('../src/services/line.service');
const router = require('../src/routes/adminPasswordRecovery.routes');
const {
  generateRecoveryCodes,
  generateResetToken,
  hashRecoveryCode,
  hashResetToken,
  normalizeRecoveryCode,
} = require('../src/utils/recoveryTokens');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/recovery', router);
  app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));
  return app;
}

const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  env.features.adminPasswordRecovery = true;
  env.jwt.secret = 'unit-test-secret-that-is-longer-than-32-characters';
  mockConn.beginTransaction.mockResolvedValue();
  mockConn.commit.mockResolvedValue();
  mockConn.rollback.mockResolvedValue();
  mockConn.release.mockReturnValue();
  mockConn.query.mockResolvedValue({ affectedRows: 1 });
  bcrypt.compare.mockResolvedValue(true);
  bcrypt.hash.mockResolvedValue('$2b$12$new-hash');
  verifyIdToken.mockResolvedValue({ valid: true, userId: 'U-line-admin' });
  sendTextMessage.mockResolvedValue({ sent: true });
});

describe('recovery token helpers', () => {
  test('generates eight unique human-readable one-use codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  test('normalizes code formatting and hashes secrets without retaining plaintext', () => {
    expect(normalizeRecoveryCode('abcd-efgh-2345')).toBe('ABCDEFGH2345');
    expect(hashRecoveryCode('ABCD-EFGH-2345', 'pepper')).toMatch(/^[a-f0-9]{64}$/);
    const token = generateResetToken();
    expect(token).toHaveLength(43);
    expect(hashResetToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashResetToken(token)).not.toContain(token);
  });
});

describe('admin password recovery routes', () => {
  test('feature-disabled config stays visible while protected endpoints stay dark', async () => {
    env.features.adminPasswordRecovery = false;
    const config = await request(app).get('/api/auth/recovery/config');
    expect(config.status).toBe(200);
    expect(config.body.data.admin_password_recovery).toBe(false);
    const status = await request(app).get('/api/auth/recovery/admin/status');
    expect(status.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('only an authenticated admin can manage recovery', async () => {
    const res = await request(app)
      .get('/api/auth/recovery/admin/status')
      .set('x-test-role', 'school');
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('links only the server-verified LINE subject and returns codes once', async () => {
    mockQuery.mockResolvedValueOnce([[
      { id: 7, username: 'admin-test', display_name: 'Admin', password_hash: '$2b$12$old' },
    ]]);
    mockConn.query.mockResolvedValue({ affectedRows: 1 });

    const res = await request(app)
      .post('/api/auth/recovery/admin/link-line')
      .send({ current_password: 'current-secret', id_token: 'signed-line-id-token' });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.recovery_codes).toHaveLength(8);
    expect(verifyIdToken).toHaveBeenCalledWith('signed-line-id-token');
    expect(sendTextMessage).toHaveBeenCalledWith('U-line-admin', expect.stringContaining('กำลังยืนยัน LINE'));
    expect(mockConn.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_recovery_channels'),
      [7, 'U-line-admin']
    );
    const codeInsert = mockConn.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO user_recovery_codes'));
    expect(codeInsert[1][0]).toHaveLength(8);
    expect(codeInsert[1][0][0][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(codeInsert[1][0][0][1]).not.toBe(res.body.data.recovery_codes[0]);
  });

  test('returns the same generic response for an unknown username', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).post('/api/auth/recovery/request').send({ username: 'missing' });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('หากบัญชีนี้เปิดใช้การกู้คืน');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  test('stores only a token hash and sends the raw token in a URL fragment', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 7, display_name: 'Admin', provider_subject: 'U-line-admin' }]])
      .mockResolvedValue([{ affectedRows: 1 }]);
    mockConn.query
      .mockResolvedValueOnce([[{ provider_subject: 'U-line-admin' }]])
      .mockResolvedValue({ affectedRows: 1 });

    const res = await request(app).post('/api/auth/recovery/request').send({ username: 'admin-test' });
    expect(res.status).toBe(200);
    const insert = mockConn.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO password_reset_requests'));
    expect(insert).toBeTruthy();
    expect(insert[1][2]).toMatch(/^[a-f0-9]{64}$/);
    const message = sendTextMessage.mock.calls[0][1];
    expect(message).toContain('/reset-password#token=');
    const rawToken = message.match(/#token=([^\n]+)/)[1];
    expect(insert[1][2]).toBe(hashResetToken(decodeURIComponent(rawToken)));
    expect(JSON.stringify(insert[1])).not.toContain(decodeURIComponent(rawToken));
  });

  test('successful completion consumes token and code and changes the password', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    mockConn.query
      .mockResolvedValueOnce([[
        { id: 'request-1', user_id: 7, failed_attempts: 0, username: 'admin-test', password_hash: '$2b$12$old', provider_subject: 'U-line-admin' },
      ]])
      .mockResolvedValueOnce([[{ id: 91 }]])
      .mockResolvedValue({ affectedRows: 1 });

    const res = await request(app).post('/api/auth/recovery/complete').send({
      token: 'A'.repeat(43),
      recovery_code: 'ABCD-EFGH-2345',
      new_password: 'NewSecurePass#2569',
    });

    expect(res.status).toBe(200);
    expect(mockConn.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET password_hash'),
      ['$2b$12$new-hash', 7]
    );
    expect(mockConn.query).toHaveBeenCalledWith(
      'UPDATE user_recovery_codes SET used_at = NOW() WHERE id = ?', [91]
    );
    expect(mockConn.commit).toHaveBeenCalledTimes(1);
    expect(sendTextMessage).toHaveBeenCalledWith('U-line-admin', expect.stringContaining('เปลี่ยนรหัสผ่าน'));
  });

  test('wrong recovery code increments attempts without changing the password', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    mockConn.query
      .mockResolvedValueOnce([[
        { id: 'request-1', user_id: 7, failed_attempts: 0, username: 'admin-test', password_hash: '$2b$12$old', provider_subject: 'U-line-admin' },
      ]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValue({ affectedRows: 1 });

    const res = await request(app).post('/api/auth/recovery/complete').send({
      token: 'B'.repeat(43), recovery_code: 'WRNG-CODE-0000', new_password: 'NewSecurePass#2569',
    });
    expect(res.status).toBe(400);
    expect(mockConn.query).toHaveBeenCalledWith(expect.stringContaining('failed_attempts + 1'), ['request-1']);
    expect(mockConn.query.mock.calls.some(([sql]) => sql.includes('UPDATE users SET password_hash'))).toBe(false);
    expect(mockConn.commit).toHaveBeenCalledTimes(1);
  });
});
