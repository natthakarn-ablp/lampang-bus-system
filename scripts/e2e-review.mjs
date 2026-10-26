/**
 * End-to-end UI review against a running sandbox stack.
 *
 * This is NOT the mocked screenshot pass in scripts/browser-review.mjs. That one
 * injects a fake token into localStorage and never talks to a backend, so it can
 * photograph a page that would 403 for a real user. This script logs in through
 * the real form, against a real API, on a real database, and then walks whatever
 * navigation that role is actually given.
 *
 * What it can decide (execution plan A2-3, and the machine-checkable half of
 * Phase 8): does every menu entry load, does the console stay clean, does the
 * layout avoid horizontal overflow at 390/768/1440, is the primary navigation
 * reachable by keyboard, and does a role that reaches for another role's route
 * get a refusal rather than a crash or a blank screen.
 *
 * It also checks the four things a walk of the menu never touches: a deep link
 * opened in a fresh tab that already holds the session, the browser Back
 * button, one real form submit that has to survive a reload and then be undone
 * again, and the same protected URLs with no session at all.
 *
 * What it CANNOT decide, and must never be presented as: task completion rate,
 * time on task, error rate or help requests for REAL users, and the signature of
 * a role representative. Phase 8's exit gate is people; this only clears defects
 * out of their way first.
 *
 * Prereqs - the stack must already be up:
 *   docker container lampang_mysql running, database seeded by
 *   backend/scripts/seed-synthetic-staging.js --sandbox
 *   backend on :3000 pointed at the sandbox DB
 *   frontend dev server on :5173
 *
 * Run:
 *   node scripts/e2e-review.mjs
 *   BASE_URL=http://localhost:5173 OUT_DIR=outputs/ui-review/<ts> node scripts/e2e-review.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const OUT = process.env.OUT_DIR || path.join('outputs', 'ui-review', stamp());
const PW = process.env.SCHOOLBUS_SYNTHETIC_LOGIN_PW || 'synthetic-staging-only';
const HEADLESS = process.env.HEADED !== '1';

// Seeded by seed-synthetic-staging.js. These are synthetic accounts on a
// disposable database; they are not, and must never be, production credentials.
const ROLES = [
  { role: 'admin', username: 'syn_admin' },
  { role: 'province', username: 'syn_province' },
  { role: 'affiliation', username: 'syn_aff_001' },
  { role: 'transport', username: 'syn_transport' },
  // syn_school_001 is a scope-bearing school account. loadtest_user_* exist for
  // the load generator and carry a different password, so they are not the right
  // subject for a role review.
  { role: 'school', username: 'syn_school_001' },
  { role: 'driver', username: 'syn_drv_0001' },
];

/**
 * Admin holds unified scope by design (master plan section 7, Role Acceptance
 * Matrix), so reaching another role's page is correct behaviour for admin and a
 * refusal expectation would be wrong. Every other role must be refused.
 */
const UNIFIED_SCOPE_ROLES = new Set(['admin']);

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const findings = [];
function finding(severity, role, where, what, detail) {
  findings.push({ severity, role, where, what, detail });
  process.stdout.write(`[e2e] ${severity.toUpperCase()} ${role} ${where}: ${what}\n`);
}

/**
 * Console and network noise is collected per navigation rather than globally, so
 * a failure can be attributed to the page that produced it instead of to
 * whichever page happened to be open when it surfaced.
 */
