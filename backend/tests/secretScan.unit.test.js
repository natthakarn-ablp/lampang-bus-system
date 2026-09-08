'use strict';

/**
 * The secret scanner: what it must catch, and what it must stop crying wolf on.
 *
 * On 8 September 2026 the readiness gate went FAIL on a commit that leaked
 * nothing. All eighteen findings were false: a value read from the environment,
 * a value interpolated from a variable, a placeholder that says CHANGE_ME in
 * capital letters, and the words DB_PASSWORD inside an error message.
 *
 * That is the dangerous failure for a scanner. Nobody disables one that has
 * never been wrong; everybody eventually disables one that is wrong every week.
 * So the rule was narrowed — and a narrowed rule has to be pinned, or the next
 * narrowing quietly removes the teeth.
 *
 * The first block is the one that matters. Every entry in it is a credential
 * that would work if pasted somewhere, and the scanner must never stop seeing
 * them, whatever else changes here.
 */

const {
  secretMatches, looksLikeSecretValue,
} = require('../../scripts/lib/secret-scan');

describe('a real credential is always reported', () => {
  const LEAKS = [
    ['a database password in an env file', 'DB_PASSWORD=Tr0ub4dor&3xample'],
    ['a jwt signing key', 'JWT_SECRET=9f2c1e7a5b3d8046af17c9e25b0d63a4'],
    ['a LINE channel secret', 'LINE_CHANNEL_SECRET=8e41b0c9d7f2a63541bd0e9c72a4f1b8'],
    ['a LINE access token', 'LINE_CHANNEL_ACCESS_TOKEN=Kf9pQz2LmXvB7nR4tY6wA1sD3gH5jK8l'],
    ['a quoted value', "password: 'Tr0ub4dor&3xample',"],
    ['a double-quoted value', 'DB_PASSWORD="Tr0ub4dor&3xample"'],
    ['lower case key', 'db_password=Tr0ub4dor&3xample'],
    ['a connection string with a password', 'mysql://schoolbus:Tr0ub4dor3@10.0.0.5:3306/lampang_bus'],
    ['a literal bearer token', "curl -H 'Authorization: Bearer sk-live-9f2c1e7a5b3d8046af17'"],
    ['a JWT', 'const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";'],
    ['a private key header', '-----BEGIN RSA PRIVATE KEY-----'],
    ['an api key', 'API_KEY=AIzaSyD3xAmPl3K3yTh4tW0uldW0rk99'],
    ['a value on a diff-added line', '+  DB_PASSWORD=Tr0ub4dor&3xample'],
  ];

  it.each(LEAKS)('catches %s', (_name, line) => {
    expect(secretMatches(line)).toEqual([line]);
  });

  it('reports every leaking line in a block, not just the first', () => {
    const block = [
      'const a = 1;',
      'DB_PASSWORD=Tr0ub4dor&3xample',
      'const b = 2;',
      'JWT_SECRET=9f2c1e7a5b3d8046af17c9e25b0d63a4',
    ].join('\n');
    expect(secretMatches(block)).toHaveLength(2);
  });
});

