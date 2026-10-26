'use strict';

/**
 * The consent gate has to hold on the LIST endpoint too.
 *
 * `/api/parent/children` returns each child's plate number and driver name.
 * Gating only `/status`, `/history` and `/eta` left the gate defeatable by
 * reading the list — a non-consented parent still got their child's bus and
 * driver. This suite pins the closed version: identity survives so the UI can
 * name the child in the consent prompt, tracking data does not.
 *
 * It also pins the boot dependency. Turning the gate on without the router
 * that lets a parent consent locks every parent out with no way back in, so
 * that combination must fail at startup rather than on a parent's phone.
 */

const gate = require('../src/services/parentConsentGate');
const { validateFeatureDependencies } = require('../src/config/env');

const CHILD = {
  id: 101, prefix: 'เด็กชาย', first_name: 'สมชาย', last_name: 'ใจดี',
  grade: 'ป.4', classroom: '2', school_name: 'โรงเรียนทดสอบ',
  plate_no: 'นข 2210 ลำปาง', driver_name: 'สมศักดิ์ ขับดี',
};

describe('child list gate', () => {
  it('changes nothing while the feature is dark', () => {
    const r = gate.applyChildListGate([CHILD], { featureEnabled: false, allowed: true });
    expect(r.children).toEqual([CHILD]);
    expect(r.consent_required).toBe(false);
  });

  it('changes nothing once consent is granted', () => {
    const r = gate.applyChildListGate([CHILD], {
      featureEnabled: true, allowed: true, consentGranted: true,
    });
    expect(r.children[0].plate_no).toBe('นข 2210 ลำปาง');
    expect(r.children[0].driver_name).toBe('สมศักดิ์ ขับดี');
    expect(r.consent_required).toBe(false);
    expect(r.consent_granted).toBe(true);
  });

  it('redacts the vehicle and driver when consent is missing', () => {
    const r = gate.applyChildListGate([CHILD], {
      featureEnabled: true, allowed: false, consentGranted: false,
    });
    expect(r.children[0].plate_no).toBeNull();
    expect(r.children[0].driver_name).toBeNull();
    expect(r.children[0].tracking_redacted).toBe(true);
    expect(r.consent_required).toBe(true);
    expect(r.consent_granted).toBe(false);
  });

  it('keeps enough identity to name the child in the consent prompt', () => {
    // An empty list would read as "you have no children", which is a worse
    // answer than "you need to consent" — and the guardian relationship is
    // already established by the school approval plus the LINE binding.
    const [child] = gate.applyChildListGate([CHILD], {
      featureEnabled: true, allowed: false, consentGranted: false,
    }).children;
    expect(child.id).toBe(101);
    expect(child.first_name).toBe('สมชาย');
    expect(child.school_name).toBe('โรงเรียนทดสอบ');
  });

  it('redacts every tracking field the list can carry', () => {
    const redacted = gate.redactUnconsentedChild(CHILD);
    for (const field of gate.TRACKING_FIELDS) {
      expect(redacted[field]).toBeNull();
    }
    expect(gate.TRACKING_FIELDS).toContain('plate_no');
    expect(gate.TRACKING_FIELDS).toContain('driver_name');
  });

  it('does not mutate the row it was given', () => {
    const original = { ...CHILD };
    gate.redactUnconsentedChild(CHILD);
    expect(CHILD).toEqual(original);
  });

  it('handles an empty list without inventing a consent prompt', () => {
    const r = gate.applyChildListGate([], { featureEnabled: true, allowed: true, consentGranted: true });
    expect(r.children).toEqual([]);
    expect(r.consent_required).toBe(false);
  });
});

describe('parent consent feature dependency', () => {
  it('refuses to start the gate without a way for a parent to consent', () => {
    // /api/consent is mounted by FEATURE_VEHICLE_QR. Without it, a gated
    // parent has no route to grant consent and is locked out permanently.
    expect(() => validateFeatureDependencies({
      FEATURE_PARENT_CONSENT_REQUIRED: 'true',
      FEATURE_VEHICLE_QR: 'false',
    })).toThrow(/FEATURE_PARENT_CONSENT_REQUIRED requires FEATURE_VEHICLE_QR/);

    expect(() => validateFeatureDependencies({
      FEATURE_PARENT_CONSENT_REQUIRED: 'true',
    })).toThrow(/FEATURE_VEHICLE_QR/);
  });

  it('allows the pair when both are on', () => {
    expect(validateFeatureDependencies({
      FEATURE_PARENT_CONSENT_REQUIRED: 'true',
      FEATURE_VEHICLE_QR: 'true',
    })).toBe(true);
  });

  it('leaves the current production combination valid', () => {
    // Both off today; the gate must not start demanding anything of a system
    // that has not turned it on.
    expect(validateFeatureDependencies({ FEATURE_DRIVER_REGISTRATION: 'true' })).toBe(true);
  });
});
