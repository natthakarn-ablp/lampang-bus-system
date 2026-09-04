'use strict';

/**
 * `POST /api/reports/decision-log` writes into audit_logs, an append-only
 * table, and its rows are the only structured evidence that a report informed
 * a decision. Before this validation it accepted any decision_type, any note
 * length and any report_date from any reporting role.
 */

const {
  DECISION_TYPES,
  DECISION_REPORT_TYPES,
  DECISION_LOG_ROLES,
  DECISION_NOTE_MAX,
  validateDecisionLog,
} = require('../src/utils/decisionLog');

const ok = { decision_type: 'info_only', report_type: 'daily', report_date: '2026-09-04' };

describe('decision log allowlists', () => {
  it('keeps decision types closed so they can be aggregated', () => {
    expect(DECISION_TYPES).toEqual(['follow_up', 'action_needed', 'info_only', 'escalate']);
    for (const t of DECISION_TYPES) {
      expect(validateDecisionLog({ ...ok, decision_type: t, decision_note: 'เหตุผล' }).error).toBeUndefined();
    }
  });

  it('rejects a decision type outside the allowlist', () => {
    const r = validateDecisionLog({ ...ok, decision_type: 'whatever_i_typed' });
    expect(r.error).toMatch(/decision_type/);
    expect(r.value).toBeUndefined();
  });

  it('rejects a missing or non-string decision type', () => {
    expect(validateDecisionLog({ report_type: 'daily', report_date: '2026-09-04' }).error).toMatch(/decision_type/);
    expect(validateDecisionLog({ ...ok, decision_type: 42 }).error).toMatch(/decision_type/);
    expect(validateDecisionLog({ ...ok, decision_type: ['follow_up'] }).error).toMatch(/decision_type/);
  });

  it('rejects a report type outside the allowlist', () => {
    expect(DECISION_REPORT_TYPES).toEqual(['daily', 'monthly', 'summary', 'policy']);
    expect(validateDecisionLog({ ...ok, report_type: 'anything' }).error).toMatch(/report_type/);
  });

  it('restricts the endpoint to roles whose decisions the framework counts', () => {
    expect(DECISION_LOG_ROLES).toEqual(['province', 'admin']);
    expect(DECISION_LOG_ROLES).not.toContain('school');
    expect(DECISION_LOG_ROLES).not.toContain('affiliation');
  });
});

describe('decision log date validation', () => {
  it('requires a real calendar date for date-addressed reports', () => {
    expect(validateDecisionLog({ ...ok, report_date: '2026-02-30' }).error).toMatch(/YYYY-MM-DD/);
    expect(validateDecisionLog({ ...ok, report_date: '2026-13-01' }).error).toMatch(/YYYY-MM-DD/);
    expect(validateDecisionLog({ ...ok, report_date: 'unknown' }).error).toMatch(/YYYY-MM-DD/);
    expect(validateDecisionLog({ ...ok, report_date: '' }).error).toMatch(/YYYY-MM-DD/);
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(validateDecisionLog({ ...ok, report_date: '2024-02-29' }).error).toBeUndefined();
    expect(validateDecisionLog({ ...ok, report_date: '2026-02-29' }).error).toMatch(/YYYY-MM-DD/);
  });

  it('addresses monthly reports by month, not by day', () => {
    expect(validateDecisionLog({ ...ok, report_type: 'monthly', report_date: '2026-09' }).error).toBeUndefined();
    expect(validateDecisionLog({ ...ok, report_type: 'monthly', report_date: '2026-09-04' }).error).toMatch(/YYYY-MM/);
    expect(validateDecisionLog({ ...ok, report_type: 'monthly', report_date: '2026-13' }).error).toMatch(/YYYY-MM/);
  });
});

describe('decision log note rules', () => {
  it('caps the note so an append-only table cannot be used as free storage', () => {
    const tooLong = 'ก'.repeat(DECISION_NOTE_MAX + 1);
    expect(validateDecisionLog({ ...ok, decision_note: tooLong }).error).toMatch(String(DECISION_NOTE_MAX));
    const atLimit = 'ก'.repeat(DECISION_NOTE_MAX);
    expect(validateDecisionLog({ ...ok, decision_note: atLimit }).error).toBeUndefined();
  });

  it('requires a reason when a decision claims action or escalation', () => {
    expect(validateDecisionLog({ ...ok, decision_type: 'action_needed' }).error).toMatch(/decision_note/);
    expect(validateDecisionLog({ ...ok, decision_type: 'escalate', decision_note: '   ' }).error).toMatch(/decision_note/);
    expect(validateDecisionLog({ ...ok, decision_type: 'escalate', decision_note: 'ส่งต่อผู้บังคับบัญชา' }).error).toBeUndefined();
  });

  it('allows an empty note for informational decisions', () => {
    expect(validateDecisionLog({ ...ok, decision_type: 'info_only' }).error).toBeUndefined();
    expect(validateDecisionLog({ ...ok, decision_type: 'follow_up', decision_note: null }).error).toBeUndefined();
  });

  it('normalises the accepted payload', () => {
    const r = validateDecisionLog({
      decision_type: '  follow_up  ',
      report_type: ' daily ',
      report_date: ' 2026-09-04 ',
      decision_note: '  ติดตามผลสัปดาห์หน้า  ',
    });
    expect(r.error).toBeUndefined();
    expect(r.value).toEqual({
      decisionType: 'follow_up',
      reportType: 'daily',
      reportDate: '2026-09-04',
      note: 'ติดตามผลสัปดาห์หน้า',
    });
  });

  it('does not throw on a missing or non-object body', () => {
    expect(validateDecisionLog(undefined).error).toBeTruthy();
    expect(validateDecisionLog(null).error).toBeTruthy();
    expect(validateDecisionLog({}).error).toBeTruthy();
  });
});
