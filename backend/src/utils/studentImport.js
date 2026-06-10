'use strict';

// Phase 10.13A-24B — student import duplicate decision, scoped to ONE school.
// `existing` is the row found by (school_id, student_code) in THIS school, or
// undefined/null when no such row exists. The same code at a DIFFERENT school is
// not passed here (the lookup is school-scoped), so it correctly yields INSERT.
//
//   SKIP       — an active student with this code already exists in this school
//   REACTIVATE — a soft-deleted student with this code exists in this school
//   INSERT     — no student with this code in this school (incl. cross-school
//                code collisions) → create a new surrogate-id record
function classifyStudentImport(existing) {
  if (existing && !existing.is_deleted) return 'SKIP';
  if (existing && existing.is_deleted) return 'REACTIVATE';
  return 'INSERT';
}

module.exports = { classifyStudentImport };