describe('a shape that cannot carry a credential is not reported', () => {
  // Each of these was a real false positive on 8 Sep 2026, or is the same
  // shape as one. The comment on each says why it cannot leak.
  const CLEAN = [
    ['read from the environment', '    password: process.env.DB_PASSWORD,'],
    ['read from the environment, jwt', '    secret: process.env.JWT_SECRET,'],
    ['interpolated from a variable', '  `DB_PASSWORD=${PASSWORD}`,'],
    ['interpolated inside a fixture', '    const local = makeFixture({ env: `DB_USER=schoolbus\\nDB_PASSWORD=${PASSWORD}\\n` });'],
    ['commented out in a fixture', "    ['keys commented out', `# DB_USER=schoolbus\\n# DB_PASSWORD=${PASSWORD}\\n`],"],
    ['the name inside an error message', '    // at "DB_USER / DB_NAME / DB_PASSWORD missing" for a reason that has'],
    ['the name inside an expectation', '      expect(r.out).toMatch(/DB_USER \\/ DB_NAME \\/ DB_PASSWORD missing in/);'],
    ['the name inside a negative assertion', '    expect(code).not.toMatch(/-p"?\\$\\{?DB_PASSWORD/);'],
    ['a declared placeholder', 'DB_PASSWORD=CHANGE_ME'],
    ['a declared placeholder, spelled out', 'JWT_SECRET=CHANGE_ME_TO_A_RANDOM_STRING_AT_LEAST_32_CHARS'],
    ['a self-describing fixture', "  'DB_PASSWORD=fixture-password-never-real',"],
    ['a self-describing token fixture', "  'LINE_CHANNEL_ACCESS_TOKEN=fixture-token',"],
    ['a value too short to be worth stealing', "    DB_PASSWORD: 'pw',"],
    ['a computed value', "    JWT_SECRET: 'x'.repeat(32),"],
    ['a shell variable', 'password=${DB_PASSWORD}'],
    ['a shell variable, unbraced', 'PASSWORD=$MYSQL_PWD'],
    ['an angle-bracket placeholder', 'DB_PASSWORD=<your password here>'],
    ['an empty value', 'DB_PASSWORD='],
    ['a bearer header being built', "headers: { Authorization: `Bearer ${token}` },"],
    ['a bearer prefix check', "if (h.startsWith('Bearer ')) return h.slice(7);"],
    ['a url with no credentials', 'mysql://localhost:3306/lampang_bus'],
    ['a url with a user but no password', 'mysql://schoolbus@localhost:3306/lampang_bus'],
    ['prose about a password policy', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'],
    ['a column named password_hash', '  password_hash VARCHAR(255) NOT NULL,'],
  ];

  it.each(CLEAN)('ignores %s', (_name, line) => {
    expect(secretMatches(line)).toEqual([]);
  });

  it('passes the exact eighteen lines that failed the gate on 8 Sep 2026', () => {
    // Reproduced verbatim from
    // outputs/automated-readiness/20260908-170917/logs/secret-scan-head.log
    const log = [
      ' DB_PASSWORD=CHANGE_ME',
      ' JWT_SECRET=CHANGE_ME_TO_A_RANDOM_STRING_AT_LEAST_32_CHARS',
      '     password: process.env.DB_PASSWORD,',
      '     secret: process.env.JWT_SECRET,',
      '+  `DB_PASSWORD=${PASSWORD}`,',
      "+    // at \"DB_USER / DB_NAME / DB_PASSWORD missing\" for a reason that has",
      '+    const local = makeFixture({ env: `DB_NAME=lampang_bus\\nDB_USER=schoolbus\\nDB_PASSWORD=${PASSWORD}\\n` });',
      "+    ['a password but no database name', `DB_USER=schoolbus\\nDB_PASSWORD=${PASSWORD}\\n`],",
      "+    ['keys commented out', `# DB_NAME=lampang_bus\\n# DB_USER=schoolbus\\n# DB_PASSWORD=${PASSWORD}\\n`],",
      '+      expect(r.out).toMatch(/DB_USER \\/ DB_NAME \\/ DB_PASSWORD missing in/);',
      '+    expect(code).not.toMatch(/-p"?\\$\\{?DB_PASSWORD/);',
      "+    DB_PASSWORD: 'pw',",
      "+    JWT_SECRET: 'x'.repeat(32),",
      "+  'DB_PASSWORD=fixture-password-never-real',",
      "+  'LINE_CHANNEL_ACCESS_TOKEN=fixture-token',",
      ' password=${DB_PASSWORD}',
    ].join('\n');
    expect(secretMatches(log)).toEqual([]);
  });
});

describe('the value rule itself', () => {
  it('treats a long unrecognised string as a secret', () => {
    // The default is to report. Anything not proven harmless is a finding.
    expect(looksLikeSecretValue('Tr0ub4dor&3xample')).toBe(true);
  });

  it('does not treat a repeated character as one', () => {
    expect(looksLikeSecretValue('xxxxxxxxxxxx')).toBe(false);
  });

  it('strips one layer of quotes before judging', () => {
    expect(looksLikeSecretValue("'Tr0ub4dor&3xample'")).toBe(true);
    expect(looksLikeSecretValue('"CHANGE_ME"')).toBe(false);
  });
});

describe('the scanner ignores its own two files, and only those', () => {
  const LEAK = 'DB_PASSWORD=Tr0ub4dor&3xample';

  it('is silent inside its own test file, whose fixtures are meant to look real', () => {
    const diff = ['+++ b/backend/tests/secretScan.unit.test.js', `+  ${LEAK}`].join('\n');
    expect(secretMatches(diff)).toEqual([]);
  });

  it('is silent inside its own source', () => {
    const diff = ['+++ b/scripts/lib/secret-scan.js', `+  ${LEAK}`].join('\n');
    expect(secretMatches(diff)).toEqual([]);
  });

  it('starts reporting again at the next file in the diff', () => {
    // The exclusion must lapse, or one edit to the scanner would silence the
    // rest of the commit.
    const diff = [
      '+++ b/backend/tests/secretScan.unit.test.js',
      `+  ${LEAK}`,
      '+++ b/backend/src/config/database.js',
      `+  ${LEAK}`,
    ].join('\n');
    expect(secretMatches(diff)).toEqual([`+  ${LEAK}`]);
  });

  it('excludes nothing else, however similarly named', () => {
    const diff = ['+++ b/backend/tests/secretScanOther.unit.test.js', `+  ${LEAK}`].join('\n');
    expect(secretMatches(diff)).toHaveLength(1);
  });
});

describe('the scanner is wired into the readiness collector', () => {
  const fs = require('fs');
  const path = require('path');
  const collector = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'scripts', 'collect-automated-readiness-evidence.js'), 'utf8'
  );

  it('the collector uses the shared library rather than its own copy', () => {
    expect(collector).toMatch(/require\('\.\/lib\/secret-scan'\)/);
    // A second inline copy would drift from the tested one.
    expect(collector).not.toMatch(/const pattern = \/\(DB_PASSWORD/);
  });
});
