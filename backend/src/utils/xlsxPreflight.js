'use strict';

const fs = require('fs');

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const MAX_XLSX_ENTRIES = 2000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_COMPRESSION_RATIO = 100;

function badImportFile(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

function findEocd(buf) {
  const start = Math.max(0, buf.length - MAX_EOCD_SEARCH);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function assertSafeXlsxZip(filePath, opts = {}) {
  const maxEntries = opts.maxEntries || MAX_XLSX_ENTRIES;
  const maxUncompressedBytes = opts.maxUncompressedBytes || MAX_XLSX_UNCOMPRESSED_BYTES;
  const maxCompressionRatio = opts.maxCompressionRatio || MAX_XLSX_COMPRESSION_RATIO;
  let buf;
  try { buf = fs.readFileSync(filePath); }
  catch { throw badImportFile('ไฟล์ Excel ไม่ถูกต้อง กรุณาอัปโหลดใหม่'); }

  if (buf.length < 22) throw badImportFile('ไฟล์ Excel ไม่ถูกต้องหรือเสียหาย กรุณาบันทึกเป็น .xlsx ใหม่');
  const eocd = findEocd(buf);
  if (eocd < 0) throw badImportFile('ไฟล์ Excel ไม่ถูกต้องหรือเสียหาย กรุณาบันทึกเป็น .xlsx ใหม่');

  const entriesInDir = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (entriesInDir === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw badImportFile('ไฟล์ Excel ใหญ่หรือซับซ้อนเกินไป กรุณาแบ่งไฟล์แล้วอัปโหลดใหม่');
  }
  if (centralOffset + centralSize > buf.length || centralOffset < 0) {
    throw badImportFile('ไฟล์ Excel ไม่ถูกต้องหรือเสียหาย กรุณาบันทึกเป็น .xlsx ใหม่');
  }

  let offset = centralOffset;
  let entries = 0;
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  const end = centralOffset + centralSize;
  while (offset < end) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw badImportFile('ไฟล์ Excel ไม่ถูกต้องหรือเสียหาย กรุณาบันทึกเป็น .xlsx ใหม่');
    }
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw badImportFile('ไฟล์ Excel ใหญ่หรือซับซ้อนเกินไป กรุณาแบ่งไฟล์แล้วอัปโหลดใหม่');
    }
    entries += 1;
    compressedBytes += compressed;
    uncompressedBytes += uncompressed;
    if (entries > maxEntries || uncompressedBytes > maxUncompressedBytes) {
      throw badImportFile('ไฟล์ Excel มีขนาดภายในใหญ่เกินไป กรุณาแบ่งไฟล์แล้วอัปโหลดใหม่');
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  if (offset !== end || entries !== entriesInDir) {
    throw badImportFile('ไฟล์ Excel ไม่ถูกต้องหรือเสียหาย กรุณาบันทึกเป็น .xlsx ใหม่');
  }
  const ratio = compressedBytes > 0 ? uncompressedBytes / compressedBytes : (uncompressedBytes > 0 ? Infinity : 0);
  if (uncompressedBytes > 1024 * 1024 && ratio > maxCompressionRatio) {
    throw badImportFile('ไฟล์ Excel มีอัตราบีบอัดผิดปกติ กรุณาแบ่งไฟล์แล้วอัปโหลดใหม่');
  }
  return { entries, compressedBytes, uncompressedBytes };
}

async function readWorkbookSafely(workbook, filePath) {
  assertSafeXlsxZip(filePath);
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    throw badImportFile('ไฟล์ Excel ไม่ถูกต้องหรือเสียหาย กรุณาบันทึกเป็น .xlsx ใหม่');
  }
}

module.exports = { assertSafeXlsxZip, readWorkbookSafely };
