'use strict';

/**
 * geofence.routes.js — Phase 11A (2026-06-23)
 *
 * Geofence CRUD + event log. Mounted at /api/geofences when
 * FEATURE_GEOFENCE=true.
 *
 *   GET    /api/geofences                    — list geofences (admin)
 *   POST   /api/geofences                    — create geofence (admin)
 *   GET    /api/geofences/events/list        — recent events (admin / province)
 *   POST   /api/geofences/seed-defaults      — seed default geofences (admin)
 *   GET    /api/geofences/:id                — get one geofence (admin)
 *   PUT    /api/geofences/:id                — update geofence (admin)
 *   DELETE /api/geofences/:id                — soft-delete geofence (admin)
 *
 * RBAC: admin only for CRUD; admin + province for event log (read-only).
 *
 * Route order matters: static paths (/events/list, /seed-defaults) are
 * registered BEFORE the /:id wildcard so Express matches them first.
 */

const express = require('express');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const { readIdParam } = require('../utils/pathParams');
const env = require('../config/env');
const gfSvc = require('../services/geofence.service');

router.use(authenticate);

// ─── Static paths (registered before /:id) ───────────────────────────────────

// GET /api/geofences/events/list  (admin + province)
router.get('/events/list', requireRole('admin', 'province'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const vehicleId = req.query.vehicle_id || null;
    const geofenceId = req.query.geofence_id || null;
    const events = await gfSvc.listEvents({ vehicleId, geofenceId, limit, offset });
    return sendSuccess(res, events);
  } catch (err) { return next(err); }
});

// POST /api/geofences/seed-defaults  (admin only)
router.post('/seed-defaults', requireRole('admin'), async (req, res, next) => {
  try {
    const seededPickup = await gfSvc.seedDefaultsForPickupPoints();
    const seededSchool = await gfSvc.seedDefaultsForSchools();
    return sendSuccess(
      res,
      { pickup_points: seededPickup, schools: seededSchool },
      `สร้างจุดเตือนภัยเริ่มต้นแล้ว (${seededPickup} จุดรับ-ส่ง + ${seededSchool} โรงเรียน)`
    );
  } catch (err) { return next(err); }
});

// ─── CRUD (admin only) ───────────────────────────────────────────────────────
router.use(requireRole('admin'));

// GET /api/geofences
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.name, g.target_type, g.target_id, g.vehicle_id,
              g.center_lat, g.center_lng, g.radius_meters, g.trigger_on,
              g.notify_roles, g.is_active, g.created_at, g.updated_at,
              v.plate_no
         FROM geofences g
         LEFT JOIN vehicles v ON v.id = g.vehicle_id
        ORDER BY g.is_active DESC, g.name`
    );
    return sendSuccess(res, rows);
  } catch (err) { return next(err); }
});

// POST /api/geofences
router.post('/', async (req, res, next) => {
  try {
    const {
      name, target_type, target_id, vehicle_id,
      center_lat, center_lng, radius_meters, trigger_on, notify_roles,
    } = req.body || {};

    if (!name || !target_type || center_lat == null || center_lng == null) {
      return sendError(res, 'กรุณาระบุ name, target_type, center_lat, center_lng', [], 400);
    }
    if (!['SCHOOL', 'PICKUP_POINT', 'DEPOT'].includes(target_type)) {
      return sendError(res, 'target_type ไม่ถูกต้อง', [], 400);
    }
    if (trigger_on && !['ENTER', 'EXIT', 'BOTH'].includes(trigger_on)) {
      return sendError(res, 'trigger_on ไม่ถูกต้อง', [], 400);
    }

    // Phase 11A audit fix C2/H4: validate coordinates + radius
    const lat = parseFloat(center_lat);
    const lng = parseFloat(center_lng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return sendError(res, 'พิกัดไม่ถูกต้อง (ละติจูด: -90 ถึง 90, ลองจิจูด: -180 ถึง 180)', [], 400);
    }
    const radius = radius_meters != null ? parseInt(radius_meters, 10) : env.tracking.geofenceDefaultRadiusM;
    if (isNaN(radius) || radius <= 0 || radius > 50000) {
      return sendError(res, 'รัศมีต้องเป็นตัวเลขบวก (1-50000 เมตร)', [], 400);
    }
    // Phase 11A audit fix M4: validate notify_roles
    if (notify_roles) {
      const validRoles = ['parent', 'school', 'province', 'admin'];
      const roles = String(notify_roles).split(',').map((r) => r.trim()).filter(Boolean);
      const invalid = roles.filter((r) => !validRoles.includes(r));
      if (invalid.length) {
        return sendError(res, `notify_roles ไม่ถูกต้อง: ${invalid.join(', ')}`, [], 400);
      }
    }

    const [result] = await pool.query(
      `INSERT INTO geofences
         (name, target_type, target_id, vehicle_id,
          center_lat, center_lng, radius_meters, trigger_on, notify_roles,
          is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [
        name,
        target_type,
        target_id || null,
        vehicle_id || null,
        lat,
        lng,
        radius,
        trigger_on || 'BOTH',
        notify_roles || 'parent,school',
        req.user.id,
      ]
    );
    const geofenceId = result.insertId;

    await logAudit({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'geofence',
      entityId: String(geofenceId),
      newValue: { name, target_type, target_id, vehicle_id, radius_meters },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { id: geofenceId }, 'สร้างจุดเตือนภัยแล้ว', null, 201);
  } catch (err) { return next(err); }
});

