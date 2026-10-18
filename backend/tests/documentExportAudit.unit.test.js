'use strict';

require('./loadTestEnv');
jest.mock('fs', () => ({
  statSync: jest.fn(() => ({ isFile: () => true, size: 4 })),
  createReadStream: jest.fn(() => require('stream').Readable.from(Buffer.from('%PDF'))),
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 17, role: req.headers['x-test-role'] || 'transport', scopeId: null };
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

test('audit failure prevents the document from being released', async () => {
  logAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  const response = await request(app()).get('/api/documents/vehicle/22/file').set('x-test-role', 'transport');
  expect(response.status).toBe(500);
  expect(fs.createReadStream).not.toHaveBeenCalled();
});
