'use strict';

/**
 * Research protocol state.
 *
 * This is the machine-readable half of a human decision. `frozen` and
 * `research_lead_signed_off` may only be flipped to `true` when the Research
 * lead has actually signed the protocol document named in `signoff_document`
 * — the values below are the current, honest state, and a test asserts that a
 * default build never claims otherwise.
 *
 * Populating this file is a Phase 0 exit-gate item in
 * `docs/project-closure/master-project-closure-plan.md`. Until then the
 * research export reports `research_claims_allowed: false` with
 * `research_protocol_not_frozen` as a blocking reason, which is the correct
 * answer rather than an error.
 */

const RESEARCH_PROTOCOL = Object.freeze({
  /** True only after the Research lead signs the protocol. */
  frozen: false,

  /** Protocol document version, e.g. "1.0". Null while unfrozen. */
  version: null,

  /** Inclusive ISO dates bounding the pre/post observation windows. */
  baseline_start: null,
  baseline_end: null,
  post_start: null,
  post_end: null,

  /** Population/sampling definition confirmed with the Research lead. */
  population_defined: false,

  /**
   * Whether parents, students, sub-account teachers and meeting participants
   * are inside the research population or treated as external evidence.
   * Phase 0 decision; null means undecided.
   */
  population_includes_parents: null,
  population_includes_students: null,
  population_includes_teacher_subaccounts: null,

  /** Instrument versions, keyed by instrument code (DME-6, MIE-6, ...). */
  instrument_versions: Object.freeze({}),

  /** Set to the signed document path once it exists. */
  signoff_document: 'docs/project-closure/research-protocol-decision-package.md',
  research_lead_signed_off: false,
});

/**
 * External evidence registry: surveys, interviews, meeting minutes and
 * workload diaries that have actually been collected, keyed by metric key.
 * Empty until instruments are run under an approved protocol. Entries must
 * carry `collected: true`, an `instrument_version` and a `collected_at` date
 * before `researchReadiness` will count them.
 */
const EXTERNAL_EVIDENCE_REGISTRY = Object.freeze({});

module.exports = { RESEARCH_PROTOCOL, EXTERNAL_EVIDENCE_REGISTRY };