// GET /api/geofences/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res);
    if (id === null) return;
    const [[row]] = await pool.query(
      `SELECT g.*, v.plate_no
         FROM geofences g
         LEFT JOIN vehicles v ON v.id = g.vehicle_id
        WHERE g.id = ?`,
      [id]
    );
    if (!row) return sendError(res, 'ไม่พบจุดเตือนภัย', [], 404);
    return sendSuccess(res, row);
  } catch (err) { return next(err); }
});

// PUT /api/geofences/:id
router.put('/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res);
    if (id === null) return;

    const allowed = [
      'name', 'target_type', 'target_id', 'vehicle_id',
      'center_lat', 'center_lng', 'radius_meters', 'trigger_on',
      'notify_roles', 'is_active',
    ];
    const updates = {};
    for (const k of allowed) {
      if (req.body && req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length) {
      return sendError(res, 'ไม่มีฟิลด์ที่ต้องแก้ไข', [], 400);
    }

    // Phase 11A audit fix C2/H4/M4: validate updateable fields
    if (updates.center_lat != null) {
      const lat = parseFloat(updates.center_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return sendError(res, 'ละติจูดไม่ถูกต้อง (-90 ถึง 90)', [], 400);
      }
      updates.center_lat = lat;
    }
    if (updates.center_lng != null) {
      const lng = parseFloat(updates.center_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return sendError(res, 'ลองจิจูดไม่ถูกต้อง (-180 ถึง 180)', [], 400);
      }
      updates.center_lng = lng;
    }
    if (updates.radius_meters != null) {
      const r = parseInt(updates.radius_meters, 10);
      if (isNaN(r) || r <= 0 || r > 50000) {
        return sendError(res, 'รัศมีต้องเป็นตัวเลขบวก (1-50000 เมตร)', [], 400);
      }
      updates.radius_meters = r;
    }
    if (updates.target_type != null && !['SCHOOL', 'PICKUP_POINT', 'DEPOT'].includes(updates.target_type)) {
      return sendError(res, 'target_type ไม่ถูกต้อง', [], 400);
    }
    if (updates.trigger_on != null && !['ENTER', 'EXIT', 'BOTH'].includes(updates.trigger_on)) {
      return sendError(res, 'trigger_on ไม่ถูกต้อง', [], 400);
    }
    if (updates.notify_roles != null) {
      const validRoles = ['parent', 'school', 'province', 'admin'];
      const roles = String(updates.notify_roles).split(',').map((r) => r.trim()).filter(Boolean);
      const invalid = roles.filter((r) => !validRoles.includes(r));
      if (invalid.length) {
        return sendError(res, `notify_roles ไม่ถูกต้อง: ${invalid.join(', ')}`, [], 400);
      }
    }

    const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const [r] = await pool.query(
      `UPDATE geofences SET ${setClause} WHERE id = ?`,
      [...Object.values(updates), id]
    );
    if (r.affectedRows === 0) return sendError(res, 'ไม่พบจุดเตือนภัย', [], 404);

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE',
      entityType: 'geofence',
      entityId: String(id),
      newValue: updates,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { id }, 'แก้ไขจุดเตือนภัยแล้ว');
  } catch (err) { return next(err); }
});

// DELETE /api/geofences/:id (soft-delete via is_active=FALSE)
router.delete('/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res);
    if (id === null) return;
    const [r] = await pool.query(
      `UPDATE geofences SET is_active = FALSE WHERE id = ?`,
      [id]
    );
    if (r.affectedRows === 0) return sendError(res, 'ไม่พบจุดเตือนภัย', [], 404);

    await logAudit({
      userId: req.user.id,
      action: 'DELETE',
      entityType: 'geofence',
      entityId: String(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { id }, 'ปิดใช้งานจุดเตือนภัยแล้ว');
  } catch (err) { return next(err); }
});

module.exports = router;
