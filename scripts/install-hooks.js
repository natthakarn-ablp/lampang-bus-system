#!/usr/bin/env node

/**
 * install-hooks.js — ติดตั้ง git hooks สำหรับ label check
 *
 * วิธีใช้:
 *   node scripts/install-hooks.js           # ติดตั้ง pre-commit hook (advisory)
 *   node scripts/install-hooks.js --strict   # ติดตั้งแบบ strict (block commit)
 *   node scripts/install-hooks.js --remove   # ถอน hook ออก
 */

const fs = require('fs');
const path = require('path');

const HOOK_PATH = path.resolve(__dirname, '..', '.git', 'hooks', 'pre-commit');
const args = process.argv.slice(2);

if (args.includes('--remove')) {
  if (fs.existsSync(HOOK_PATH)) {
    fs.unlinkSync(HOOK_PATH);
    console.log('Removed pre-commit hook.');
  } else {
    console.log('No pre-commit hook found.');
  }
  process.exit(0);
}

const strict = args.includes('--strict');
const strictFlag = strict ? ' --strict' : '';

const hookContent = `#!/bin/sh
# Lampang Bus System — pre-commit label check
# ติดตั้งโดย: node scripts/install-hooks.js${strict ? ' --strict' : ''}
# ถอน: node scripts/install-hooks.js --remove

# ตรวจเฉพาะไฟล์ .js/.jsx/.ts/.tsx ที่ staged ใน frontend/src/
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '^frontend/src/.*\\.(jsx?|tsx?)$' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo ""
echo "Checking UI labels (LABEL_STANDARDS.md)..."
echo ""

node scripts/check-ui-labels.js --staged${strictFlag}
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "Label check failed. Fix violations or use: git commit --no-verify"
  exit 1
fi

exit 0
`;

fs.writeFileSync(HOOK_PATH, hookContent, { mode: 0o755 });
console.log('Installed pre-commit hook at .git/hooks/pre-commit');
console.log('Mode: ' + (strict ? 'STRICT (blocks commit on violations)' : 'ADVISORY (warns but allows commit)'));
console.log('');
console.log('To change mode:');
console.log('  node scripts/install-hooks.js --strict   # enable blocking');
console.log('  node scripts/install-hooks.js             # back to advisory');
console.log('  node scripts/install-hooks.js --remove    # remove hook');
