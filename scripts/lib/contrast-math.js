'use strict';

/**
 * contrast-math.js — the WCAG 1.4.3 colour arithmetic, on its own so it can be
 * checked without a browser.
 *
 * WHY THIS IS A MODULE AND NOT JUST INLINE IN capture.mjs
 * ------------------------------------------------------
 * capture.mjs measures three accessibility numbers. Two of them — 44px target
 * size and the focus ring — were already measured and gated. Contrast was the
 * one being asserted in review prose instead of measured, so a palette edit
 * could drop text below 4.5:1 and no run would notice.
 *
 * The measurement half has to run inside the page (it needs getComputedStyle),
 * and page code reaches Playwright as a string — which `node --check` does not
 * look inside. Putting the arithmetic here means the part that can be wrong
 * silently (the sRGB curve, the 0.05 offsets, the large-text threshold) is
 * checked against the WCAG reference values in a unit test that costs
 * milliseconds, while capture.mjs injects this exact source into the page. One
 * copy, two consumers.
 *
 * Injected verbatim by capture.mjs, so: no imports, no optional chaining on
 * anything the page might not have, and the CJS export at the very bottom
 * where the injector can strip it.
 */

/**
 * Parse a computed colour. getComputedStyle always resolves to rgb()/rgba(),
 * so named colours and hex never reach this.
 *
 * @param {string} str
 * @returns {{r: number, g: number, b: number, a: number}|null}
 */
function parseColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** One sRGB channel, 0-255, to linear light. */
function toLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
function luminance(c) {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** Alpha-composite `fg` over an opaque `bg`. */
function composite(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/** WCAG contrast ratio. Order-independent: (L1 + 0.05) / (L2 + 0.05). */
function contrastRatio(x, y) {
  const a = luminance(x);
  const b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The threshold this text has to clear.
 *
 * WCAG defines large text as 18pt, or 14pt bold. At the 96dpi the CSS px
 * assumes that is 24px and 18.66px — the same numbers the spec's own
 * understanding document gives.
 *
 * @param {number} fontSizePx  computed font-size in px
 * @param {number} fontWeight  computed numeric weight
 * @returns {3|4.5}
 */
function requiredRatio(fontSizePx, fontWeight) {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
}

/**
 * Grade one piece of text.
 *
 * A ratio computed against a background we could not determine is worse than
 * no ratio at all, so an absent `bg` is reported as unmeasurable rather than
 * graded against a guess.
 *
 * @param {string} colorStr   computed `color`
 * @param {{r,g,b,a}|null} bg the resolved opaque background, or null
 * @param {number} fontSizePx
 * @param {number} fontWeight
 * @returns {{status: 'pass'|'fail'|'unmeasurable', ratio: number|null, need: number|null}}
 */
function gradeContrast(colorStr, bg, fontSizePx, fontWeight) {
  const fg = parseColor(colorStr);
  if (!fg || !bg) return { status: 'unmeasurable', ratio: null, need: null };
  const need = requiredRatio(fontSizePx, fontWeight);
  const ratio = contrastRatio(composite(fg, bg), bg);
  // Round to the 2dp the report prints before comparing, so a value that
  // displays as "4.5" is not failed by floating-point dust below it.
  const shown = Math.round(ratio * 100) / 100;
  return { status: shown >= need ? 'pass' : 'fail', ratio: shown, need };
}

module.exports = { parseColor, toLinear, luminance, composite, contrastRatio, requiredRatio, gradeContrast };
