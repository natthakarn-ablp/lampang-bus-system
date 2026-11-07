'use strict';

// Audit time-05: scripts/refresh-route-baselines.js must compute Bangkok wall
// clock times and a Bangkok SQL window even when the cron host TZ is not
// Asia/Bangkok. DB-free: the database pool is stubbed in a child process.
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'refresh-route-baselines.js');

const HARNESS = `
const Module = require('module');
const out = { inserts: [], windows: [] };
const pings = [0, 1, 2, 3, 4].map((i) => ({
  // 07:0i Bangkok = 00:0i UTC
  recorded_at: new Date(Date.UTC(2026, 10, 4, 0, i, 0)),
}));
const pool = {
  async query(sql, params) {
    if (/SELECT DISTINCT vehicle_id/.test(sql)) { out.windows.push(params); return [[{ vehicle_id: 'V-tz' }]]; }
    if (/FROM geofence_events/.test(sql)) return [[]];
    if (/SELECT recorded_at/.test(sql)) return [pings];
    if (/INSERT INTO route_baselines/.test(sql)) { out.inserts.push(params); return [{}]; }
    return [[]];
  },
  async end() {},
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (/config[\\\\/]database$/.test(request)) return { pool };
  return origLoad.call(this, request, ...rest);
};
process.on('exit', () => { process.stdout.write('\\n@@' + JSON.stringify(out)); });
require(${JSON.stringify(SCRIPT)});
`;

test('baseline start time and window are Bangkok wall clock when process TZ is UTC', () => {
  const run = spawnSync(process.execPath, ['-e', HARNESS], {
    env: { ...process.env, TZ: 'UTC' },
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(run.status).toBe(0);
  const out = JSON.parse(run.stdout.split('@@').pop());

  const morning = out.inserts.filter((p) => p[1] === 'morning');
  expect(morning.length).toBeGreaterThan(0);
  for (const p of morning) expect(p[3]).toBe('07:02:00');

  // Window bounds must be Bangkok SQL datetimes (UTC+7), not the UTC clock.
  const [, to] = out.windows[0];
  const bangkokNow = Date.now() + 7 * 3600 * 1000;
  const toMs = Date.parse(`${to.replace(' ', 'T')}Z`);
  expect(Math.abs(toMs - bangkokNow)).toBeLessThan(120000);
});
