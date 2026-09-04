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
    findings,
    counts,
  };

  writeFileSync(path.join(OUT, 'e2e-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(OUT, 'summary.md'), markdown(report));
  process.stdout.write(`[e2e] output: ${OUT}\n`);
  const defects = findings.filter((f) => f.severity !== 'info').length;
  process.stdout.write(`[e2e] summary roles=${roleResults.length} defects=${defects} info=${counts.info || 0} `
    + `critical=${counts.critical || 0} high=${counts.high || 0} medium=${counts.medium || 0} low=${counts.low || 0}\n`);

  if ((counts.critical || 0) > 0) process.exitCode = 1;
}

function markdown(report) {
  const rows = report.findings.length > 0
    ? report.findings.map((f) => `| ${f.severity} | ${f.role} | ${f.where} | ${String(f.what).replace(/\|/g, '\\|')} | ${String(f.detail).replace(/\|/g, '\\|').slice(0, 160)} |`).join('\n')
    : '| — | — | — | ไม่พบปัญหาในขอบเขตที่ตรวจ | — |';
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
