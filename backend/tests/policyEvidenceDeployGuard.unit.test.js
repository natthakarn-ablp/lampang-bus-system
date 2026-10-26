'use strict';

/**
 * Migrations 052 + 053 boot guard (src/index.js).
 *
 * /api/policy-notices is mounted unconditionally and reads/writes
 * policy_acknowledgements (052) and policy_action_evidence (053).
 * deploy-backend.sh does not apply migrations, so a build that reaches a
 * database without them must refuse to start rather than serve 500s.
 *
 * Unlike sharedStateDeployGuard.unit.test.js, this boots the real index.js
 * with the database, env and Express app replaced, so both directions are
 * executed rather than read from the source text:
 *   - both tables present   -> the app starts listening, no exit
 *   - either table missing  -> FATAL naming it, process.exit(1), never listens
 *   - the probe itself fails -> warn and keep booting (same rule as 051)
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

describe('migration 052/053 boot guard', () => {
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
    // A real exit stops start() where it is called. Throwing on the first call
    // reproduces that; start().catch() then calls exit again, which is let through.
    let exited = false;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      if (exited) return undefined;
      exited = true;
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

  it('starts normally when both tables exist', async () => {
    const { listen, query } = bootIndex();
    await settle();

    const probed = query.mock.calls.some(([, params]) => POLICY_TABLES.every((t) => (params || []).includes(t)));
    expect(probed).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(/Policy evidence check passed/);
  });

  it.each([
    [['policy_acknowledgements']],
    [['policy_action_evidence']],
    [POLICY_TABLES],
  ])('refuses to start when %j is missing', async (missing) => {
    const { listen } = bootIndex({ missing });
    await settle();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const fatal = errorSpy.mock.calls.flat().join('\n');
    expect(fatal).toMatch(/FATAL: this build requires migrations 052 and 053/);
    for (const t of missing) expect(fatal).toContain(t);
    expect(fatal).toMatch(/052_policy_acknowledgements\.sql/);
    expect(fatal).toMatch(/053_policy_action_evidence\.sql/);
    expect(exitSpy.mock.calls[0]).toEqual([1]);
    // "never listens" is what proves the guard sits before app.listen.
    expect(listen).not.toHaveBeenCalled();
  });

  it('only warns when the probe itself fails, like the 051 guard', async () => {
    const { listen } = bootIndex({ probeError: new Error('information_schema denied') });
    await settle();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join('\n')).toMatch(/could not verify policy-evidence migration presence/);
    expect(listen).toHaveBeenCalledTimes(1);
  });
});
