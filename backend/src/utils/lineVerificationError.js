'use strict';

const TRANSIENT_VERIFY_ERRORS = new Set([
  'timeout', 'network_error', 'upstream_unavailable', 'verification_busy',
]);

function isVerificationUnavailable(result) {
  return Boolean(result && TRANSIENT_VERIFY_ERRORS.has(result.error));
}

module.exports = { isVerificationUnavailable };
