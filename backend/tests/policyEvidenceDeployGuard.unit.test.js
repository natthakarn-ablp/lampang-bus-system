'use strict';

/**
 * Migrations 052 + 053 at boot (src/index.js).
 *
 * Whether 052/053 are on production is unconfirmed and the policy-notice
 * feature is not core work, so a missing table must NOT stop the app. This
 * boots the real index.js with the database, env and Express app replaced and
 * checks all three outcomes of the table probe:
 *   - both tables present    -> listens, no exit, says so
 *   - a table missing        -> listens, no exit, warns naming the table(s)
 *   - the probe itself fails -> listens, no exit, warns that it could not check
 */

const POLICY_TABLES = ['policy_acknowledgements', 'policy_action_evidence'];

function bootIndex({ missing = [], probeError = null } = {}) {
  const listen = jest.fn((port, host, cb) => { if (cb) cb(); return { close: (done) => done && done() }; });
  const query = jest.fn(async (sql, params = []) => {
    if (/information_schema\.tables/.test(sql)) {
      const asked = params.slice(1);
      if (probeError && asked.some((t) => POLICY_TABLES.includes(t))) throw probeError;
      return [asked.filter((t) => !missing.includes(t)).map((t) => ({ table_name: t }))];
    }
    return [[]];
  });

  jest.resetModules();
  jest.doMock('../src/config/database', () => ({
    testConnection: jest.fn(async () => {}),
    pool: { query, end: jest.fn(async () => {}) },
  }));
  jest.doMock('../src/config/env', () => ({
    db: { name: 'lampang_bus_test' },
    app: { port: 0, nodeEnv: 'test' },
    // every flag-gated guard stays a no-op; only the unconditional ones run
    features: {},
  }));
  jest.doMock('../src/app', () => ({ listen }));
  jest.doMock('../src/services/term.service', () => ({ getCurrentTerm: jest.fn(async () => null) }));

  jest.isolateModules(() => { require('../src/index'); });
  return { listen, query };
}

// start() is async and not exported; let its awaited probes settle.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('migration 052/053 check at boot never stops the app', () => {
  let exitSpy;
  let errorSpy;
  let warnSpy;
  let logSpy;
  const signalListeners = {};

  beforeEach(() => {
    // index.js registers process-wide handlers on load; remember what was there
    // so each boot's handlers can be removed again.
    for (const evt of ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException']) {
      signalListeners[evt] = process.listeners(evt).slice();
    }
    // A real exit would stop start(); throwing reproduces that so an exit
    // anywhere in the boot path shows up as "never listened".
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [evt, before] of Object.entries(signalListeners)) {
      for (const fn of process.listeners(evt)) if (!before.includes(fn)) process.removeListener(evt, fn);
    }
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('tables present: starts and reports them present', async () => {
    const { listen, query } = bootIndex();
    await settle();

    const probed = query.mock.calls.some(([, params]) => POLICY_TABLES.every((t) => (params || []).includes(t)));
    expect(probed).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(/Policy-notice tables present/);
  });

  it.each([
    [['policy_acknowledgements']],
    [['policy_action_evidence']],
    [POLICY_TABLES],
  ])('tables missing (%j): still starts, warns, never exits', async (missing) => {
    const { listen } = bootIndex({ missing });
    await settle();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
    const warning = warnSpy.mock.calls.flat().join('\n');
    expect(warning).toMatch(/policy-notice tables missing/);
    for (const t of missing) expect(warning).toContain(t);
    expect(warning).toMatch(/503/);
    expect(warning).toMatch(/052_policy_acknowledgements\.sql/);
    expect(warning).toMatch(/053_policy_action_evidence\.sql/);
  });

  it('probe fails: still starts and warns that it could not check', async () => {
    const { listen } = bootIndex({ probeError: new Error('information_schema denied') });
    await settle();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.flat().join('\n')).toMatch(/could not verify policy-notice tables/);
  });
});
