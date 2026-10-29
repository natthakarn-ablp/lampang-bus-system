#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distRoot = path.join(root, 'frontend', 'dist');
const indexPath = path.join(distRoot, 'index.html');
const requireFrontend = createRequire(path.join(root, 'frontend', 'package.json'));
const REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.line-scdn.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "connect-src 'self' https://api.line.me https://liff.line.me https://*.tile.openstreetmap.org",
  'report-uri /__csp-report',
].join('; ');
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pN8AAAAASUVORK5CYII=',
  'base64'
);
const reportViolations = [];
const interceptedOrigins = new Set();

function normalizedOrigin(value) {
  if (!value || ['inline', 'eval', 'self', 'data', 'wasm-eval'].includes(value)) return value || 'unknown';
  try {
    const parsed = new URL(value, 'http://127.0.0.1');
    return parsed.protocol === 'data:' || parsed.protocol === 'blob:'
      ? `${parsed.protocol}`
      : parsed.origin;
  } catch {
    return 'unparseable';
  }
}

function recordReportBody(raw) {
  let report;
  try { report = JSON.parse(raw); } catch { return; }
  const entries = Array.isArray(report) ? report : [report];
  for (const entry of entries) {
    const body = entry?.['csp-report'] || entry?.body || entry;
    const directive = body?.['effective-directive'] || body?.effectiveDirective || body?.['violated-directive'];
    const blocked = body?.['blocked-uri'] || body?.blockedURL || body?.blockedUrl;
    if (directive) reportViolations.push({ directive: String(directive).split(' ')[0], blockedOrigin: normalizedOrigin(blocked) });
  }
}

function serveFile(res, filePath, { html = false } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeTypes.get(extension) || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (html) res.setHeader('Content-Security-Policy-Report-Only', REPORT_ONLY_POLICY);
  fs.createReadStream(filePath).pipe(res);
}

if (!fs.existsSync(indexPath)) {
  console.error('CSP probe needs frontend/dist/index.html. Run `npm run build` in frontend first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/__csp-report' && req.method === 'POST') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      recordReportBody(raw);
      res.writeHead(204).end();
    });
    return;
  }
  if (requestUrl.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, message: 'Synthetic mock', data: [] }));
    return;
  }

  let decodedPath;
  try { decodedPath = decodeURIComponent(requestUrl.pathname); }
  catch { res.writeHead(400).end(); return; }
  const candidate = path.resolve(distRoot, `.${decodedPath}`);
  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${path.sep}`)) {
    res.writeHead(400).end();
    return;
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(res, candidate, { html: path.extname(candidate).toLowerCase() === '.html' });
    return;
  }
  serveFile(res, indexPath, { html: true });
});

let browser;
try {
  const { chromium } = requireFrontend('playwright');
  browser = await chromium.launch({ headless: true, channel: process.env.CSP_PROBE_BROWSER || 'chrome' });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const paths = (process.env.CSP_PROBE_PATHS || '/login,/driver/pickup-map,/school/pickup-map,/affiliation/pickup-map,/province/pickup-map,/transport/pickup-map,/parent/link,/parent,/qr/synthetic-token')
    .split(',').map((value) => value.trim()).filter(Boolean).map((value) => value.startsWith('/') ? value : `/${value}`);
  const page = await browser.newPage();
  const browserViolations = [];
  await page.addInitScript(() => {
    const role = location.pathname.startsWith('/school/') ? 'school'
      : location.pathname.startsWith('/affiliation/') ? 'affiliation'
      : location.pathname.startsWith('/province/') ? 'province'
      : location.pathname.startsWith('/transport/') ? 'transport'
      : 'driver';
    const user = {
      id: 1,
      username: 'csp-probe',
      role,
      scopeType: role,
      scopeId: 1,
      must_change_password: false,
    };
    localStorage.setItem('access_token', 'synthetic-csp-probe-token');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('features', JSON.stringify({ vehicleQr: true }));
    window.__cspProbeViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => {
      if (event.disposition !== 'report') return;
      let blockedOrigin = event.blockedURI || 'unknown';
      if (!['inline', 'eval', 'self', 'data', 'blob', 'wasm-eval'].includes(blockedOrigin)) {
        try {
          const parsed = new URL(blockedOrigin, window.location.href);
          blockedOrigin = ['data:', 'blob:'].includes(parsed.protocol) ? parsed.protocol : parsed.origin;
        } catch { blockedOrigin = 'unparseable'; }
      }
      window.__cspProbeViolations.push({ directive: event.effectiveDirective, blockedOrigin });
    });
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl) return route.continue();
    interceptedOrigins.add(url.origin);
    if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
    if (route.request().resourceType() === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, body: '' });
  });

  for (const routePath of paths) {
    const role = routePath.startsWith('/school/') ? 'school'
      : routePath.startsWith('/affiliation/') ? 'affiliation'
      : routePath.startsWith('/province/') ? 'province'
      : routePath.startsWith('/transport/') ? 'transport'
      : 'driver';
    await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    browserViolations.push(...await page.evaluate(() => window.__cspProbeViolations || []));
  }
  const violations = [...reportViolations, ...browserViolations]
    .map(({ directive, blockedOrigin }) => ({ directive: String(directive).split(' ')[0], blockedOrigin: normalizedOrigin(blockedOrigin) }));
  const uniqueViolations = [...new Map(violations.map((item) => [`${item.directive}|${item.blockedOrigin}`, item])).values()]
    .sort((a, b) => `${a.directive}|${a.blockedOrigin}`.localeCompare(`${b.directive}|${b.blockedOrigin}`));

  console.log(JSON.stringify({
    build: 'frontend/dist',
    paths,
    apiMode: 'synthetic local responses and a fake browser session; no credentials or production API calls',
    externalRequestMode: 'intercepted by Playwright; no external requests sent',
    interceptedOrigins: [...interceptedOrigins].sort(),
    reportOnlyViolations: uniqueViolations,
    note: uniqueViolations.length ? 'Review each directive and origin in staging before changing the candidate policy.' : 'No report-only violations were observed on the synthetic paths visited; real LIFF redirects and any flow not exercised still require staging checks.',
  }, null, 2));
} catch (error) {
  const missingBrowser = /executable|browser.*not found|playwright/i.test(String(error?.message || error));
  console.error(missingBrowser
    ? 'CSP browser probe could not run: install Playwright and a local Chrome/Chromium browser. No CSP pass is claimed.'
    : `CSP browser probe failed: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
