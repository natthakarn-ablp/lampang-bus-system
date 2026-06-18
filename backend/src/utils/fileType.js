'use strict';

/**
 * Content-based (magic-byte) file-type detection.
 *
 * Audit 2026-06-18 (fileupload-import): uploads were validated by file extension
 * only, the import accepted .xls (OLE2) which ExcelJS cannot parse (→ unhandled
 * 500), and driver photos accepted any extension. Sniffing the leading bytes lets
 * each endpoint enforce what it actually supports, regardless of the filename.
 *
 * All helpers take a Buffer (e.g. multer's file.buffer or fs.readFileSync).
 */

function startsWith(buf, bytes) {
  if (!Buffer.isBuffer(buf) || buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

// ZIP container (xlsx/docx/etc.) — "PK\x03\x04", "PK\x05\x06", "PK\x07\x08".
function isZip(buf) {
  return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
         startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
         startsWith(buf, [0x50, 0x4b, 0x07, 0x08]);
}

// Legacy OLE2 compound document (.xls / .doc). ExcelJS cannot read these.
function isOle2(buf) {
  return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function isJpeg(buf) { return startsWith(buf, [0xff, 0xd8, 0xff]); }
function isPng(buf)  { return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); }

// WebP: "RIFF" .... "WEBP"
function isWebp(buf) {
  return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
         Buffer.isBuffer(buf) && buf.length >= 12 &&
         buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
}

/**
 * Heuristic: does the buffer look like UTF-8/ASCII text (a CSV)?
 * Rejects buffers containing NUL bytes in the sampled prefix.
 */
function looksTextual(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return false; // binary
  }
  return true;
}

// xlsx (modern) is a ZIP; reject OLE2 .xls explicitly.
function isXlsx(buf) { return isZip(buf) && !isOle2(buf); }

/** Allowed for student import: modern xlsx (ZIP) or a textual CSV. */
function isAllowedImport(buf) { return isXlsx(buf) || (looksTextual(buf) && !isOle2(buf)); }

/** Allowed for image uploads (driver photo): JPEG, PNG or WebP. */
function isAllowedImage(buf) { return isJpeg(buf) || isPng(buf) || isWebp(buf); }

module.exports = {
  isZip, isOle2, isJpeg, isPng, isWebp, isXlsx, looksTextual,
  isAllowedImport, isAllowedImage,
};
