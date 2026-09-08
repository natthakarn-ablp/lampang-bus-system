'use strict';

/**
 * Find lines that leak a credential.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * It used to live inside collect-automated-readiness-evidence.js, which runs on
 * require, so nothing could test it. On 8 Sep 2026 it reported FAIL on eighteen
 * lines and every single one was a false positive — `password: process.env
 * .DB_PASSWORD`, `DB_PASSWORD=${PASSWORD}`, `# DB_PASSWORD=…` in a commented
 * fixture, and the words DB_PASSWORD appearing inside an error message. The
 * readiness gate went red for a commit that leaked nothing.
 *
 * That is the failure that matters here. A scanner nobody believes is worse
 * than no scanner: the first time it cries wolf, the next person adds
 * `|| true` and the real leak walks through. So the rule is narrowed and the
 * narrowing is tested — backend/tests/secretScan.unit.test.js keeps a list of
 * real leaks that must always be caught alongside the shapes that must not be.
 *
 * THE DISTINCTION IT NOW DRAWS
 * ----------------------------
 * A key NAME appearing is not a leak. A key name with a VALUE that could be a
 * real credential is. Everything below is about telling those apart, and every
 * exclusion is a shape that cannot carry a secret at all:
 *
 *   password: process.env.DB_PASSWORD   reads one, carries none
 *   DB_PASSWORD=${PASSWORD}             interpolates one, carries none
 *   DB_PASSWORD=CHANGE_ME               a placeholder, by its own words
 *   "DB_PASSWORD missing in .env"       prose about the name
 *
 * When in doubt the line is REPORTED. Every rule here answers "could this text,
 * as written, be pasted somewhere and work?" — if the answer is maybe, it is a
 * finding.
 */

/** Key names whose value would be a credential. */
const SECRET_KEYS = [
  'DB_PASSWORD', 'DB_PASS', 'MYSQL_PWD', 'MYSQL_PASSWORD',
  'PASSWORD', 'PASSWD', 'SECRET', 'JWT_SECRET', 'SESSION_SECRET',
  'TOKEN', 'ACCESS_TOKEN', 'API_KEY', 'APIKEY', 'PRIVATE_KEY',
  'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'CHANNEL_ACCESS_TOKEN',
];

/**
 * Words that declare a value to be a stand-in. A value containing any of them
 * is not a credential no matter how long it is, because it announces itself.
 */
const PLACEHOLDER_WORDS = [
  'change_me', 'changeme', 'change-me', 'your_', 'your-', 'yourvalue',
  'placeholder', 'example', 'fixture', 'dummy', 'sample', 'fake', 'never-real',
  'redacted', 'todo', 'fixme', 'xxxx', 'notreal', 'not-real', 'test-only',
  'replace_me', 'replaceme', 'setme', 'set_me', 'unset', 'none',
];

/** The shortest value worth calling a credential. */
const MIN_SECRET_VALUE_LENGTH = 8;

/**
 * Is this the value side of an assignment, and could it be a real credential?
 *
 * @param {string} raw the text after the `=` or `:`
 * @returns {boolean}
 */
