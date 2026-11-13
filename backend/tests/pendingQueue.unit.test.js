'use strict';

/**
 * pendingQueue.service — approver badges, ค้างนาน, escalation and the cron
 * alert pass. DB-free: a fake db answers each queue's SQL by a marker table.
 */

require('./loadTestEnv');

const DAY = 86400;

let env;
let svc;
beforeAll(() => {
  // Pin flags/thresholds: unit tests on the server run with its .env.
  process.env.FEATURE_DRIVER_REGISTRATION = 'true';
  delete process.env.PENDING_OVERDUE_DAYS;
  delete process.env.PENDING_ESCALATE_DAYS;
  jest.resetModules();
  env = require('../src/config/env');
  env.features.driverRegistration = true;
  svc = require('../src/services/pendingQueue.service');
});

// Rows per queue, keyed by a fragment unique to that queue's FROM clause.
function fakeDb(rowsByQueue, { alerts = [], existing = [] } = {}) {
  const calls = [];
  const marker = {
    transfer_incoming: /NOT \(ss\.affiliation_id <=> ds\.affiliation_id\)/,
    transfer_internal: /AND ss\.affiliation_id <=> ds\.affiliation_id/,
    roster_requests: /FROM roster_change_requests r/,
    registration_review: /FROM inspection_application_schools aps/,
    vehicle_requests: /FROM vehicle_requests q/,
    inspection_waiting: /a\.status IN \('READY_TO_PRINT'/,
    inspection_open_attempts: /FROM inspection_attempts ia\s+JOIN vehicle_inspection_applications a/,
    document_review: /FROM vehicle_documents d/,
  };
  const db = {
    calls,
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM audit_logs/.test(sql) && /target_role/.test(sql)) return [alerts];
      if (/SELECT entity_id FROM audit_logs/.test(sql)) return [existing.map((e) => ({ entity_id: e }))];
      if (/INSERT INTO audit_logs/.test(sql)) return [{ insertId: 1 }];
      for (const [key, re] of Object.entries(marker)) {
        if (re.test(sql)) {
          let rows = rowsByQueue[key] || [];
          if (/WHERE x\.school_id = \?/.test(sql)) rows = rows.filter((r) => String(r.school_id) === String(params[0]));
          if (/WHERE x\.affiliation_id = \?/.test(sql)) rows = rows.filter((r) => String(r.affiliation_id) === String(params[0]));
          return [rows];
        }
      }
      return [[]];
    }),
  };
  return db;
}

const row = (id, days, extra = {}) => ({ item_id: String(id), age_s: days * DAY + 60, ...extra });

