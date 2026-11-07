'use strict';

/**
 * Shared GET handlers for GPS route history (replay), mounted by the admin,
 * province, affiliation and school routers:
 *
 *   GET /api/<role>/vehicles/:vehicleId/track?date=YYYY-MM-DD
 *   GET /api/<role>/vehicles/:vehicleId/track-days[?days=7]
 *
 * Each router passes `resolveScope(req, res)`, which returns the viewer's
 * vehicle scope — the SAME object its /live-vehicles list is built from — or
 * null after it has already sent a 4xx. The vehicle is then looked up with
 * vehicleLocation.findVehicleInScope(); a vehicle outside the scope answers
 * 404 exactly like one that does not exist, so ids cannot be probed.
 *
 * Read-only. Coordinates/time/speed only — no student or driver PII.
 * Audited (VIEW, entity vehicle_track, 5-minute de-dup) because a vehicle's
 * route history is location data about children's journeys.
 */

const env = require('../config/env');
const vllSvc = require('../services/vehicleLocation.service');
const trackSvc = require('../services/vehicleTrack.service');
const { sendSuccess, sendError } = require('../utils/response');
const { describeWindows, configuredWindows } = require('../utils/gpsTrackingWindow');
const { todayBangkok } = require('../utils/thaiTime');

const VEHICLE_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;

function retentionDays() {
  return env.tracking.locationHistoryRetentionDays;
}

async function loadVehicle(req, res, resolveScope) {
  const vehicleId = String(req.params.vehicleId || '');
  if (!VEHICLE_ID_RE.test(vehicleId)) {
    sendError(res, 'รหัสรถไม่ถูกต้อง', [{ field: 'vehicleId', message: 'invalid vehicle id' }], 400);
    return null;
  }
  const scope = resolveScope(req, res);
  if (!scope) return null;
  const vehicle = await vllSvc.findVehicleInScope(vehicleId, scope);
  if (!vehicle) {
    sendError(res, 'ไม่พบรถคันนี้ในขอบเขตที่คุณดูได้', [], 404);
    return null;
  }
  return vehicle;
}

function makeTrackHandlers(resolveScope) {
  const track = async (req, res, next) => {
    try {
      const today = todayBangkok();
      const date = req.query.date == null || req.query.date === '' ? today : String(req.query.date);
      const v = trackSvc.validateDay(date, today, retentionDays());
      if (!v.ok) return sendError(res, v.message, [{ field: 'date', message: v.message }], 400);
      const vehicle = await loadVehicle(req, res, resolveScope);
      if (!vehicle) return undefined;
      const data = await trackSvc.getTrack(vehicle.vehicle_id, date);
      vllSvc.maybeAuditView({
        userId: req.user.id, entityType: 'vehicle_track', entityId: `${vehicle.vehicle_id}:${date}`,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
      return sendSuccess(res, {
        vehicle,
        date,
        timezone: 'Asia/Bangkok',
        retention_days: retentionDays(),
        tracking: describeWindows(configuredWindows()),
        ...data,
      });
    } catch (err) { return next(err); }
  };

  const days = async (req, res, next) => {
    try {
      const max = retentionDays();
      let n = max;
      if (req.query.days != null && req.query.days !== '') {
        if (!/^\d{1,2}$/.test(String(req.query.days))) {
          return sendError(res, 'จำนวนวันไม่ถูกต้อง', [{ field: 'days', message: 'days must be an integer' }], 400);
        }
        n = Math.max(1, Math.min(max, Number(req.query.days)));
      }
      const vehicle = await loadVehicle(req, res, resolveScope);
      if (!vehicle) return undefined;
      const data = await trackSvc.getRecentDays(vehicle.vehicle_id, n);
      return sendSuccess(res, {
        vehicle,
        timezone: 'Asia/Bangkok',
        retention_days: max,
        tracking: describeWindows(configuredWindows()),
        ...data,
      });
    } catch (err) { return next(err); }
  };

  return { track, days };
}

module.exports = { makeTrackHandlers, VEHICLE_ID_RE };
