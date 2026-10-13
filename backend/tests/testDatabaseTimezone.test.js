'use strict';
const { getTestConnection, getTestPool } = require('./dbHelper');
const { todayBangkok } = require('../src/utils/thaiTime');

describe('test fixtures share application Bangkok SQL sessions', () => {
  test('single connection agrees on current date and a fixed midnight boundary', async () => {
    const conn = await getTestConnection();
    try {
      const [[row]] = await conn.query("SELECT @@session.time_zone AS zone, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS current_date_th, DATE_FORMAT(CONVERT_TZ('2026-10-13 17:30:00', '+00:00', @@session.time_zone), '%Y-%m-%d') AS boundary_date");
      expect(row.zone).toBe('+07:00');
      expect(row.current_date_th).toBe(todayBangkok());
      expect(row.boundary_date).toBe('2026-10-14');
    } finally { await conn.end(); }
  });
  test('each fresh pooled connection gets the same Bangkok session', async () => {
    const pool = getTestPool({ connectionLimit: 2 });
    let first, second;
    try {
      first = await pool.getConnection(); second = await pool.getConnection();
      for (const conn of [first, second]) {
        const [[row]] = await conn.query('SELECT @@session.time_zone AS zone');
        expect(row.zone).toBe('+07:00');
      }
    } finally {
      if (first) first.release(); if (second) second.release();
      await pool.end();
    }
  });
});