function looksLikeSecretValue(raw) {
  let value = String(raw == null ? '' : raw).trim();

  // Strip one layer of surrounding quotes, and a trailing comma or semicolon.
  value = value.replace(/[,;]\s*$/, '');
  const quoted = /^(['"`])([\s\S]*)\1/.exec(value);
  if (quoted) value = quoted[2];
  value = value.trim();

  if (!value) return false;

  // Interpolated, read from somewhere, or computed: carries nothing itself.
  if (value.includes('${')) return false;
  if (/^\$[A-Za-z_{(]/.test(value)) return false;
  if (/^process\.env\b/.test(value)) return false;
  if (/^<[^>]*>$/.test(value)) return false;
  if (/^[A-Za-z_$][\w$.]*\s*\(/.test(value)) return false;   // a call, e.g. randomBytes(32)
  if (/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*$/.test(value)) return false; // a property read
  if (/^(?:\w+\.)?repeat\(/.test(value)) return false;

  // Announces itself as a stand-in.
  const lower = value.toLowerCase();
  if (PLACEHOLDER_WORDS.some((w) => lower.includes(w))) return false;

  // Too short to be worth stealing.
  if (value.length < MIN_SECRET_VALUE_LENGTH) return false;

  // A run of the same character, e.g. xxxxxxxx.
  if (/^(.)\1+$/.test(value)) return false;

  return true;
}

/**
 * `KEY=value` or `KEY: value` where the value could be a credential.
 *
 * The key must be at a word boundary and the separator must follow it directly
 * (allowing whitespace), so `"DB_PASSWORD missing in .env"` — a name inside a
 * sentence — is not a match at all.
 */
function hasSecretAssignment(line) {
  for (const key of SECRET_KEYS) {
    const re = new RegExp(`\\b${key}\\b\\s*[=:]\\s*(.*)$`, 'i');
    const m = re.exec(line);
    if (m && looksLikeSecretValue(m[1])) return true;
  }
  return false;
}

/**
 * A connection string with a password in it, e.g. mysql://user:pw@host/db.
 * The scheme alone is not a finding — `mysql://localhost` leaks nothing.
 */
function hasCredentialInUrl(line) {
  const m = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/@'"`]+)@/i.exec(line);
  if (!m) return false;
  const authority = m[1];
  if (!authority.includes(':')) return false;          // user@host, no password
  const password = authority.slice(authority.indexOf(':') + 1);
  return looksLikeSecretValue(password);
}

/**
 * `Bearer ` used to match on its own, which flagged every line that BUILDS an
 * Authorization header — `Bearer ${token}`, `startsWith('Bearer ')` — as a
 * leaked credential. A real leak is `Bearer ` followed by an actual token: a
 * long run of token characters, with no interpolation, placeholder or quote in
 * between.
 */
function hasLiteralBearerToken(line) {
  const match = /Bearer\s+([^\s'"`)}\]]+)/.exec(line);
  if (!match) return false;
  const candidate = match[1];
  if (candidate.startsWith('${') || candidate.startsWith('<') || candidate.startsWith('$')) return false;
  if (candidate.includes('${')) return false;
  return /^[A-Za-z0-9._-]{16,}$/.test(candidate);
}

/**
 * A JWT: three base64url segments separated by dots. Matched on shape, because
 * a real one carries a signature and there is no key name to look for.
 */
function hasJwtShapedString(line) {
  return /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(line);
}

/**
 * A private key block header. Nothing legitimate puts one of these in a diff.
 */
function hasPrivateKeyBlock(line) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line);
}

/**
 * The scanner's own source describes the patterns it looks for, so scanning a
 * diff that touches this file would report the file itself.
 */
function isScannerPatternSourceLine(line) {
  return line.includes('SECRET_KEYS')
    || line.includes('PLACEHOLDER_WORDS')
    || line.includes('looksLikeSecretValue')
    || line.includes('hasSecretAssignment')
    || line.includes('isScannerPatternSourceLine');
}

/**
 * The two files allowed to contain credential-shaped text, because describing
 * credentials is their whole job.
 *
 * This is a PATH exclusion rather than a pattern one, and the distinction
 * matters. The test file deliberately holds thirteen strings that would work if
 * they were real — that is what makes it a test — so no pattern rule could ever
 * tell them from a leak. Naming two paths is honest about that. Excluding them
 * by shape would have meant weakening the rule for every file in the repository.
 *
 * A diff is a sequence of per-file sections, so the path is known from the
 * `+++ b/...` header and the exclusion lapses at the next one.
 */
const SELF_PATHS = [
  'scripts/lib/secret-scan.js',
  'backend/tests/secretScan.unit.test.js',
];

/** The path a `+++ b/path` diff header names, or null for any other line. */
function diffTargetPath(line) {
  const m = /^\+\+\+ [ab]\/(.+?)\s*$/.exec(line);
  return m ? m[1].replace(/\\/g, '/') : null;
}

/**
 * @param {string} text a diff, a file, or any block of lines
 * @returns {string[]} the lines that leak a credential
 */
function secretMatches(text) {
  let inSelfFile = false;
  return String(text || '').split(/\r?\n/).filter((line) => {
    const target = diffTargetPath(line);
    if (target !== null) {
      inSelfFile = SELF_PATHS.includes(target);
      return false;
    }
    if (inSelfFile) return false;
    if (isScannerPatternSourceLine(line)) return false;
    return hasSecretAssignment(line)
      || hasCredentialInUrl(line)
      || hasLiteralBearerToken(line)
      || hasJwtShapedString(line)
      || hasPrivateKeyBlock(line);
  });
}

module.exports = {
  secretMatches,
  diffTargetPath,
  SELF_PATHS,
  looksLikeSecretValue,
  hasSecretAssignment,
  hasCredentialInUrl,
  hasLiteralBearerToken,
  hasJwtShapedString,
  hasPrivateKeyBlock,
  SECRET_KEYS,
  PLACEHOLDER_WORDS,
  MIN_SECRET_VALUE_LENGTH,
};
