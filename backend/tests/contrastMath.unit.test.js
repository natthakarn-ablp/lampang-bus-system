'use strict';

/**
 * The contrast measurement has to agree with WCAG, not merely run.
 *
 * WHAT WAS MISSING
 * ----------------
 * capture.mjs measured two of the three accessibility numbers it reports —
 * 44x44 target size (capture.mjs, the smallTapTargets filter) and the focus
 * ring (the focusRing probe, hard-gated) — and both fail the run when they
 * regress. Contrast was the third, and it was not measured anywhere: `grep -c
 * -i contrast scripts/ui-redesign/capture.mjs` returned 0. It was being
 * asserted in review prose instead, so a palette edit could drop body text
 * below 4.5:1 and every gate would still be green.
 *
 * WHY A UNIT TEST AND NOT ONLY A CAPTURE RUN
 * ------------------------------------------
 * The measurement runs inside the page, and page code reaches Playwright as a
 * string — `node --check` does not look inside it, and a capture run needs
 * Vite up and costs minutes. The parts that can be wrong *silently* are the
 * sRGB transfer curve, the two 0.05 offsets and the large-text threshold: get
 * any of them wrong and the run still completes, still prints a number, and
 * the number is wrong in a direction nobody notices. Those are pure functions,
 * so they are checked here against the values WCAG itself publishes, in
 * milliseconds. capture.mjs injects this same module source into the page, so
 * there is one implementation rather than two copies that drift.
 *
 * The reference values below are the canonical ones: 21:1 for black on white,
 * #767676 as the darkest grey that clears AA on white (4.54) with #777777 just
 * under it (4.48), and #595959 at 7.00 for AAA.
 */

const {
  parseColor, luminance, composite, contrastRatio, requiredRatio, gradeContrast,
} = require('../../scripts/lib/contrast-math');

const rgb = (r, g, b, a) => ({ r, g, b, a: a === undefined ? 1 : a });
const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);
const round2 = (n) => Math.round(n * 100) / 100;

describe('parseColor reads what getComputedStyle actually emits', () => {
  it('reads rgb()', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it('reads rgba()', () => {
    expect(parseColor('rgba(1, 2, 3, 0.4)')).toEqual({ r: 1, g: 2, b: 3, a: 0.4 });
  });

  it('reads the space/slash form modern browsers emit', () => {
    expect(parseColor('rgb(1 2 3 / 0.4)')).toEqual({ r: 1, g: 2, b: 3, a: 0.4 });
  });

  it('returns null rather than a guess for anything else', () => {
    // 'none', a colour keyword that did not resolve, an empty string. Each has
    // to reach the caller as "cannot grade this", never as black-on-black.
    expect(parseColor('none')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('rgb(1, 2)')).toBeNull();
  });
});

describe('luminance', () => {
  it('is 0 for black and 1 for white — the ends of the scale', () => {
    expect(luminance(BLACK)).toBe(0);
    expect(luminance(WHITE)).toBe(1);
  });

  it('weights green far above blue, as the coefficients require', () => {
    // If the 0.2126/0.7152/0.0722 coefficients were ever transposed, ratios
    // would stay plausible while being wrong. This pins the ordering.
    const g = luminance(rgb(0, 255, 0));
    const r = luminance(rgb(255, 0, 0));
    const b = luminance(rgb(0, 0, 255));
    expect(`${round2(g)} ${round2(r)} ${round2(b)}`).toBe('0.72 0.21 0.07');
  });

  it('applies the sRGB curve, not a linear ramp', () => {
    // Mid-grey is 0.5 only if the transfer function was skipped.
    expect(round2(luminance(rgb(128, 128, 128)))).toBe(0.22);
  });
});

describe('contrastRatio against the WCAG reference values', () => {
  it('black on white is exactly 21:1', () => {
    expect(round2(contrastRatio(BLACK, WHITE))).toBe(21);
  });

  it('a colour against itself is 1:1', () => {
    expect(round2(contrastRatio(WHITE, WHITE))).toBe(1);
    expect(round2(contrastRatio(rgb(17, 34, 51), rgb(17, 34, 51)))).toBe(1);
  });

  it('is order-independent', () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(contrastRatio(WHITE, BLACK));
  });

  it('puts #767676 on white at 4.54 and #777777 at 4.48 — the AA boundary', () => {
    // The published pair either side of 4.5. A wrong offset or curve moves
    // these by more than the 0.06 that separates them.
    expect(round2(contrastRatio(rgb(118, 118, 118), WHITE))).toBe(4.54);
    expect(round2(contrastRatio(rgb(119, 119, 119), WHITE))).toBe(4.48);
  });

  it('puts #595959 on white at 7.00 — the AAA boundary', () => {
    expect(round2(contrastRatio(rgb(89, 89, 89), WHITE))).toBe(7);
  });
});

describe('requiredRatio — the large-text threshold', () => {
  it('asks 4.5 of body text', () => {
    expect(requiredRatio(16, 400)).toBe(4.5);
  });

  it('asks 3 of 24px and above at any weight', () => {
    expect(requiredRatio(24, 400)).toBe(3);
  });

  it('asks 3 of 18.66px only when bold', () => {
    // 14pt bold = 18.66px. At the same size non-bold it is still body text.
    expect(requiredRatio(18.66, 700)).toBe(3);
    expect(requiredRatio(18.66, 400)).toBe(4.5);
  });

  it('does not round 18.65px bold up into the large bracket', () => {
    expect(requiredRatio(18.65, 700)).toBe(4.5);
  });
});

