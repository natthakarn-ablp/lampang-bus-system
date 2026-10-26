'use strict';

const crypto = require('crypto');

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function keyedHash(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value || ''), 'utf8').digest('hex');
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code, secret) {
  return keyedHash(normalizeRecoveryCode(code), secret);
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateRecoveryCode() {
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i += 1) {
    raw += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function generateRecoveryCodes(count = 8) {
  const unique = new Set();
  while (unique.size < count) unique.add(generateRecoveryCode());
  return [...unique];
}

function hashIpAddress(ip, secret) {
  if (!ip) return null;
  return keyedHash(String(ip), secret);
}

module.exports = {
  generateResetToken,
  generateRecoveryCodes,
  hashResetToken,
  hashRecoveryCode,
  hashIpAddress,
  normalizeRecoveryCode,
};
