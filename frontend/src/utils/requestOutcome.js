// Outcomes that count as success per approve/reject action on the affiliation
// request screens. The approve routes answer 200 for every outcome, so a
// FAILED / STALE / no-longer-pending result must not show as a green toast
// (QA affiliation-09).
const OK_OUTCOMES = {
  approve: new Set(['APPLIED', 'ALREADY_APPLIED']),
  reject: new Set(['REJECTED']),
};

// True when the response for `action` should be shown as an error.
// Unknown actions or a missing status fall back to success, as before.
export function isFailedOutcome(action, status) {
  return Boolean(status && OK_OUTCOMES[action] && !OK_OUTCOMES[action].has(status));
}
