'use strict';

/**
 * The report exports write as they read instead of building the whole file first.
 *
 * WHAT WAS WRONG
 * --------------
 * /export/csv loaded every row into an array and then concatenated the entire
 * file into one string before res.send — the dataset in memory twice. /export/excel
 * built the whole workbook in memory and wrote it at the end. The query behind
 * them has no LIMIT, and at province scope it is every student in the province.
 *
 * WHAT THESE TESTS ACTUALLY CHECK
 * -------------------------------
 * "Does not buffer" is not directly observable from a test, so asserting it
 * would be theatre. What is observable, and what would really break:
 *
 *   - the bytes changed. The CSV is compared against the buffered implementation
 *     built from getExportRows, which is still exported and still the oracle.
 *   - the xlsx stopped being a valid workbook. Streaming writers are easy to get
 *     subtly wrong (an uncommitted header row, shared strings), so the file is
 *     read back with exceljs rather than merely checked for size.
 *   - a connection leaked. Streaming borrows a pool connection for the length of
 *     the response, which the buffered version never did.
 *   - a mid-stream failure produced a complete-looking file. This is the one
 *     that matters most: after the first byte there is no way to send an error,
 *     and a truncated CSV opens fine and quietly omits students.
 */

require('dotenv').config();
const http = require('http');
const request = require('supertest');
const ExcelJS = require('exceljs');

const app = require('../src/app');
const { pool } = require('../src/config/database');
const reportSvc = require('../src/services/report.service');
const { csvCell } = require('../src/utils/exportSecurity');
const { abbreviateGrade } = require('../src/utils/gradeDisplay');

const USER = { username: '__test_province', password: 'testpass123' };
const DATE = '2026-08-28';

let token = '';

/** The pre-change implementation, kept here as the oracle for the bytes. */
function bufferedCsv(headers, rows) {
  let csv = '﻿' + headers.join(',') + '\n';
  for (const r of rows) {
    csv += [
      csvCell(r.student_id),
      csvCell(r.student_name),
      csvCell(abbreviateGrade(r.grade)),
      csvCell(r.classroom || ''),
      csvCell(r.school_name),
      csvCell(r.affiliation_name),
      csvCell(r.plate_no),
      csvCell(r.morning_service),
      csvCell(r.evening_service),
      csvCell(r.morning_status),
      csvCell(r.morning_time || ''),
      csvCell(r.evening_status),
      csvCell(r.evening_time || ''),
    ].join(',') + '\n';
  }
  return csv;
}

