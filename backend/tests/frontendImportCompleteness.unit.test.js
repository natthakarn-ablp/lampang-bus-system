'use strict';

/**
 * A page may not use a name it forgot to import.
 *
 * WHAT HAPPENED
 * -------------
 * On 8 September 2026 `frontend/src/pages/ChangePassword.jsx` was changed to
 * take its password rule from a shared module. It imported
 * PASSWORD_MIN_LENGTH and PASSWORD_TOO_SHORT, and then used PASSWORD_HELPER,
 * which it had not imported.
 *
 * Nothing caught it. `vite build` succeeded — an unimported identifier is a
 * runtime `ReferenceError`, not a bundling error, so rollup emits a global
 * lookup and moves on. The full test suite stayed green, because no test opens
 * a page in a browser. The project has no ESLint, so `no-undef` never ran.
 *
 * The page it broke is the one every account with `must_change_password` is
 * forced through at first login. It would have rendered the error boundary for
 * every new user of the system, and the first anyone would have known is a
 * teacher unable to get in.
 *
 * WHAT THIS CHECKS
 * ----------------
 * For every frontend file that imports from a local `utils/` module: if the
 * file mentions a name that module exports, that name must be in the file's
 * import list from that module. It is a narrow rule — it does not attempt to be
 * a general `no-undef` — but it covers the exact way this class of bug arrives
 * here, which is a shared constant being used one line further down than the
 * import that was written for it.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const UTILS = path.join(SRC, 'utils');

/** Every .js/.jsx file under frontend/src. */
function sourceFiles(dir = SRC) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The named exports of one utils module. */
function namedExports(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // `export { a, b as c }`
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const UTIL_EXPORTS = new Map();
for (const entry of fs.readdirSync(UTILS, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.jsx?$/.test(entry.name)) continue;
  UTIL_EXPORTS.set(entry.name.replace(/\.jsx?$/, ''), namedExports(path.join(UTILS, entry.name)));
}

/** Comments blanked, so a name discussed in prose is not counted as a use. */
function blankComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Which utils modules a file imports from, and what it takes from each. */
function utilImports(src) {
  const found = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*utils\/([\w-]+)['"]/g)) {
    const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    found.push({ module: m[2], names });
  }
  return found;
}

describe('a page imports every shared name it uses', () => {
  const files = sourceFiles();

  it('has frontend source to scan and utils to scan against', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(UTIL_EXPORTS.size).toBeGreaterThanOrEqual(5);
  });

  it.each(files.map((f) => [path.relative(ROOT, f).replace(/\\/g, '/'), f]))('%s', (rel, file) => {
    const raw = fs.readFileSync(file, 'utf8');
    const code = blankComments(raw);
    const imports = utilImports(raw);
    if (!imports.length) return;

    const missing = [];
    for (const { module, names } of imports) {
      const exported = UTIL_EXPORTS.get(module);
      if (!exported) continue;                       // a module this scan cannot see
      const importedHere = new Set(names);
      for (const name of exported) {
        if (importedHere.has(name)) continue;
        // Used as a bare identifier, not as a property of something else.
        const used = new RegExp(`(^|[^\\w$.'"\`])${name}\\b`).test(code);
        if (used) missing.push(`${name} (from utils/${module})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
