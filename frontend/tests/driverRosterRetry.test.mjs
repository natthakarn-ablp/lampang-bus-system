import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: ErrorState onRetry referenced an undefined `load`, which threw
// a ReferenceError at render time whenever an error was shown.
for (const file of ['StudentList.jsx', 'CheckinPanel.jsx']) {
  test(`${file}: onRetry only references identifiers defined in the file`, () => {
    const src = readFileSync(new URL(`../src/pages/driver/${file}`, import.meta.url), 'utf8');
    const m = src.match(/onRetry=\{(\w+)\}/);
    assert.ok(m, 'ErrorState onRetry expected');
    const name = m[1];
    const defined = new RegExp(`(const|let|function)\\s+${name}\\b`);
    assert.ok(defined.test(src), `onRetry handler "${name}" is not defined in ${file}`);
  });
}