describe('getSummary — badges per approver role', () => {
  const data = {
    transfer_incoming: [row(1, 1, { school_id: 'S1', affiliation_id: 'A1', from_school: 'โรงเรียนต้นทาง' })],
    roster_requests: [
      row(11, 4, { school_id: 'S1', affiliation_id: 'A1', request_type: 'add', plate_no: 'กข-1' }),
      row(12, 8, { school_id: 'S1', affiliation_id: 'A1', request_type: 'remove', plate_no: 'กข-1' }),
      row(13, 9, { school_id: 'S2', affiliation_id: 'A2', request_type: 'add', plate_no: 'กข-2' }),
    ],
    transfer_internal: [row(21, 10, { school_id: 'S1', affiliation_id: 'A1', school_name: 'ก', to_school: 'ข' })],
    vehicle_requests: [row(31, 2, { school_id: 'S1', affiliation_id: 'A1', request_type: 'ADD_MISSING_VEHICLE', plate: 'กข 9' })],
    inspection_waiting: [row(41, 8, { school_id: 'S1', affiliation_id: 'A1', plate_no: 'กข-1', request_no: 'VIA-1' })],
  };

  test('school sees only its own queues, with ค้างนาน counts', async () => {
    const out = await svc.getSummary(fakeDb(data), { role: 'school', scopeId: 'S1' });
    const byKey = Object.fromEntries(out.queues.map((q) => [q.key, q]));
    expect(Object.keys(byKey).sort()).toEqual(['registration_review', 'roster_requests', 'transfer_incoming']);
    expect(byKey.roster_requests).toMatchObject({ count: 2, overdue: 2, oldest_days: 8, link: '/school/approvals' });
    expect(byKey.transfer_incoming).toMatchObject({ count: 1, overdue: 0 });
    expect(out.total).toBe(3);
    expect(out.overdue_total).toBe(2);
    expect(out.escalated.count).toBe(0);
  });

  test('a grade teacher gets an empty badge (cannot decide any queue)', async () => {
    const db = fakeDb(data);
    const out = await svc.getSummary(db, { role: 'school', scopeId: 'S1', gradeScope: 'ป.1' });
    expect(out.total).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('affiliation: own queues + school items waiting ≥7 days in its area', async () => {
    const out = await svc.getSummary(fakeDb(data), { role: 'affiliation', scopeId: 'A1' }, { detail: true });
    expect(out.queues.map((q) => q.key).sort()).toEqual(['transfer_internal', 'vehicle_requests']);
    expect(out.escalated.count).toBe(1); // roster #12 (8 days) — #11 is 4 days, #13 is another area
    expect(out.escalated.items[0]).toMatchObject({ queue: 'roster_requests', item_id: '12', escalated: true });
    expect(out.total).toBe(3);
  });

  test('province: affiliation + transport items waiting ≥7 days, nothing of its own', async () => {
    const out = await svc.getSummary(fakeDb(data), { role: 'province', scopeId: null }, { detail: true });
    expect(out.queues).toEqual([]);
    expect(out.escalated.items.map((i) => `${i.queue}#${i.item_id}`).sort())
      .toEqual(['inspection_waiting#41', 'transfer_internal#21']);
  });

  test('transport sees the inspection queues', async () => {
    const out = await svc.getSummary(fakeDb(data), { role: 'transport' });
    expect(out.queues.map((q) => q.key)).toEqual(['inspection_waiting', 'inspection_open_attempts', 'document_review']);
    expect(out.queues[0]).toMatchObject({ count: 1, overdue: 1, link: '/transport/verification' });
  });

  test('item titles carry no student names', async () => {
    const out = await svc.getSummary(fakeDb(data), { role: 'school', scopeId: 'S1' }, { detail: true });
    const titles = out.queues.flatMap((q) => q.items.map((i) => i.title));
    expect(titles).toEqual(expect.arrayContaining(['ขอนำนักเรียนออก · รถ กข-1', 'ย้ายเข้าจาก โรงเรียนต้นทาง']));
  });

  test('in-app alerts are shown only while the item is still waiting', async () => {
    const alerts = [
      { id: 5, entity_id: 'pq:RR:12:O', created_at: '2026-11-10', new_value: JSON.stringify({ kind: 'OVERDUE', queue: 'roster_requests', item_id: '12' }) },
      { id: 4, entity_id: 'pq:RR:99:O', created_at: '2026-11-09', new_value: { kind: 'OVERDUE', queue: 'roster_requests', item_id: '99' } },
    ];
    const db = fakeDb(data, { alerts });
    const out = await svc.getSummary(db, { role: 'school', scopeId: 'S1' });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]).toMatchObject({ id: 5, queue: 'roster_requests', item_id: '12', kind: 'OVERDUE' });
    const alertCall = db.calls.find((c) => /target_role/.test(c.sql));
    expect(alertCall.params).toEqual(['pending_alert', 'school', 'S1']);
  });
});

