'use strict';

require('./loadTestEnv');
jest.mock('fs', () => ({
  statSync: jest.fn(() => ({ isFile: () => true, size: 4 })),
  createReadStream: jest.fn(() => require('stream').Readable.from(Buffer.from('%PDF'))),
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 17,
      role: req.headers['x-test-role'] || 'transport',
      scopeId: req.headers['x-test-school'] || null,
      gradeScope: req.headers['x-test-grade'] || null,
    };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: {} }));
jest.mock('../src/services/checkin.service', () => ({ getDriverVehicle: jest.fn() }));
jest.mock('../src/services/driverDocuments.service', () => ({
  resolveDocumentForViewer: jest.fn().mockResolvedValue({
    row: { doc_type: 'VEHICLE_REGISTRATION', mime_type: 'application/pdf', original_name: 'vehicle.pdf' },
    absPath: '/safe/vehicle.pdf',
  }),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { Readable } = require('stream');
const fs = require('fs');
const { logAudit } = require('../src/utils/audit');
const { resolveDocumentForViewer } = require('../src/services/driverDocuments.service');
const errorHandler = require('../src/middleware/errorHandler');

function app() {
  const instance = express();
  instance.use('/api/documents', require('../src/routes/documents.routes'));
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  logAudit.mockResolvedValue();
  fs.statSync.mockReturnValue({ isFile: () => true, size: 4 });
  fs.createReadStream.mockImplementation(() => Readable.from(Buffer.from('%PDF')));
});

test('transport document view waits for a required audit before streaming bytes', async () => {
  const response = await request(app()).get('/api/documents/vehicle/22/file').set('x-test-role', 'transport');
  expect(response.status).toBe(200);
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    userId: 17, action: 'EXPORT', entityType: 'vehicle_document', entityId: '22', required: true,
  }));
  expect(logAudit.mock.invocationCallOrder[0]).toBeLessThan(fs.createReadStream.mock.invocationCallOrder[0]);
});

test('grade-scoped school account is denied before document lookup or file access', async () => {
  const response = await request(app())
    .get('/api/documents/vehicle/22/file')
    .set({ 'x-test-role': 'school', 'x-test-school': 'SCH1', 'x-test-grade': 'G4' });

  expect(response.status).toBe(403);
  expect(response.body.errors[0].code).toBe('FULL_SCHOOL_SCOPE_REQUIRED');
  expect(resolveDocumentForViewer).not.toHaveBeenCalled();
  expect(fs.statSync).not.toHaveBeenCalled();
  expect(fs.createReadStream).not.toHaveBeenCalled();
  expect(logAudit).not.toHaveBeenCalled();
});

test('full-school account keeps access to scoped documents', async () => {
  const response = await request(app())
    .get('/api/documents/vehicle/22/file')
    .set({ 'x-test-role': 'school', 'x-test-school': 'SCH1' });

  expect(response.status).toBe(200);
  expect(resolveDocumentForViewer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    viewer: expect.objectContaining({ role: 'school', schoolId: 'SCH1', gradeScope: null }),
  }));
});

test('audit failure prevents the document from being released', async () => {
  logAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  const response = await request(app()).get('/api/documents/vehicle/22/file').set('x-test-role', 'transport');
  expect(response.status).toBe(500);
  expect(fs.createReadStream).not.toHaveBeenCalled();
});
