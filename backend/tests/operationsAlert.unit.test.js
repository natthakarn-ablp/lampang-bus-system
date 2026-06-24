'use strict';

const { deliverOperationsAlert } = require('../src/services/operationsAlert.service');

describe('deliverOperationsAlert', () => {
  const originalFetch = global.fetch;
  const originalAbortSignal = global.AbortSignal;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.AbortSignal = { timeout: jest.fn(() => ({ aborted: false })) };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.AbortSignal = originalAbortSignal;
    delete process.env.ALERT_LINE_WEBHOOK_URL;
  });

  test('does not deliver when disabled or report is OK', async () => {
    await expect(deliverOperationsAlert({ status: 'OK', checks: [] }, { webhookUrl: 'https://alerts.example.test/hook' }))
      .resolves.toEqual({ delivered: false, reason: 'not_actionable' });
    await expect(deliverOperationsAlert({ status: 'WARN', checks: [] }, { webhookUrl: '' }))
      .resolves.toEqual({ delivered: false, reason: 'disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('posts one bounded alert for warning and critical checks', async () => {
    const result = await deliverOperationsAlert({
      status: 'CRITICAL',
      timestamp: '2026-06-22T00:00:00.000Z',
      checks: [
        { key: 'database', severity: 'CRITICAL', label: 'ฐานข้อมูล', value: 'down' },
        { key: 'backup', severity: 'WARN', label: 'สำรองข้อมูลล่าสุด', value: 'missing' },
        { key: 'disk', severity: 'OK', label: 'พื้นที่ดิสก์', value: '40%' },
      ],
    }, { webhookUrl: 'https://alerts.example.test/hook' });

    expect(result).toEqual({ delivered: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://alerts.example.test/hook');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const payload = JSON.parse(options.body);
    expect(payload.text).toContain('Lampang Bus: CRITICAL');
    expect(payload.text).toContain('CRITICAL ฐานข้อมูล: down');
    expect(payload.text).toContain('WARN สำรองข้อมูลล่าสุด: missing');
    expect(payload.text).not.toContain('พื้นที่ดิสก์');
    expect(payload.text.length).toBeLessThanOrEqual(1800);
  });

  test('redacts obvious secrets and phone-like values from alert text', async () => {
    await deliverOperationsAlert({
      status: 'WARN',
      checks: [
        { severity: 'WARN', label: 'token leaked', value: 'LINE_TOKEN=abc123' },
        { severity: 'WARN', label: 'phone', value: '0891234567' },
      ],
    }, { webhookUrl: 'https://alerts.example.test/hook' });

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.text).not.toMatch(/abc123|0891234567|token/i);
    expect(payload.text).toMatch(/\[redacted\]/i);
  });

  test('throws when the webhook rejects the alert', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(deliverOperationsAlert({
      status: 'WARN',
      checks: [{ severity: 'WARN', label: 'ฐานข้อมูล', value: 'down' }],
    }, { webhookUrl: 'https://alerts.example.test/hook' })).rejects.toThrow(/alert HTTP 503/);
  });
});
