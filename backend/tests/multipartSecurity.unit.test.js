'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const express = require('express'), multer = require('multer'), request = require('supertest');
const { multipartLimits } = require('../src/utils/multipartLimits');
const errorHandler = require('../src/middleware/errorHandler');

// Do not send parser regression payloads to an old/uncapped parser.
const [major, minor] = require('multer/package.json').version.split('.').map(Number);
if (major < 2 || (major === 2 && minor < 4)) throw new Error('Patched multipart parser required for safe regression fixtures');
const limits = multipartLimits(64);
if (!Number.isFinite(limits.fieldArrayIndexLimit) || limits.fieldArrayIndexLimit > 32 || limits.fieldNestingDepth !== 4) {
  throw new Error('Bounded multipart field limits required before parser fixtures');
}

let directory, app;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schoolbus-multipart-fixture-'));
  const upload = multer({ dest: directory, limits });
  app = express();
  app.post('/upload', upload.single('file'), (req, res) => {
    const file = req.file;
    const bytes = file ? fs.readFileSync(file.path).toString('hex') : null;
    if (file) fs.unlinkSync(file.path);
    res.json({ size: file?.size, bytes, fields: req.body,
      filename: file ? Buffer.from(file.originalname, 'latin1').toString('utf8') : null });
  });
  app.get('/storage-error', (_req, _res, next) => next(Object.assign(new Error('synthetic disk error'), { code: 'EIO' })));
  app.get('/unknown-upload-error', (_req, _res, next) => next(Object.assign(new Error('synthetic unknown upload fault'), { name: 'MulterError', code: 'UNKNOWN_STORAGE_FAULT' })));
  app.use(errorHandler);
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test.each(['csv', 'xlsx', 'pdf', 'jpg'])('preserves %s upload bytes and flat metadata', async extension => {
  const bytes = Buffer.from('synthetic-' + extension);
  const result = await request(app).post('/upload').field('doc_type', 'synthetic')
    .field('auto_create_vehicle', 'false').attach('file', bytes, 'fixture.' + extension);
  expect(result.status).toBe(200);
  expect(result.body.bytes).toBe(bytes.toString('hex'));
  expect(result.body.fields).toEqual({ doc_type: 'synthetic', auto_create_vehicle: 'false' });
  expect(fs.readdirSync(directory)).toEqual([]);
});
test('preserves Thai multipart filename decoding used by student import', async () => {
  const result = await request(app).post('/upload').attach('file', Buffer.from('fixture'), 'ทดสอบ.csv');
  expect(result.status).toBe(200);
  expect(result.body.filename).toBe('ทดสอบ.csv');
});
test('accepts the exact file-size cap and rejects one byte over it without leaving a disk file', async () => {
  expect((await request(app).post('/upload').attach('file', Buffer.alloc(64), 'fixture.csv')).status).toBe(200);
  const over = await request(app).post('/upload').attach('file', Buffer.alloc(65), 'fixture.csv');
  expect(over.status).toBe(413);
  expect(over.body.errors).toEqual([{ code: 'LIMIT_FILE_SIZE' }]);
  expect(fs.readdirSync(directory)).toEqual([]);
});
test.each([
  ['items[4294967294]', 'LIMIT_FIELD_ARRAY_INDEX'],
  ['items[a][b][c][d][e]', 'LIMIT_FIELD_NESTING'],
])('rejects %s before field expansion and remains responsive', async (field, code) => {
  const result = await request(app).post('/upload').field(field, 'synthetic');
  expect(result.status).toBe(400);
  expect(result.body.errors).toEqual([{ code }]);
  expect(JSON.stringify(result.body)).not.toContain(field);
  expect((await request(app).post('/upload').field('doc_type', 'synthetic')).status).toBe(200);
});
test('removes an already-written file when a later malformed field aborts the request', async () => {
  const result = await request(app).post('/upload').attach('file', Buffer.from('synthetic'), 'fixture.csv')
    .field('items[4294967294]', 'synthetic');
  expect(result.status).toBe(400);
  expect(fs.readdirSync(directory)).toEqual([]);
});
test.each(['/storage-error', '/unknown-upload-error'])('retains server-fault classification for %s', async endpoint => {
  expect((await request(app).get(endpoint)).status).toBe(500);
});
test('cleans the partial disk file after a client aborts mid-upload', async () => {
  const http = require('http');
  const upload = multer({ dest: directory, limits: multipartLimits(1024 * 1024) });
  const abortedApp = express();
  abortedApp.post('/upload', upload.single('file'), (_req, res) => res.end());
  abortedApp.use(errorHandler);
  const server = abortedApp.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const body = '--fixture\r\nContent-Disposition: form-data; name="file"; filename="fixture.csv"\r\nContent-Type: text/csv\r\n\r\n' + 'x'.repeat(1024);
  const client = http.request({ host: '127.0.0.1', port: server.address().port, path: '/upload', method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=fixture', 'Content-Length': Buffer.byteLength(body) + 2048 } });
  client.on('error', () => {}); // Expected ECONNRESET after intentional abort.
  const waitUntil = async condition => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Synthetic upload lifecycle timed out');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    client.write(body);
    await waitUntil(() => fs.readdirSync(directory).length === 1);
    client.destroy();
    await waitUntil(() => fs.readdirSync(directory).length === 0);
  } finally {
    client.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
