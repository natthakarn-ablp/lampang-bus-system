'use strict';

const { toBangkokDate } = require('./thaiTime');

/**
 * vehicleDates.js — DATE columns must leave a service as calendar dates.
 *
 * mysql2 parses a DATE against the +07:00 connection timezone, so a row stored
 * as 2026-08-05 arrives as a JS Date at 2026-08-04T17:00:00.000Z and
 * JSON.stringify ships exactly that. A client that prints it, slices the first
 * ten characters, or hands it to a date picker reads the day before.
 *
 * This lived in transport.service.js until province and affiliation turned out
 * to have the same gap on the same columns — the fourth and fifth instances of
 * the bug, found by the response-walking assertion in calendarDateShape.test.js
 * once the fixture was given real expiry dates to return. Three copies of the
 * field list was the point at which one shared copy became the safer option.
 *
 * TIMESTAMP columns (created_at, verification_updated_at, checked_at) are
 * genuine instants and are deliberately absent from these lists.
 */

/** DATE columns on vehicles, and the inspection dates joined onto them. */
const VEHICLE_DATE_FIELDS = [
  'insurance_expiry',
  'registration_expiry',
  'compulsory_insurance_expiry',
  'tax_expiry',
  'latest_inspection_date',
  'inspection_expiry',
];

/** DATE columns on vehicle_inspections. */
const INSPECTION_DATE_FIELDS = ['inspection_date', 'expiry_date'];

/**
 * Return a copy of `row` with the named DATE fields as 'YYYY-MM-DD'.
 *
 * Only fields actually present are touched, so the full list can be passed to a
 * query that selects a subset — which is what lets one list serve queries that
 * each return different columns.
 *
 * @param {object|null|undefined} row
 * @param {string[]} fields
 */
function withCalendarDates(row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const field of fields) {
    if (field in out) out[field] = toBangkokDate(out[field]);
  }
  return out;
}

/** The same, for a list of rows. */
function mapCalendarDates(rows, fields) {
  return Array.isArray(rows) ? rows.map((r) => withCalendarDates(r, fields)) : rows;
}

module.exports = {
  VEHICLE_DATE_FIELDS,
  INSPECTION_DATE_FIELDS,
  withCalendarDates,
  mapCalendarDates,
};
