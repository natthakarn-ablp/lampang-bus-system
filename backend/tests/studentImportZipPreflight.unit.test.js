'use strict';

require('./loadTestEnv');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseImportFile } = require('../src/services/studentImportPreview.service');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-zip-'));
const write = (name, buf) => { const p = path.join(TMP, name); fs.writeFileSync(p, buf); return p; };
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

function fakeZipCentralDirectory({ uncompressedSize, compressedSize = 1 }) {
  const name = Buffer.from('[Content_Types].xml');
  const local = Buffer.alloc(30 + name.length + compressedSize);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(compressedSize, 18);
  local.writeUInt32LE(uncompressedSize, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(compressedSize, 20);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

describe('student import xlsx preflight', () => {
  test('bad ZIP-shaped xlsx returns a controlled 400 instead of leaking an ExcelJS 500', async () => {
    const p = write('bad.xlsx', Buffer.from('PK\x03\x04not a complete xlsx zip'));
    await expect(parseImportFile(p, 'bad.xlsx')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a ZIP whose central directory declares excessive uncompressed size before ExcelJS reads it', async () => {
    const p = write('bomb.xlsx', fakeZipCentralDirectory({ uncompressedSize: 60 * 1024 * 1024 }));
    await expect(parseImportFile(p, 'bomb.xlsx')).rejects.toMatchObject({ statusCode: 400 });
  });
});
