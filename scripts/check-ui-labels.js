#!/usr/bin/env node

/**
 * check-ui-labels.js — ตรวจหา hardcoded UI text ที่หลุดมาตรฐาน
 *
 * อ้างอิง: LABEL_STANDARDS.md §5 (คำที่ควรหลีกเลี่ยง)
 *
 * วิธีใช้:
 *   node scripts/check-ui-labels.js                # advisory mode (exit 0 เสมอ)
 *   node scripts/check-ui-labels.js --strict        # strict mode (exit 1 ถ้าพบ UI violations)
 *   node scripts/check-ui-labels.js --staged        # ตรวจเฉพาะไฟล์ที่ staged ใน git
 *   node scripts/check-ui-labels.js --staged --strict  # pre-commit strict mode
 *   node scripts/check-ui-labels.js --verbose       # แสดง code snippet ทุกจุด
 *   node scripts/check-ui-labels.js --ci            # alias ของ --strict (backward compat)
 *
 * ข้อจำกัด:
 *   - เป็น heuristic script ไม่ใช่ AST-level linter
 *   - แยก UI text vs non-UI ด้วย pattern matching (ไม่ 100%)
 *   - ผลลัพธ์ "ต้องตรวจด้วยคน" ให้ dev ตัดสินเองว่าจริงหรือ false positive
 *   - false positive ที่ทราบแล้ว: driver pages ใช้ "ลาวันนี้" ถูกต้องตาม §6
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Banned terms จาก LABEL_STANDARDS.md §5 ────────────────────────
const BANNED_TERMS = [
  { banned: 'เขตพื้นที่',       replacement: 'สังกัด',               note: 'ยกเว้น regex ตัด prefix ชื่อ DB' },
  { banned: 'ลาวันนี้',         replacement: 'นักเรียนลา',          note: 'ยกเว้น driver context ตาม §6' },
  { banned: 'นักเรียนลาวันนี้',  replacement: 'นักเรียนลา',          note: '' },
  { banned: 'ดำเนินการแล้ว',     replacement: 'สำเร็จแล้ว',          note: '' },
  { banned: 'ยังไม่ครบ',         replacement: 'ยังมีรายการค้าง',      note: '' },
  { banned: 'สถานะรายคัน',      replacement: 'สถานะรถแต่ละคัน',      note: '' },
  { banned: 'ภาพรวมจังหวัดลำปาง', replacement: 'ภาพรวมจังหวัด',      note: 'ไม่ hardcode ชื่อจังหวัด' },
  { banned: 'ภาพรวมเขตพื้นที่',  replacement: 'ภาพรวมสังกัด',        note: '' },
];

// ─── Paths ที่ได้รับการยกเว้น (known false positives) ──────────────
const EXCEPTION_PATHS = [
  // driver pages ใช้ "ลาวันนี้" ถูกต้องตาม §6
  { path: 'pages/driver/', term: 'ลาวันนี้', reason: 'driver operational context ตาม §6' },
];

// ─── Patterns ที่บ่งบอกว่า line ไม่ใช่ UI text ────────────────────
const NON_UI_PATTERNS = [
  /^\s*\/\//,                  // single-line comment
  /^\s*\*/,                    // block comment continuation
  /^\s*{\s*\/\*/,              // JSX block comment
  /\.replace\s*\(/,            // regex/replace operation
  /RegExp\s*\(/,               // regex constructor
  /\/[^/]+\/[gimsuy]*[,;)\s]/, // regex literal
  /console\.(log|warn|error)/, // console output
  /import\s+/,                 // import statement
  /require\s*\(/,              // require
  /banned:|replacement:|note:/, // config object
  /BANNED_TERMS/,              // reference to banned terms
  /\.test\s*\(/,               // test file assertion
  /describe\s*\(/,             // test describe
  /it\s*\(\s*['"`]/,           // test it block
];

// ─── Patterns ที่บ่งบอกว่า line น่าจะเป็น UI text ─────────────────
const UI_PATTERNS = [
  /[>}]\s*[ก-๙]/,              // JSX text content after > or }
  /label\s*[=:]\s*["'`]/,      // label prop or key
  /title\s*[=:]\s*["'`]/,      // title prop
  /placeholder\s*[=:]\s*["'`]/, // placeholder
  /["'`][ก-๙].*["'`]/,         // Thai string literal
  /<(h[1-6]|p|span|td|th|option|button|label)\b/i, // HTML elements
];

// ─── File discovery ───────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [
  path.join(PROJECT_ROOT, 'frontend', 'src', 'pages'),
  path.join(PROJECT_ROOT, 'frontend', 'src', 'components'),
];
const EXTENSIONS = ['.jsx', '.js', '.tsx', '.ts'];

function getAllFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    });
    return output
      .split('\n')
      .filter(f => f.trim())
      .filter(f => f.startsWith('frontend/src/'))
      .filter(f => EXTENSIONS.some(ext => f.endsWith(ext)))
      .map(f => path.join(PROJECT_ROOT, f));
  } catch {
    return [];
  }
}

// ─── Classification ───────────────────────────────────────────────
function classifyLine(line) {
  for (const pat of NON_UI_PATTERNS) {
    if (pat.test(line)) return 'non-ui';
  }
  for (const pat of UI_PATTERNS) {
    if (pat.test(line)) return 'ui';
  }
  return 'uncertain';
}

function isExcepted(relPath, term) {
  return EXCEPTION_PATHS.some(
    ex => relPath.includes(ex.path) && ex.term === term
  );
}

// ─── Main scan ────────────────────────────────────────────────────
function scan() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const strict = args.includes('--strict') || args.includes('--ci');
  const stagedOnly = args.includes('--staged');

  // Collect files
  let files;
  if (stagedOnly) {
    files = getStagedFiles();
    if (files.length === 0) {
      console.log('\ncheck-ui-labels: no staged frontend files to check.\n');
      process.exit(0);
    }
  } else {
    files = [];
    for (const dir of SCAN_DIRS) {
      files.push(...getAllFiles(dir));
    }
  }

  const results = { ui: [], nonUi: [], uncertain: [], excepted: [] };

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const term of BANNED_TERMS) {
        if (!line.includes(term.banned)) continue;

        // Check known exceptions
        if (isExcepted(relPath, term.banned)) {
          results.excepted.push({
            file: relPath, line: i + 1, term: term.banned,
            text: line.trim().substring(0, 120),
          });
          continue;
        }

        const classification = classifyLine(line);
        const hit = {
          file: relPath,
          line: i + 1,
          term: term.banned,
          replacement: term.replacement,
          note: term.note,
          text: line.trim().substring(0, 120),
          classification,
        };

        if (classification === 'ui') results.ui.push(hit);
        else if (classification === 'non-ui') results.nonUi.push(hit);
        else results.uncertain.push(hit);
      }
    }
  }

  // ─── Output ─────────────────────────────────────────────────────
  const divider = '─'.repeat(70);
  const mode = strict ? 'STRICT' : 'ADVISORY';
  const scope = stagedOnly ? 'staged files' : 'all files';

  console.log('\n' + divider);
  console.log('  check-ui-labels [' + mode + '] — LABEL_STANDARDS.md §5');
  console.log('  Scope: ' + scope + ' (' + files.length + ' files)');
  console.log(divider);

  // UI violations
  if (results.ui.length > 0) {
    console.log('\n\x1b[31m[UI VIOLATIONS]\x1b[0m พบคำต้องห้ามใน UI text (' + results.ui.length + ' จุด):');
    console.log('');
    for (const h of results.ui) {
      console.log('  \x1b[31m✗\x1b[0m ' + h.file + ':' + h.line);
      console.log('    "' + h.term + '" → ใช้ "' + h.replacement + '"');
      if (verbose) console.log('    code: ' + h.text);
      if (h.note) console.log('    หมายเหตุ: ' + h.note);
      console.log('');
    }
  } else {
    console.log('\n\x1b[32m[UI VIOLATIONS]\x1b[0m ไม่พบคำต้องห้ามใน UI text');
  }

  // Uncertain
  if (results.uncertain.length > 0) {
    console.log('\n\x1b[33m[NEEDS REVIEW]\x1b[0m ต้องตรวจด้วยคน (' + results.uncertain.length + ' จุด):');
    for (const h of results.uncertain) {
      console.log('  \x1b[33m?\x1b[0m ' + h.file + ':' + h.line + ' — "' + h.term + '"');
      if (verbose) console.log('    code: ' + h.text);
      if (h.note) console.log('    ' + h.note);
    }
  }

  // Non-UI
  if (results.nonUi.length > 0) {
    console.log('\n\x1b[36m[NON-UI]\x1b[0m ไม่ใช่ UI text (' + results.nonUi.length + ' จุด)' + (verbose ? ':' : ' — ใช้ --verbose'));
    if (verbose) {
      for (const h of results.nonUi) {
        console.log('  \x1b[36m·\x1b[0m ' + h.file + ':' + h.line + ' — ' + h.text.substring(0, 80));
      }
    }
  }

  // Excepted
  if (results.excepted.length > 0) {
    console.log('\n\x1b[90m[EXCEPTED]\x1b[0m ยกเว้นตาม §6 (' + results.excepted.length + ' จุด)' + (verbose ? ':' : ' — ใช้ --verbose'));
    if (verbose) {
      for (const h of results.excepted) {
        console.log('  \x1b[90m·\x1b[0m ' + h.file + ':' + h.line + ' — "' + h.term + '"');
      }
    }
  }

  // Summary
  console.log('\n' + divider);
  console.log('  สรุป:');
  console.log('    UI violations:  ' + results.ui.length + (results.ui.length > 0 ? ' ← ' + (strict ? 'BLOCKED' : 'WARNING') : ''));
  console.log('    Needs review:   ' + results.uncertain.length);
  console.log('    Non-UI:         ' + results.nonUi.length);
  console.log('    Excepted (§6):  ' + results.excepted.length);
  console.log('    Files scanned:  ' + files.length);
  console.log(divider);

  if (results.ui.length > 0 && strict) {
    console.log('\n  \x1b[31mBLOCKED:\x1b[0m แก้ไขคำต้องห้ามก่อน commit/merge');
    console.log('  อ้างอิง: LABEL_STANDARDS.md §5');
    console.log('  ถ้าเป็น false positive ให้เพิ่มใน EXCEPTION_PATHS ของ scripts/check-ui-labels.js\n');
    process.exit(1);
  } else if (results.ui.length > 0) {
    console.log('\n  \x1b[33mWARNING:\x1b[0m พบคำต้องห้าม — ควรแก้ไขก่อน merge');
    console.log('  ใช้ --strict เพื่อบังคับ block\n');
  } else {
    console.log('\n  \x1b[32mPASSED\x1b[0m\n');
  }
}

scan();