function watch(page) {
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err.message).slice(0, 300)}`));
  const thirdParty = [];
  const isOwn = (url) => {
    try {
      return new URL(url).origin === new URL(BASE).origin;
    } catch {
      return false;
    }
  };
  page.on('requestfailed', (req) => {
    const line = `${req.method()} ${req.url().slice(0, 200)} :: ${req.failure()?.errorText || 'failed'}`;
    (isOwn(req.url()) ? failedRequests : thirdParty).push(line);
  });
  page.on('response', (res) => {
    if (res.status() < 500) return;
    const line = `${res.status()} ${res.url().slice(0, 200)}`;
    (isOwn(res.url()) ? failedRequests : thirdParty).push(line);
  });
  return {
    drain() {
      const out = {
        consoleErrors: [...consoleErrors],
        failedRequests: [...failedRequests],
        thirdParty: [...thirdParty],
      };
      consoleErrors.length = 0;
      failedRequests.length = 0;
      thirdParty.length = 0;
      return out;
    },
  };
}

async function login(page, username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-username', username);
  await page.fill('#login-password', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => null);
  return !page.url().includes('/login');
}

/** Every in-app link the role is actually offered, deduplicated. */
async function navLinks(page) {
  return page.$$eval('a[href^="/"]', (as) => {
    const seen = new Set();
    for (const a of as) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('//') || href.includes('#')) continue;
      seen.add(href);
    }
    return [...seen];
  });
}

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return Math.max(0, de.scrollWidth - de.clientWidth);
  });
}

async function bodyText(page) {
  return page.evaluate(() => (document.body ? document.body.innerText.trim() : ''));
}

async function reviewRole(browser, { role, username }) {
  const context = await browser.newContext({ viewport: VIEWPORTS[2], locale: 'th-TH' });
  const page = await context.newPage();
  const noise = watch(page);
  const result = { role, username, loggedIn: false, routes: [], keyboard: null, crossRole: [] };

  result.loggedIn = await login(page, username);
  if (!result.loggedIn) {
    finding('critical', role, '/login', 'เข้าสู่ระบบไม่สำเร็จด้วยบัญชี sandbox', JSON.stringify(noise.drain()));
    await context.close();
    return result;
  }
  noise.drain();

  const links = await navLinks(page);
  result.linkCount = links.length;
  if (links.length === 0) {
    finding('high', role, page.url(), 'ไม่พบลิงก์นำทางเลยหลัง login', '');
  }

  for (const href of links) {
    const row = { href, viewports: {} };
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForLoadState('networkidle').catch(() => null);
      const text = await bodyText(page);
      const overflow = await horizontalOverflow(page);
      const drained = noise.drain();
      row.viewports[vp.name] = {
        url: page.url(),
        textLength: text.length,
        overflowPx: overflow,
        consoleErrors: drained.consoleErrors.length,
        failedRequests: drained.failedRequests.length,
      };

      if (text.length < 40) {
        finding('high', role, `${href} @${vp.name}`, 'หน้าว่างหรือแทบไม่มีเนื้อหา', `textLength=${text.length}`);
      }
      if (overflow > 4) {
        finding('medium', role, `${href} @${vp.name}`, 'เนื้อหาล้นแนวนอน', `scrollWidth เกิน ${overflow}px`);
      }
      if (drained.consoleErrors.length > 0) {
        finding('medium', role, `${href} @${vp.name}`, 'console error', drained.consoleErrors.slice(0, 3).join(' | '));
      }
      if (drained.failedRequests.length > 0) {
        finding('high', role, `${href} @${vp.name}`, 'request ของระบบเองล้มเหลวหรือ 5xx', drained.failedRequests.slice(0, 3).join(' | '));
      }
      if (drained.thirdParty.length > 0) {
        // Recorded, not raised: an external dependency that cannot be reached
        // from here says nothing about the application, but a page that needs
        // the public internet to render is worth knowing before an offline site.
        finding('info', role, `${href} @${vp.name}`, 'external asset โหลดไม่ได้จากเครื่องนี้', drained.thirdParty.slice(0, 2).join(' | '));
      }
    }
    result.routes.push(row);
  }

  // Keyboard reachability of the primary navigation: tabbing from a fresh load
  // must land on something focusable and visible, or the role cannot navigate
  // without a mouse at all.
  await page.setViewportSize(VIEWPORTS[2]);
  await page.goto(`${BASE}${links[0] || '/'}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  // Focus before React has rendered lands on an empty document, which reads as
  // "no element accepts focus" when the page simply was not there yet.
  await page.waitForLoadState('networkidle').catch(() => null);
  await page.bringToFront().catch(() => null);
  // Focus has to start inside the document, otherwise Tab moves through browser
  // chrome and the page records no stops at all.
  await page.evaluate(() => {
    const first = document.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
    else document.body.setAttribute('tabindex', '-1');
  }).catch(() => null);
  const focusTrail = [];
  for (let i = 0; i < 12; i += 1) {
    focusTrail.push(await page.evaluate(() => {
      /* eslint-disable no-undef */
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 40),
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden',
        outline: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
      };
    }));
    await page.keyboard.press('Tab');
  }
  const reachable = focusTrail.filter(Boolean);
  result.keyboard = { stops: reachable.length, withVisibleFocus: reachable.filter((f) => f.outline).length };
  if (reachable.length === 0) {
    finding('high', role, 'keyboard', 'กด Tab แล้วไม่มี element ใดรับ focus', '');
  } else if (result.keyboard.withVisibleFocus === 0) {
    finding('medium', role, 'keyboard', 'ไม่มี focus indicator ที่มองเห็นได้ในลำดับ tab แรก', `stops=${reachable.length}`);
  }

  noise.drain();
  // Saved so the cross-role probe can reuse this session. loginLimiter
  // (backend/src/routes/auth.routes.js:55-57) allows 20 attempts per IP per 15
  // minutes and, unlike every other limiter in the app, has no test skip - by
  // design, since lockout has to be testable. Logging in once per role keeps a
  // full sweep at 6 attempts instead of 20+.
  result.storageState = await context.storageState();
  await context.close();
  return result;
}

