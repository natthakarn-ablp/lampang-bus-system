// Decide what to do with a GPS batch the server answered with an error.
// Only a structurally malformed batch (400 with errors[].field === 'points')
// can never succeed, so only that one is dropped. 403/404 (no vehicle, safety
// block) and 400 "no active driver assignment" are recoverable later, so the
// queued route history is kept.
export function shouldDiscardBatch(err) {
  const res = err?.response;
  if (!res || res.status !== 400) return false;
  const errors = res.data?.errors;
  return Array.isArray(errors) && errors.some((e) => e?.field === 'points');
}