describe('composite — translucent text over its background', () => {
  it('50% black over white lands on mid-grey', () => {
    expect(composite(rgb(0, 0, 0, 0.5), WHITE)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it('a fully opaque foreground is unchanged by its background', () => {
    expect(composite(rgb(10, 20, 30, 1), WHITE)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it('a fully transparent foreground becomes the background', () => {
    expect(composite(rgb(10, 20, 30, 0), WHITE)).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
});

describe('gradeContrast', () => {
  it('passes black body text on white', () => {
    expect(gradeContrast('rgb(0, 0, 0)', WHITE, 16, 400))
      .toEqual({ status: 'pass', ratio: 21, need: 4.5 });
  });

  it('fails 50%-opacity black body text, which composites to 3.98', () => {
    // The case a ratio computed on the raw colour would have passed at 21:1.
    expect(gradeContrast('rgba(0, 0, 0, 0.5)', WHITE, 16, 400))
      .toEqual({ status: 'fail', ratio: 3.98, need: 4.5 });
  });

  it('passes that same colour as large text, where 3 is the bar', () => {
    expect(gradeContrast('rgba(0, 0, 0, 0.5)', WHITE, 24, 400))
      .toEqual({ status: 'pass', ratio: 3.98, need: 3 });
  });

  it('passes a value that displays as exactly the threshold', () => {
    // #767676 rounds to 4.54, comfortably over. The point of comparing the
    // rounded value is that a ratio printed as "4.5" is not then failed by
    // floating-point dust in the digits the report does not show.
    const g = gradeContrast('rgb(118, 118, 118)', WHITE, 16, 400);
    expect(`${g.status} ${g.ratio}`).toBe('pass 4.54');
  });

  it('fails #777777 body text — one step past the boundary', () => {
    const g = gradeContrast('rgb(119, 119, 119)', WHITE, 16, 400);
    expect(`${g.status} ${g.ratio}`).toBe('fail 4.48');
  });

  it('reports unmeasurable when the background could not be resolved', () => {
    // The whole point of the null: an element over a background image or a
    // translucent ancestor must not be graded against a guessed backdrop. This
    // is the same rule the readiness collector learned — could-not-evaluate and
    // evaluated-clean are never the same value.
    expect(gradeContrast('rgb(0, 0, 0)', null, 16, 400))
      .toEqual({ status: 'unmeasurable', ratio: null, need: null });
  });

  it('reports unmeasurable when the foreground could not be parsed', () => {
    expect(gradeContrast('none', WHITE, 16, 400).status).toBe('unmeasurable');
  });

  it('never reports pass for something it did not grade', () => {
    // A guard against the shape rather than the instance: no input may produce
    // a pass without a ratio to back it.
    const inputs = [
      ['rgb(0,0,0)', null], ['none', WHITE], ['', null], ['rgba(0,0,0,0)', WHITE],
    ];
    for (const [color, bg] of inputs) {
      const g = gradeContrast(color, bg, 16, 400);
      if (g.status === 'pass') expect(typeof g.ratio).toBe('number');
    }
    // and the transparent-text case specifically is a fail, not a pass
    expect(gradeContrast('rgba(0, 0, 0, 0)', WHITE, 16, 400).status).toBe('fail');
  });
});

describe('the module capture.mjs injects', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '..', '..', 'scripts', 'lib', 'contrast-math.js');
  const source = fs.readFileSync(SRC, 'utf8');

  it('survives the two rewrites the injector applies', () => {
    // capture.mjs strips 'use strict' and the CJS tail, then drops the result
    // inside a page IIFE. If either regex stops matching, the page gets code it
    // cannot run — and the failure would only show up minutes into a capture.
    const injected = source
      .replace(/^\s*'use strict';\s*$/m, '')
      .replace(/^module\.exports[\s\S]*$/m, '');
    expect(`still has 'use strict': ${/'use strict'/.test(injected)}`)
      .toBe("still has 'use strict': false");
    expect(`still has module.exports: ${/module\.exports/.test(injected)}`)
      .toBe('still has module.exports: false');
    expect(`still defines gradeContrast: ${/function gradeContrast/.test(injected)}`)
      .toBe('still defines gradeContrast: true');
    // and what is left has to actually parse as page code
    expect(() => new Function(`${injected}\nreturn typeof gradeContrast;`)).not.toThrow();
    expect(new Function(`${injected}\nreturn typeof gradeContrast;`)()).toBe('function');
  });

  it('has no import or export the page could not run', () => {
    expect(`has import: ${/^\s*(import|export)\s/m.test(source)}`).toBe('has import: false');
  });

  it('is the module capture.mjs actually reads', () => {
    // Pins the path, so moving the file breaks this test rather than the run.
    const capture = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'ui-redesign', 'capture.mjs'), 'utf8');
    expect(`reads contrast-math: ${/contrast-math\.js/.test(capture)}`)
      .toBe('reads contrast-math: true');
    expect(`injects it into MEASURE: ${capture.includes('${CONTRAST_MATH}')}`)
      .toBe('injects it into MEASURE: true');
  });
});