/**
 * A role reaching for another role's route must be refused, and the refusal must
 * be a readable state rather than a blank page or a stack trace. Menu hiding is
 * not a control; this is the UI-side counterpart to the server scope tests.
 */
async function crossRoleProbe(browser, roleResults) {
  const byRole = new Map(roleResults.map((r) => [r.role, r]));
  const probes = [];
  for (const source of roleResults) {
    if (!source.loggedIn) continue;
    for (const other of roleResults) {
      if (other.role === source.role || !other.loggedIn) continue;
      const target = (other.routes[0] || {}).href;
      if (!target) continue;
      if (byRole.get(source.role).routes.some((r) => r.href === target)) continue;
      probes.push({ from: source.role, username: source.username, target, ownedBy: other.role });
    }
  }

  const out = [];
  for (const probe of probes) {
    const state = byRole.get(probe.from)?.storageState;
    if (!state) continue;
    const context = await browser.newContext({ viewport: VIEWPORTS[2], locale: 'th-TH', storageState: state });
    const page = await context.newPage();
    const noise = watch(page);
    {
      noise.drain();
      await page.goto(`${BASE}${probe.target}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForLoadState('networkidle').catch(() => null);
      const text = await bodyText(page);
      const drained = noise.drain();
      const refused = /ไม่มีสิทธิ|ไม่ได้รับอนุญาต|403|forbidden|permission/i.test(text)
        || !page.url().includes(probe.target);
      const expectRefusal = !UNIFIED_SCOPE_ROLES.has(probe.from);
      out.push({ ...probe, url: page.url(), refused, expectRefusal, textLength: text.length });
      if (expectRefusal && !refused && text.length > 200) {
        finding('critical', probe.from, probe.target,
          `เข้าถึงหน้าของบทบาท ${probe.ownedBy} ได้โดยไม่ถูกปฏิเสธ`,
          `textLength=${text.length} url=${page.url()}`);
      }
      if (expectRefusal && refused && text.length < 40) {
        finding('medium', probe.from, probe.target,
          'ถูกปฏิเสธด้วยหน้าว่าง แทนที่จะเป็นข้อความบอกเหตุผล', `textLength=${text.length}`);
      }
      if (drained.consoleErrors.length > 0) {
        finding('low', probe.from, probe.target, 'console error ตอนถูกปฏิเสธ', drained.consoleErrors.slice(0, 2).join(' | '));
      }
    }
    await context.close();
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Session-shape checks: deep link, browser back, a real write, and the
 * unauthenticated case.
 *
 * The route walk above always arrives at a page from the page before it, in
 * one long-lived context that logged in through the form. That is the one path
 * a real user almost never takes first. The probes below cover the ones they
 * do take: a bookmarked URL opened in a fresh tab that already holds the
 * session, the Back button, a form that actually writes, and the same URLs
 * with no session at all.
 *
 * All of them reuse the storageState saved by reviewRole. loginLimiter
 * (backend/src/routes/auth.routes.js:55-57) allows 20 attempts per IP per 15
 * minutes with no test skip, so a probe that logged in again would push a full
 * sweep past the limit and turn every later check into a false 429 failure.
 *
 * Two things measured the hard way, on a sweep that came back with four
 * roles "unable to log in" and every one of those a 429: an attempt that is
 * already rate-limited still counts, so retrying after the first 429 only digs
 * the hole deeper; and the budget left is readable without guessing, from the
 * RateLimit-Remaining header on any POST to /api/auth/login. One form login
 * costs exactly one attempt, so a full sweep costs six - which leaves room for
 * one sweep per window and nothing else worth spending it on.
 * ────────────────────────────────────────────────────────────────────────── */

function pathOf(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return String(u);
  }
}

/**
 * A protected route renders <RouteFallback/> until AuthProvider has read
 * localStorage and the lazy chunk has arrived, so measuring the body straight
 * after domcontentloaded reads "blank page" for a page that had simply not
 * mounted yet - the mistake behind several of the previous round's false
 * findings. This waits for real content and then gives up quietly, so a page
 * that genuinely renders nothing is still measured rather than skipped.
 */
async function settle(page, timeout = 10000) {
  await page.waitForLoadState('networkidle').catch(() => null);
  await page.waitForFunction(
    () => Boolean(document.body) && document.body.innerText.trim().length >= 40,
    null,
    { timeout },
  ).catch(() => null);
}

/**
 * Picks the role's home plus one route below it, considering only hrefs the
 * walk already observed settling on themselves. Several nav entries are
 * <Navigate> redirects (/school/status -> /school, /driver/leaves -> /driver),
 * and calling a correct redirect "deep link landed on the wrong page" would be
 * a harness bug, not an application defect.
 */
function pickRoutes(result) {
  const stable = (result.routes || []).filter((r) => {
    const seen = r.viewports && r.viewports.desktop && r.viewports.desktop.url;
    return seen && pathOf(seen) === r.href;
  });
  if (stable.length === 0) return null;
  const home = stable[0].href;
  const deeper = stable.find((r) => r.href !== home && r.href.startsWith(`${home}/`))
    || stable.find((r) => r.href !== home);
  return deeper ? { home, deep: deeper.href } : null;
}

/**
 * 1. Deep link - a fresh context that already holds the role's session opens
 *    the role's own inner route directly. It must land on that page, not
 *    bounce to /login and not render an empty shell.
 * 2. Browser back - after A -> B, goBack() must return to A with the session
 *    intact and no console error. The forward hop is taken by clicking the
 *    in-app link when one is on screen, so the history entry is the pushState
 *    one a real user creates, and falls back to a direct load when that link
 *    cannot be clicked - which is the driver's case, because /driver opens the
 *    pre-trip inspection dialog over the sidebar on arrival. A modal that
 *    blocks the page behind it is the modal working, not a defect in Back, so
 *    the fallback is recorded in `back.mode` rather than raised.
 */
async function deepLinkAndBackProbe(browser, roleResults) {
  const out = [];
  for (const r of roleResults) {
    if (!r.loggedIn || !r.storageState) continue;
    const picked = pickRoutes(r);
    if (!picked) {
      finding('info', r.role, 'deep-link', 'ไม่มีเส้นทางย่อยที่นิ่งพอจะใช้ทดสอบ deep link',
        `routes=${(r.routes || []).length}`);
      continue;
    }
    const { home, deep } = picked;
    const context = await browser.newContext({
      viewport: VIEWPORTS[2], locale: 'th-TH', storageState: r.storageState,
    });
    const page = await context.newPage();
    const noise = watch(page);
    const row = { role: r.role, home, deep };

    // ── deep link ──
    await page.goto(`${BASE}${deep}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await settle(page);
    let text = await bodyText(page);
    let drained = noise.drain();
    const landed = pathOf(page.url());
    row.deepLink = {
      url: page.url(), landed, textLength: text.length,
      consoleErrors: drained.consoleErrors.length,
      failedRequests: drained.failedRequests.length,
    };
    if (landed === '/login') {
      finding('high', r.role, deep, 'deep link ทั้งที่มี session อยู่ แต่ถูกเด้งไปหน้า login', `url=${page.url()}`);
    } else if (landed !== deep) {
      finding('high', r.role, deep, 'deep link ไม่ได้อยู่ที่เส้นทางที่ขอ', `ปลายทาง=${landed}`);
    } else if (text.length < 40) {
      finding('high', r.role, deep, 'deep link ได้หน้าเปล่าหรือเชลล์ว่าง', `textLength=${text.length}`);
    } else if (/ไม่มีสิทธิ์เข้าถึง/.test(text)) {
      finding('high', r.role, deep, 'deep link เข้าหน้าของบทบาทตัวเองแล้วถูกปฏิเสธ', `url=${page.url()}`);
    }
    if (drained.consoleErrors.length > 0) {
      finding('medium', r.role, `${deep} (deep link)`, 'console error', drained.consoleErrors.slice(0, 3).join(' | '));
    }
    if (drained.failedRequests.length > 0) {
      finding('high', r.role, `${deep} (deep link)`, 'request ของระบบเองล้มเหลวหรือ 5xx', drained.failedRequests.slice(0, 3).join(' | '));
    }

    // ── back ──
    await page.goto(`${BASE}${home}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await settle(page);
    noise.drain();

    let mode = 'link';
    const link = page.locator(`a[href="${deep}"]:visible`).first();
    const clicked = await link.click({ timeout: 4000 }).then(() => true).catch(() => false);
    if (clicked) {
      await page.waitForURL((u) => pathOf(u.toString()) === deep, { timeout: 8000 }).catch(() => null);
    }
    if (!clicked || pathOf(page.url()) !== deep) {
      mode = 'goto';
      await page.goto(`${BASE}${deep}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    }
    await settle(page);
    // The forward hop is already judged by the route walk; only what Back does
    // is this probe's business.
    noise.drain();

    await page.goBack().catch(() => null);
    await page.waitForURL((u) => pathOf(u.toString()) === home, { timeout: 8000 }).catch(() => null);
    await settle(page);
    text = await bodyText(page);
    drained = noise.drain();
    const backTo = pathOf(page.url());
    row.back = {
      mode, url: page.url(), backTo, textLength: text.length,
      consoleErrors: drained.consoleErrors.length,
    };
    if (backTo === '/login') {
      finding('high', r.role, `${deep} -> back`, 'กด back แล้วหลุด session ไปหน้า login', `url=${page.url()}`);
    } else if (backTo !== home) {
      finding('high', r.role, `${deep} -> back`, 'กด back แล้วไม่ได้กลับไปหน้าก่อนหน้า', `ควรเป็น ${home} แต่ได้ ${backTo}`);
    } else if (text.length < 40) {
      finding('high', r.role, `${deep} -> back`, 'กด back แล้วได้หน้าเปล่า', `textLength=${text.length}`);
    }
    if (drained.consoleErrors.length > 0) {
      finding('medium', r.role, `${deep} -> back`, 'console error ตอนกด back', drained.consoleErrors.slice(0, 3).join(' | '));
    }

    out.push(row);
    await context.close();
  }
  return out;
}

/**
 * A real write, through the UI, by the role that owns it.
 *
 * /admin/pickup-points was chosen out of the writes this sandbox actually
 * offers because it is the only one that is both verifiable and undoable from
 * the same screen: create is POST /api/admin/pickup-points, the row is listed
 * back, and the row's own delete is a soft delete
 * (backend/src/routes/admin.routes.js:483) that hides it again. Nothing else
 * on the write list undoes itself - an inspection result, an emergency report
 * and a check-in are all append-only, and a teacher account is a credential.
 * The geofence editor would have been the cleaner subject, but /api/geofences
 * is behind FEATURE_GEOFENCE and is not mounted on this stack.
 *
 * The vehicle is picked from one that already has points, so that "the row is
 * gone after deleting it" cannot be confused with "the filter returned an
 * empty list".
 */
async function formSubmitProbe(browser, roleResults) {
  const admin = roleResults.find((r) => r.role === 'admin');
  const route = '/admin/pickup-points';
  if (!admin || !admin.loggedIn || !admin.storageState) {
    finding('info', 'admin', route, 'ข้ามการทดสอบ form submit เพราะไม่มี session ของ admin', '');
    return null;
  }
  const label = `E2E ทดสอบอัตโนมัติ ${stamp()}`;
  const result = { role: 'admin', route, label, created: false, visibleAfterReload: null, undone: null };

  const context = await browser.newContext({
    viewport: VIEWPORTS[2], locale: 'th-TH', storageState: admin.storageState,
  });
  const page = await context.newPage();
  const noise = watch(page);

  const openList = async () => {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await settle(page);
  };
  // Re-applies the vehicle filter after a reload (it is component state, not a
  // query parameter) and reports whether our row is on screen.
  const rowVisible = async (vehicleId) => {
    await page.getByLabel('รถ', { exact: true }).selectOption(vehicleId).catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => null);
    const visible = await page.locator(`button[aria-label="ลบจุด ${label}"]:visible`).first()
      .waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
    const rows = await page.locator('table tbody tr').count().catch(() => 0);
    return { visible, rows };
  };

  try {
    await openList();
    noise.drain();

    const options = await page.getByLabel('รถ', { exact: true })
      .evaluate((el) => Array.from(el.options).map((o) => [o.value, (o.textContent || '').trim()]))
      .catch(() => []);
    const firstRowText = await page.locator('table tbody tr').first().innerText().catch(() => '');
    const withPoints = options.find(([v, l]) => v && l && firstRowText.includes(l));
    const vehicle = withPoints || options.find(([v]) => v);
    if (!vehicle) {
      finding('info', 'admin', route, 'ข้ามการทดสอบ form submit เพราะไม่มีรถให้เลือกใน sandbox', '');
      return result;
    }
    result.vehicleId = vehicle[0];
    result.vehiclePlate = vehicle[1];
    result.vehicleAlreadyHadPoints = Boolean(withPoints);

    // ── submit ──
    await page.getByRole('button', { name: 'เพิ่มกรณีพิเศษ' }).click({ timeout: 8000 });
    const dialog = page.locator('div[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 8000 });
    await page.getByLabel('ทะเบียนรถ').selectOption(vehicle[0]);
    await page.getByLabel('ป้ายชื่อจุด').fill(label);
    await page.getByLabel('Latitude').fill('18.287300');
    await page.getByLabel('Longitude').fill('99.492700');
    await page.locator('button[form="admin-pickup-form"]').click();
    const closed = await dialog.waitFor({ state: 'detached', timeout: 15000 })
      .then(() => true).catch(() => false);
    result.created = closed;
    if (!closed) {
      const why = await dialog.innerText().catch(() => '');
      finding('high', 'admin', route, 'ส่งฟอร์มสร้างจุดรับส่งแล้ว dialog ไม่ปิด (บันทึกไม่สำเร็จ)',
        why.replace(/\s+/g, ' ').slice(0, 240));
      return result;
    }
    let drained = noise.drain();
    if (drained.consoleErrors.length > 0) {
      finding('medium', 'admin', route, 'console error ตอนส่งฟอร์ม', drained.consoleErrors.slice(0, 3).join(' | '));
    }
    if (drained.failedRequests.length > 0) {
      finding('high', 'admin', route, 'request ของระบบเองล้มเหลวหรือ 5xx ตอนส่งฟอร์ม', drained.failedRequests.slice(0, 3).join(' | '));
    }

    // ── the write has to survive a reload, not just a re-render ──
    await openList();
    const after = await rowVisible(vehicle[0]);
    result.visibleAfterReload = after.visible;
    result.rowsAfterCreate = after.rows;
    if (!after.visible) {
      finding('high', 'admin', route, 'บันทึกแล้วแต่ไม่พบรายการหลังโหลดหน้าใหม่',
        `label=${label} รถ=${vehicle[1]} rowsInFilteredList=${after.rows}`);
    }

    // ── undo ──
    const del = page.locator(`button[aria-label="ลบจุด ${label}"]:visible`).first();
    if ((await del.count()) > 0) {
      await del.click({ timeout: 8000 }).catch(() => null);
      await page.locator('div[role="alertdialog"] button', { hasText: 'ลบจุดรับส่ง' }).first()
        .click({ timeout: 8000 }).catch(() => null);
      await page.waitForLoadState('networkidle').catch(() => null);
      await openList();
      const gone = await rowVisible(vehicle[0]);
      result.undone = !gone.visible;
      result.rowsAfterDelete = gone.rows;
      if (gone.visible) {
        finding('medium', 'admin', route, 'ลบรายการทดสอบไม่สำเร็จ เหลือข้อมูลค้างใน sandbox', `label=${label}`);
      }
    } else {
      result.undone = false;
      finding('medium', 'admin', route, 'หาปุ่มลบของรายการทดสอบไม่เจอ อาจเหลือข้อมูลค้างใน sandbox', `label=${label}`);
    }
    drained = noise.drain();
    if (drained.consoleErrors.length > 0) {
      finding('medium', 'admin', route, 'console error ตอนลบรายการทดสอบ', drained.consoleErrors.slice(0, 3).join(' | '));
    }
  } catch (err) {
    finding('high', 'admin', route, 'การทดสอบ form submit ล้มกลางคัน',
      String(err && err.message ? err.message : err).replace(/\s+/g, ' ').slice(0, 240));
  } finally {
    await context.close();
  }
  return result;
}

/**
 * The same protected URLs with no session at all. A miss here is not a menu
 * that shows too much - it is the page shell rendering for someone who never
 * authenticated, so the bar is a redirect to /login with the login form on it.
 */
async function unauthDeepLinkProbe(browser, roleResults) {
  const targets = [];
  const seen = new Set();
  for (const r of roleResults) {
    const picked = pickRoutes(r);
    if (!picked) continue;
    for (const href of [picked.home, picked.deep]) {
      if (seen.has(href)) continue;
      seen.add(href);
      targets.push({ role: r.role, href });
    }
  }

  const context = await browser.newContext({ viewport: VIEWPORTS[2], locale: 'th-TH' });
  const out = [];
  for (const t of targets) {
    // A page per target, so one target's history or tab-scoped state cannot
    // colour the next one.
    const page = await context.newPage();
    const noise = watch(page);
    await page.goto(`${BASE}${t.href}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForURL((u) => pathOf(u.toString()) === '/login', { timeout: 10000 }).catch(() => null);
    await settle(page);
    const landed = pathOf(page.url());
    const text = await bodyText(page);
    const hasLoginForm = (await page.locator('#login-username').count()) > 0;
    const hadToken = await page.evaluate(() => {
      try { return Boolean(localStorage.getItem('access_token')); } catch { return false; }
    }).catch(() => false);
    const drained = noise.drain();
    out.push({ ...t, landed, textLength: text.length, hasLoginForm, hadToken });

    if (hadToken) {
      // Would mean the "no session" context was not one - a harness fault, and
      // it has to be visible rather than silently making the check pass.
      finding('high', 'anon', t.href, 'context ที่ควรไม่มี session กลับมี token ผลการตรวจนี้เชื่อไม่ได้', '');
    } else if (landed !== '/login') {
      finding('critical', 'anon', t.href, 'เข้าเส้นทางที่ต้อง login ได้โดยไม่มี session และไม่ถูก redirect',
        `ปลายทาง=${landed} textLength=${text.length}`);
    } else if (!hasLoginForm) {
      finding('medium', 'anon', t.href, 'redirect ไป /login แล้วแต่ไม่พบฟอร์มเข้าสู่ระบบ', `textLength=${text.length}`);
    }
    if (drained.consoleErrors.length > 0) {
      finding('low', 'anon', t.href, 'console error ตอน redirect ไป login', drained.consoleErrors.slice(0, 2).join(' | '));
    }
    await page.close();
  }
  await context.close();
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  process.stdout.write(`[e2e] base=${BASE} out=${OUT}\n`);

  const roleResults = [];
  for (const r of ROLES) {
    process.stdout.write(`[e2e] role=${r.role} (${r.username})\n`);
    roleResults.push(await reviewRole(browser, r));
  }
  const crossRole = await crossRoleProbe(browser, roleResults);
  // Order matters only in that all of these reuse the sessions reviewRole
  // saved; none of them logs in, so a full sweep stays at 6 login attempts.
  const sessionRoutes = await deepLinkAndBackProbe(browser, roleResults);
  const formSubmit = await formSubmitProbe(browser, roleResults);
  const unauthDeepLink = await unauthDeepLinkProbe(browser, roleResults);
  await browser.close();

  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});

  for (const r of roleResults) delete r.storageState;  // tokens must not reach the report
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    scope: 'sandbox stack (synthetic data) — ไม่ใช่ production และไม่ใช่ UAT evidence',
    not_covered: [
      'task completion / time-on-task / error rate / help request ของผู้ใช้จริง (Phase 8)',
      'ลายเซ็นผู้แทนบทบาท',
      'contrast ratio และ target size แบบวัดค่าจริง',
      'LINE parent flow (ต้องมี LINE test channel)',
    ],
    roles: roleResults,
    cross_role: crossRole,
    session_routes: sessionRoutes,
    form_submit: formSubmit,
    unauth_deep_link: unauthDeepLink,
    findings,
    counts,
  };

  writeFileSync(path.join(OUT, 'e2e-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(OUT, 'summary.md'), markdown(report));
  process.stdout.write(`[e2e] output: ${OUT}\n`);
  const defects = findings.filter((f) => f.severity !== 'info').length;
  process.stdout.write(`[e2e] session-route probes=${sessionRoutes.length} unauth probes=${unauthDeepLink.length} `
    + `form-submit=${formSubmit ? `created=${formSubmit.created} visibleAfterReload=${formSubmit.visibleAfterReload} undone=${formSubmit.undone}` : 'skipped'}\n`);
  process.stdout.write(`[e2e] summary roles=${roleResults.length} defects=${defects} info=${counts.info || 0} `
    + `critical=${counts.critical || 0} high=${counts.high || 0} medium=${counts.medium || 0} low=${counts.low || 0}\n`);

  if ((counts.critical || 0) > 0) process.exitCode = 1;
}

function markdown(report) {
  const rows = report.findings.length > 0
    ? report.findings.map((f) => `| ${f.severity} | ${f.role} | ${f.where} | ${String(f.what).replace(/\|/g, '\\|')} | ${String(f.detail).replace(/\|/g, '\\|').slice(0, 160)} |`).join('\n')
    : '| — | — | — | ไม่พบปัญหาในขอบเขตที่ตรวจ | — |';
  const sessionRows = (report.session_routes || []).length > 0
    ? report.session_routes.map((s) => `| ${s.role} | \`${s.deep}\` | ${s.deepLink.landed === s.deep ? 'ถึงหน้าที่ขอ' : `ไปที่ ${s.deepLink.landed}`} | \`${s.back.backTo}\` | ${s.back.backTo === s.home ? `กลับถูก (${s.back.mode})` : 'ไม่กลับที่เดิม'} |`).join('\n')
    : '| — | — | — | — | ไม่ได้ตรวจ |';
  const f = report.form_submit;
  const formRow = f
    ? `- บทบาท: \`admin\` · หน้า: \`${f.route}\` · รถ: ${f.vehiclePlate || '—'}\n`
      + `- สร้างผ่านฟอร์ม: ${f.created ? 'สำเร็จ' : 'ไม่สำเร็จ'}\n`
      + `- เห็นข้อมูลหลังโหลดหน้าใหม่: ${f.visibleAfterReload === null ? 'ไม่ได้ตรวจ' : f.visibleAfterReload ? 'เห็น' : 'ไม่เห็น'}\n`
      + `- ย้อนกลับ (soft delete ผ่าน UI): ${f.undone === null ? 'ไม่ได้ตรวจ' : f.undone ? 'ย้อนแล้ว ไม่มีข้อมูลค้าง' : `ย้อนไม่สำเร็จ ข้อมูลค้างชื่อ "${f.label}"`}\n`
    : '- ไม่ได้ตรวจ (ไม่มี session ของ admin)\n';
  const unauthRows = (report.unauth_deep_link || []).length > 0
    ? report.unauth_deep_link.map((u) => `| \`${u.href}\` | \`${u.landed}\` | ${u.hasLoginForm ? 'มี' : 'ไม่มี'} | ${u.landed === '/login' && u.hasLoginForm ? 'redirect ถูกต้อง' : 'ไม่เป็นไปตามที่ควร'} |`).join('\n')
    : '| — | — | — | ไม่ได้ตรวจ |';
  const roleRows = report.roles.map((r) => `| ${r.role} | ${r.username} | ${r.loggedIn ? 'ผ่าน' : 'ไม่ผ่าน'} | ${r.linkCount ?? 0} | ${r.keyboard ? `${r.keyboard.stops} stops / ${r.keyboard.withVisibleFocus} มี focus` : '—'} |`).join('\n');

  return `# E2E UI Review (sandbox)

- Generated: ${report.generated_at}
- Base URL: \`${report.base_url}\`
- ขอบเขต: ${report.scope}

## สรุป

| ระดับ | จำนวน |
|---|---:|
| critical | ${report.counts.critical || 0} |
| high | ${report.counts.high || 0} |
| medium | ${report.counts.medium || 0} |
| low | ${report.counts.low || 0} |
| info (ไม่นับเป็น defect) | ${report.counts.info || 0} |

## ต่อบทบาท

| บทบาท | บัญชี | Login | ลิงก์ที่เดินได้ | Keyboard |
|---|---|---|---:|---|
${roleRows}

## Deep link + ปุ่ม Back (ต่อบทบาท)

| บทบาท | เส้นทางที่เปิดตรง | ผล deep link | Back กลับไป | ผล Back |
|---|---|---|---|---|
${sessionRows}

## Form submit จริง (เขียนแล้วย้อนกลับ)

${formRow}

## เปิดเส้นทางที่ต้อง login โดยไม่มี session

| เส้นทาง | ปลายทาง | มีฟอร์ม login | ผล |
|---|---|---|---|
${unauthRows}

## Findings

| ระดับ | บทบาท | ที่ | อาการ | รายละเอียด |
|---|---|---|---|---|
${rows}

## สิ่งที่รายงานนี้ไม่ครอบคลุม

${report.not_covered.map((x) => `- ${x}`).join('\n')}

รายงานนี้เป็นการตรวจด้วยสคริปต์บน sandbox ที่มีข้อมูล synthetic **ไม่ใช่ UAT evidence และไม่แทนการทดสอบโดยผู้แทนบทบาทจริง**
`;
}

main().catch((err) => {
  process.stderr.write(`[e2e] failed: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