const freeConnections = () => pool.pool._freeConnections.length;
const allConnections = () => pool.pool._allConnections.length;
// src/config/database.js
const POOL_LIMIT = 10;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/login').send(USER);
  expect(`login -> ${res.status}`).toBe('login -> 200');
  token = res.body.data.access_token;
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('report exports stream instead of buffering', () => {
  it('produces byte-identical CSV to the buffered implementation', async () => {
    const res = await get(`/api/reports/export/csv?date=${DATE}`);
    expect(`csv -> ${res.status}`).toBe('csv -> 200');

    const { rows } = await reportSvc.getExportRows(
      { id: 1, role: 'province', scopeId: 'LPG' }, { date: DATE }
    );
    const headerLine = res.text.split('\n')[0].replace(/^﻿/, '');
    const expected = bufferedCsv(headerLine.split(','), rows);

    expect(`bytes: ${Buffer.byteLength(res.text)}`).toBe(`bytes: ${Buffer.byteLength(expected)}`);
    expect(res.text).toBe(expected);
  });

  it('keeps the UTF-8 BOM, so Excel still opens Thai correctly', async () => {
    const res = await get(`/api/reports/export/csv?date=${DATE}`);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="report-${DATE}.csv"`);
  });

  it('writes an xlsx that exceljs can read back, header styling intact', async () => {
    const res = await get(`/api/reports/export/excel?date=${DATE}`).buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(`excel -> ${res.status}`).toBe('excel -> 200');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const sheet = workbook.getWorksheet('รายงานประจำวัน');
    expect(`sheet found: ${!!sheet}`).toBe('sheet found: true');

    const header = sheet.getRow(1);
    expect(String(header.getCell(1).value)).toBeTruthy();
    expect(`header bold: ${!!(header.font && header.font.bold)}`).toBe('header bold: true');

    const { rows } = await reportSvc.getExportRows(
      { id: 1, role: 'province', scopeId: 'LPG' }, { date: DATE }
    );
    // rowCount includes the header row.
    expect(`data rows: ${sheet.rowCount - 1}`).toBe(`data rows: ${rows.length}`);
  });

  it('returns its pool connection after every export', async () => {
    // Streaming holds a connection for the whole length of the response, which
    // the buffered version never did, so a missing release shows up only here.
    //
    // Not asserted: that the connection count stops growing. The pool adds
    // connections whenever requests overlap — an export holds one while the
    // fire-and-forget audit write and the auth middleware use others — and that
    // is timing-dependent, so pinning it produced a test that passed alone and
    // failed inside the full suite.
    //
    // What a leak actually does is unmistakable: one connection is consumed per
    // export and never returned, so by the 11th of these the pool of 10 is
    // exhausted and the request hangs until the jest timeout. Twenty exports
    // that all answer, with idle connections left over, cannot happen if any of
    // them kept its connection.
    const EXPORTS = 20;
    for (let i = 0; i < EXPORTS; i += 1) {
      const res = await get(`/api/reports/export/csv?date=${DATE}`);
      expect(`export ${i} -> ${res.status}`).toBe(`export ${i} -> 200`);
    }
    // Not "in use === 0": logAudit is deliberately fire-and-forget, so its
    // INSERT can still be on a connection when the response has already
    // finished. That is a connection in use, not a connection lost.
    expect(`pool exhausted: ${freeConnections() === 0 && allConnections() >= POOL_LIMIT}`)
      .toBe('pool exhausted: false');
    expect(`idle connections available: ${freeConnections() > 0}`)
      .toBe('idle connections available: true');
  }, 30000);

  it('does not strand a connection when an export is aborted', async () => {
    // The abort path destroys the connection instead of releasing it, because a
    // connection handed back mid-result would give the next borrower these rows.
    // Destroying removes it from the pool, so the count may drop — what must not
    // happen is a connection stuck checked out.
    const rowsFor = await reportSvc.getExportRows(
      { id: 1, role: 'province', scopeId: 'LPG' }, { date: DATE }
    );
    const spy = jest.spyOn(reportSvc, 'streamExportRows').mockImplementation(async function* fail() {
      yield rowsFor.rows[0];
      throw new Error('simulated mid-stream database failure');
    });
    try {
      await get(`/api/reports/export/csv?date=${DATE}`).catch(() => null);
    } finally {
      spy.mockRestore();
    }

    // The pool still serves requests afterwards, which it could not do if the
    // connection were checked out forever.
    for (let i = 0; i < 3; i += 1) {
      expect((await get(`/api/reports/export/csv?date=${DATE}`)).status).toBe(200);
    }
    expect(`idle connections available: ${freeConnections() > 0}`)
      .toBe('idle connections available: true');
  });

  it('aborts the response when the row stream fails partway, rather than sending a short file', async () => {
    const rowsFor = await reportSvc.getExportRows(
      { id: 1, role: 'province', scopeId: 'LPG' }, { date: DATE }
    );
    expect(`fixture has rows: ${rowsFor.rows.length > 0}`).toBe('fixture has rows: true');

    const spy = jest.spyOn(reportSvc, 'streamExportRows').mockImplementation(async function* fail() {
      yield rowsFor.rows[0];
      throw new Error('simulated mid-stream database failure');
    });

    let outcome;
    try {
      const res = await get(`/api/reports/export/csv?date=${DATE}`);
      // A 200 whose body is a well-formed CSV missing most of its rows is the
      // failure this test exists to prevent.
      outcome = `completed with ${res.status} and ${res.text.split('\n').length - 1} lines`;
    } catch (err) {
      outcome = 'aborted';
    } finally {
      spy.mockRestore();
    }

    expect(outcome).toBe('aborted');
  });

  it('sends the first rows before the last row is read', async () => {
    // The one assertion here that a buffered implementation cannot satisfy.
    // supertest resolves only on the complete body, so this uses a real socket
    // and times the first data event against the end of the response. With the
    // file built up front, nothing reaches the client until every row is read,
    // and the two timestamps collapse together.
    const rowsFor = await reportSvc.getExportRows(
      { id: 1, role: 'province', scopeId: 'LPG' }, { date: DATE }
    );
    const slowRow = rowsFor.rows[0];
    const DELAY_MS = 400;

    const spy = jest.spyOn(reportSvc, 'streamExportRows').mockImplementation(async function* slow() {
      yield slowRow;
      await new Promise((r) => setTimeout(r, DELAY_MS));
      yield slowRow;
    });

    const server = http.createServer(app).listen(0);
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();

    try {
      const timing = await new Promise((resolve, reject) => {
        const started = Date.now();
        const req = http.get({
          host: '127.0.0.1', port, path: `/api/reports/export/csv?date=${DATE}`,
          headers: { Authorization: `Bearer ${token}` },
        }, (res) => {
          let firstByteAt = null;
          res.on('data', () => { if (firstByteAt === null) firstByteAt = Date.now(); });
          res.on('end', () => resolve({
            status: res.statusCode,
            ttfb: firstByteAt - started,
            total: Date.now() - started,
          }));
        });
        req.on('error', reject);
      });

      expect(`status ${timing.status}`).toBe('status 200');
      // Half the injected delay is a wide margin: streamed, the header and first
      // row go out immediately; buffered, the gap would be near zero.
      const streamed = timing.total - timing.ttfb > DELAY_MS / 2;
      expect(`first byte ${timing.total - timing.ttfb}ms before the end: ${streamed}`)
        .toBe(`first byte ${timing.total - timing.ttfb}ms before the end: true`);
    } finally {
      spy.mockRestore();
      await new Promise((r) => server.close(r));
    }
  });

  it('still answers JSON for an error raised before the first byte', async () => {
    const spy = jest.spyOn(reportSvc, 'exportRowsQuery').mockImplementation(() => {
      const err = new Error('bad filter');
      err.statusCode = 400;
      throw err;
    });
    try {
      const res = await get(`/api/reports/export/csv?date=${DATE}`);
      expect(`status ${res.status}, json: ${/json/.test(res.headers['content-type'] || '')}`)
        .toBe('status 400, json: true');
    } finally {
      spy.mockRestore();
    }
  });
});
