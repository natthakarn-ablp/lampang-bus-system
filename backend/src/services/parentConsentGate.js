'use strict';

/**
 * parentConsentGate.js  (#3 — "parent sees only children that are LINKED and
 * have CONSENT")
 *
 * The /api/parent LIFF endpoints already enforce LINKED + parent_student.approved
 * (via line.service.getChildrenByBoundPhone). They did NOT enforce CONSENT — that
 * only existed for the flag-gated QR viewer. This module adds the missing consent
 * half for the always-on parent API, but keeps it DARK by default so the live
 * parent experience is unchanged until consent text + DPO sign-off land.
 *
 * When env.features.parentConsentRequired is false → guardParentView allows
 * everything with NO DB hit (byte-for-byte the old behaviour). When true → a
 * linked parent must additionally hold a granted tracking consent.
 *
 * Pure decision (isParentViewAllowed) + injectable db/flag so it is fully
 * unit-testable without a DB.
 */

const env = require('../config/env');
const { pool } = require('../config/database');

// Consent types that satisfy the parent tracking-view gate. We accept the QR
// opt-in too so a parent who already consented via the QR flow isn't asked twice.
const PARENT_CONSENT_TYPES = ['parent_tracking_optin', 'qr_parent_optin'];

/**
 * Pure gate decision.
 * @param {{featureEnabled:boolean, consentGranted:boolean}} p
 * @returns {boolean}
 */
function isParentViewAllowed({ featureEnabled, consentGranted }) {
  if (!featureEnabled) return true;          // dark → unchanged behaviour
  return consentGranted === true;            // gated → consent is mandatory
}

/**
 * Has this LINE-verified parent granted a tracking consent (latest wins)?
 * @param {string|null} lineUserId
 * @param {object} db - mysql2 pool/conn (injectable for tests)
 * @returns {Promise<boolean>}
 */
async function hasParentTrackingConsent(lineUserId, db = pool) {
  if (!lineUserId) return false;
  const [[row]] = await db.query(
    `SELECT consent_status FROM consent_records
      WHERE line_user_id = ? AND consent_type IN (?, ?)
      ORDER BY id DESC LIMIT 1`,
    [lineUserId, PARENT_CONSENT_TYPES[0], PARENT_CONSENT_TYPES[1]]
  );
  return !!row && row.consent_status === 'granted';
}

/**
 * Resolve whether a verified LINE parent may see a child's detailed tracking
 * data. Short-circuits (no DB) when the feature is dark.
 *
 * @param {string|null} lineUserId
 * @param {{db?:object, featureEnabled?:boolean}} [opts]
 * @returns {Promise<{allowed:boolean, featureEnabled:boolean, consentGranted?:boolean}>}
 */
async function guardParentView(lineUserId, { db = pool, featureEnabled = env.features.parentConsentRequired } = {}) {
  if (!featureEnabled) return { allowed: true, featureEnabled: false };
  const consentGranted = await hasParentTrackingConsent(lineUserId, db);
  return { allowed: isParentViewAllowed({ featureEnabled, consentGranted }), featureEnabled: true, consentGranted };
}

module.exports = { PARENT_CONSENT_TYPES, isParentViewAllowed, hasParentTrackingConsent, guardParentView };
