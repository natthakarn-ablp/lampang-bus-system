'use strict';

/**
 * The manual screenshots must show the system a user actually meets, and the
 * harness that takes them must fail loudly when they do not.
 *
 * Three defects found on 2026-09-06 by comparing the 83 committed PNGs with
 * the pages they claim to show:
 *
 *  1. Five images were the ErrorBoundary screen ("ระบบพบปัญหาที่ไม่คาดคิด"):
 *     admin/08-readiness, province/09-readiness, province/10-emergencies,
 *     affiliation/09-emergencies, school/10-emergencies. The readiness page
 *     crashed because the '/api/readiness' fixture still had the pre-service
 *     {overall, checks} shape while DeploymentReadiness.jsx reads
 *     data.status_buckets / data.sections / data.gaps (see
 *     backend/src/services/deploymentReadiness.service.js:273-281); the three
 *     emergency pages crashed because their fixture carried no `meta` and the
 *     pages stored it unguarded before reading meta.total on every render.
 *
 *  2. Four images were byte-identical to another shot, because the `act`
 *     click targets no longer matched the button labels ("แบบเดิม", not
 *     "นำเข้าแบบเดิม"; the transfer modal opens from inside the edit modal;
 *     the per-pupil button reads "รับกลับบ้าน" in the evening session).
 *
 *  3. Every shot was taken with feature flags absent, because the harness
 *     seeded localStorage.user but never localStorage.features, which
 *     hooks/useAuth.jsx:19 reads. Production runs FEATURE_DRIVER_REGISTRATION
 *     on, so the driver's middle tab reads "รายชื่อเด็ก"
 *     (MobileBottomNav.jsx:15) — the images showed the flag-off build's
 *     "ขึ้นทะเบียน", contradicting the manuals' own text.
 *
 * This suite guards the harness at source level (there is no frontend test
 * runner in this repository — handoff §5) plus the one runtime property that
 * can be checked without a browser: no two committed screenshots are the same
 * file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CAPTURE = read('scripts/ui-redesign/capture.mjs');
const SHOTS = read('scripts/ui-redesign/manual-screenshots.mjs');

describe('capture harness seeds the flags production runs', () => {
  it('writes localStorage.features, not just the user', () => {
    expect(CAPTURE).toMatch(/localStorage\.setItem\('features',/);
  });

  it('declares PROD_FEATURES with driverRegistration on', () => {
    const block = CAPTURE.match(/const PROD_FEATURES = \{[\s\S]*?\n\};/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/driverRegistration:\s*true/);
    // Everything else is off in production (handoff 2026-09-05 §3). A flag
    // flipped here without flipping it on the server would put a menu in the
    // manual that no user can see.
    for (const flag of [
      'adminPasswordRecovery', 'vehicleQr', 'driverShiftSelection', 'qrLevel3',
      'eta', 'geofence', 'routeDeviation', 'parentConsentRequired', 'participationCases',
    ]) {
      expect(block[0]).toMatch(new RegExp(`${flag}:\\s*false`));
    }
  });
});

describe('readiness fixture matches the service payload', () => {
  const service = read('backend/src/services/deploymentReadiness.service.js');

  it('the service still returns sections / status_buckets / gaps', () => {
    for (const key of ['sections', 'status_buckets', 'gaps', 'hard_gate_count', 'warning_count']) {
      expect(service).toContain(key);
    }
  });

  it('the fixture carries those keys and not the retired {overall, checks} shape', () => {
    const fixture = CAPTURE.match(/'\/api\/readiness': \{ data: \{[\s\S]*?\n  \} \},/);
    expect(fixture).not.toBeNull();
    for (const key of ['sections', 'status_buckets', 'gaps', 'hard_gate_count', 'warning_count']) {
      expect(fixture[0]).toContain(key);
    }
    expect(fixture[0]).not.toMatch(/^\s*overall:/m);
  });

  it('the paginated fixtures carry meta, like sendSuccess does', () => {
    expect(CAPTURE).toMatch(/const EMERGENCIES_PAGED = \{ data: EMERGENCIES, meta: \{/);
    for (const role of ['school', 'affiliation', 'province']) {
      expect(CAPTURE).toMatch(new RegExp(`'/api/${role}/emergencies':\\s*EMERGENCIES_PAGED`));
    }
  });
});

describe('the emergency pages survive a response without meta', () => {
  const pages = [
    'frontend/src/pages/school/EmergencyList.jsx',
    'frontend/src/pages/affiliation/AffEmergencyList.jsx',
    'frontend/src/pages/province/ProvEmergencyList.jsx',
  ];

  it.each(pages)('%s falls back instead of storing undefined', (rel) => {
    const src = read(rel);
    // The exact defect: setMeta(res.data.meta) with no fallback, followed by
    // meta.total on the next render.
    expect(src).not.toMatch(/setMeta\(res\.data\.meta\)\s*;/);
    expect(src).toMatch(/setMeta\(res\.data\.meta \|\| \{/);
    expect(src).toMatch(/Array\.isArray\(res\.data\.data\)/);
    expect(src).toContain('meta.total');
  });
});

describe('the capture script refuses to save a broken shot', () => {
  it('fails the shot when the page fell into the ErrorBoundary', () => {
    expect(SHOTS).toContain('ระบบพบปัญหาที่ไม่คาดคิด');
    expect(SHOTS).toMatch(/throw new Error\('ErrorBoundary/);
  });

  it('reports two shots that came out byte-identical', () => {
    expect(SHOTS).toMatch(/createHash\('sha256'\)/);
    expect(SHOTS).toContain('ภาพซ้ำ');
  });

  it('clicks the labels the pages actually render', () => {
    // "นำเข้าแบบเดิม" lives in a title attribute; the button reads "แบบเดิม".
    expect(SHOTS).not.toContain('button:has-text("นำเข้าแบบเดิม")');
    expect(SHOTS).toContain('button:has-text("แบบเดิม")');
    // The transfer modal is reached through the edit modal.
    expect(SHOTS).toContain('button:has-text("ขอโอนย้ายนักเรียน")');
    // The per-pupil action is "ขึ้นรถ" in the morning and "รับกลับบ้าน" in the evening.
    expect(SHOTS).toContain('button:has-text("รับกลับบ้าน")');
  });
});

describe('no two committed screenshots are the same image', () => {
  const dir = path.join(ROOT, 'docs/manual-html/screenshots');

  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.png') ? [p] : [];
  });

  it('every PNG under docs/manual-html/screenshots is unique', () => {
    const byHash = new Map();
    for (const file of walk(dir)) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      byHash.set(h, [...(byHash.get(h) || []), rel]);
    }
    const dups = [...byHash.values()].filter((ids) => ids.length > 1);
    expect(dups).toEqual([]);
  });
});
