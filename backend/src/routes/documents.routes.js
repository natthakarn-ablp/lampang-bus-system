'use strict';

/**
 * documents.routes.js — Phase 10.14
 *
 * Authenticated, SCOPED file serving for vehicle/driver supporting-evidence
 * documents. Mounted ONLY when FEATURE_DRIVER_REGISTRATION=true (dark by
 * default) alongside the registration routers. This is a real Express route
 * under /api/..., so it is NOT caught by the /uploads 404 wall in app.js and
 * nginx (which serves the SPA for /uploads) never shadows it.
 *
 *   GET /api/documents/:docType/:id/file   docType ∈ vehicle | driver
 */

const express = require('express');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendError } = require('../utils/response');
const { pool } = require('../config/database');
const { auditExportBeforeSend } = require('../utils/exportAudit');
const { readIdParam } = require('../utils/pathParams');
const checkinSvc = require('../services/checkin.service');
const docSvc = require('../services/driverDocuments.service');

const router = express.Router();
router.use(authenticate, requireRole('driver', 'school', 'transport', 'admin'), requireFullSchoolScope);

function requireFullSchoolScope(req, res, next) {
  if (req.user.role === 'school' && req.user.gradeScope) {
    return sendError(res, 'บัญชีครูประจำสายชั้นดูได้อย่างเดียว ไม่มีสิทธิ์ดำเนินการนี้',
      [{ code: 'FULL_SCHOOL_SCOPE_REQUIRED' }], 403);
  }
  return next();
}

const NOT_FOUND = (res) => sendError(res, 'ไม่พบเอกสาร หรือคุณไม่มีสิทธิ์เข้าถึง', [{ code: 'DOCUMENT_NOT_FOUND' }], 404);

router.get('/:docType/:id/file', async (req, res, next) => {
  try {
    const { docType } = req.params;
    if (docType !== 'vehicle' && docType !== 'driver') return NOT_FOUND(res);

    const id = readIdParam(req, res);
    if (id === null) return;

    // Resolve the driver's active vehicle once (used only by the driver scope
    // branch). Best-effort: a driver with no resolvable vehicle gets null and
    // only sees their own uploads. Other roles don't need it.
    let driverVehicleId = null;
    if (req.user.role === 'driver') {
      try {
        const v = await checkinSvc.getDriverVehicle(pool, req.user);
        driverVehicleId = v ? v.vehicle_id : null;
      } catch { driverVehicleId = null; }
    }

    const viewer = {
      role: req.user.role,
      userId: req.user.id,
      schoolId: req.user.scopeId || null,
      gradeScope: req.user.gradeScope || null,
    };
    const { row, absPath } = await docSvc.resolveDocumentForViewer(pool, {
      docType, id, viewer, driverVehicleId,
    });

    // File on disk gone (deleted out-of-band) → 404, never reveal the path.
    let stat;
    try { stat = fs.statSync(absPath); }
    catch { return NOT_FOUND(res); }
    if (!stat.isFile()) return NOT_FOUND(res);

    // A document contains personal data and leaves the system when viewed.
    // Store the audit row before any response headers or bytes are released.
    // If audit storage is unavailable, fail closed instead of creating an
    // unrecorded sensitive-data access.
    if (!await auditExportBeforeSend(req, res, {
      entityType: docType === 'vehicle' ? 'vehicle_document' : 'driver_document',
      entityId: id,
      metadata: { action: 'view_document', doc_type: row.doc_type },
    })) return;

    // Content-Type: the STORED mime is the CLIENT-DECLARED multipart type, so a
    // polyglot could declare text/html. Uploads are magic-byte-gated to exactly
    // PDF/PNG/JPEG/WebP, so clamp the served type to that safe whitelist — real
    // files still render inline; anything else downgrades to octet-stream (a
    // download, never an inline document). Belt-and-braces with the sandbox CSP.
    const SAFE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
    const served = SAFE_MIME.has(row.mime_type) ? row.mime_type : 'application/octet-stream';
    res.setHeader('Content-Type', served);
    res.setHeader('Content-Length', stat.size);
    const safeName = String(row.original_name || `document-${id}`).replace(/[\r\n"]/g, '');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');

    const stream = fs.createReadStream(absPath);
    stream.on('error', () => { if (!res.headersSent) res.status(404).end(); });
    stream.pipe(res);
  } catch (err) { return next(err); }
});

module.exports = router;