describe('targetsFor — who is told', () => {
  const q = (key) => svc.QUEUES.find((x) => x.key === key);
  test('school item escalates to its affiliation', () => {
    expect(svc.targetsFor(q('roster_requests'), { school_id: 'S1', affiliation_id: 'A1' }))
      .toEqual({ approver: { role: 'school', scopeId: 'S1' }, escalate: { role: 'affiliation', scopeId: 'A1' } });
  });
  test('school with no affiliation escalates straight to province', () => {
    expect(svc.targetsFor(q('roster_requests'), { school_id: 'S1', affiliation_id: null }).escalate)
      .toEqual({ role: 'province', scopeId: null });
  });
  test('affiliation and transport items escalate to province', () => {
    expect(svc.targetsFor(q('vehicle_requests'), { school_id: 'S1', affiliation_id: 'A1' }))
      .toEqual({ approver: { role: 'affiliation', scopeId: 'A1' }, escalate: { role: 'province', scopeId: null } });
    expect(svc.targetsFor(q('inspection_waiting'), { school_id: 'S1', affiliation_id: 'A1' }).approver)
      .toEqual({ role: 'transport', scopeId: null });
  });
});

describe('runOnce — cron pass', () => {
  const data = {
    roster_requests: [
      row(11, 1, { school_id: 'S1', affiliation_id: 'A1', request_type: 'add' }),
      row(12, 4, { school_id: 'S1', affiliation_id: 'A1', request_type: 'add' }),
      row(13, 8, { school_id: 'S1', affiliation_id: 'A1', request_type: 'add' }),
    ],
    inspection_waiting: [row(41, 9, { school_id: 'S1', affiliation_id: 'A1', plate_no: 'x' })],
  };

  test('one OVERDUE per item ≥3 days, one ESCALATED per item ≥7 days', async () => {
    const db = fakeDb(data);
    const r = await svc.runOnce({ db });
    expect(r.created.map((c) => `${c.key}>${c.target.role}:${c.target.scopeId}`).sort()).toEqual([
      'pq:IW:41:E>province:null',
      'pq:IW:41:O>transport:null',
      'pq:RR:12:O>school:S1',
      'pq:RR:13:E>affiliation:A1',
      'pq:RR:13:O>school:S1',
    ]);
    const inserts = db.calls.filter((c) => /INSERT INTO audit_logs/.test(c.sql));
    expect(inserts).toHaveLength(5);
    // stored scope for province/transport is '' so the badge query can match it
    const iw = inserts.map((c) => JSON.parse(c.params[5])).find((v) => v.queue === 'inspection_waiting' && v.kind === 'ESCALATED');
    expect(iw).toMatchObject({ target_role: 'province', target_scope_id: '' });
  });

  test('idempotent: existing keys are not written again', async () => {
    const db = fakeDb(data, { existing: ['pq:RR:12:O', 'pq:RR:13:O', 'pq:RR:13:E', 'pq:IW:41:O'] });
    const r = await svc.runOnce({ db });
    expect(r.created.map((c) => c.key)).toEqual(['pq:IW:41:E']);
    expect(r.skipped_existing).toBe(4);
  });

  test('--dry-run writes nothing', async () => {
    const db = fakeDb(data);
    const r = await svc.runOnce({ db, dryRun: true });
    expect(r.created).toHaveLength(5);
    expect(db.calls.some((c) => /INSERT INTO audit_logs/.test(c.sql))).toBe(false);
  });

  test('thresholds are configurable and escalate never precedes overdue', () => {
    process.env.PENDING_OVERDUE_DAYS = '5';
    process.env.PENDING_ESCALATE_DAYS = '2';
    expect(svc.thresholds()).toEqual({ overdueDays: 5, escalateDays: 5 });
    delete process.env.PENDING_OVERDUE_DAYS;
    delete process.env.PENDING_ESCALATE_DAYS;
    expect(svc.thresholds()).toEqual({ overdueDays: 3, escalateDays: 7 });
  });

  test('dedupe keys fit audit_logs.entity_id (50 chars)', () => {
    const q = svc.QUEUES.find((x) => x.key === 'registration_review');
    expect(svc.alertKey(q, '123456789:SCH0001', 'ESCALATED').length).toBeLessThanOrEqual(50);
  });
});
