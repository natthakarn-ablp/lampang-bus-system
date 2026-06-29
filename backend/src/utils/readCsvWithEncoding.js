'use strict';

// Phase 10.15A — CSV encoding helper.
// Many schools export CSV from Excel/Calc in TIS-620 (Thai) or Windows-874
// instead of UTF-8. fs.readFileSync(path, 'utf-8') turns the header into
// mojibake, so the column map fails and every row is reported as an invalid
// student code. This helper tries UTF-8 first, then falls back to Thai
// encodings when the decoded text contains replacement characters or no
// Thai characters.

const iconv = require('iconv-lite');

function decodeCsvBuffer(buffer) {
  // Try UTF-8 first (default, modern exports).
  const utf8 = iconv.decode(buffer, 'utf-8');
  if (!utf8.includes('�') && /[฀-๿]/.test(utf8)) {
    return utf8;
  }
  // Fallback: TIS-620 (common Excel "Save As CSV" on Thai Windows).
  const tis = iconv.decode(buffer, 'tis-620');
  if (/[฀-๿]/.test(tis)) return tis;
  // Last fallback: Windows-874.
  const win874 = iconv.decode(buffer, 'windows-874');
  if (/[฀-๿]/.test(win874)) return win874;
  // If nothing looks Thai, return the UTF-8 attempt (may contain replacement chars).
  return utf8;
}

module.exports = { decodeCsvBuffer };
