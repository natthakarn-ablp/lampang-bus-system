# UI Baseline — Phase 2 Closeout

Frozen visual baseline of the Lampang Bus System frontend at the end of
Phase 2 redesign. Used as the reference snapshot for visual-regression
comparison in future phases.

## Capture metadata

| | |
|---|---|
| Captured at HEAD | `c4541b3` |
| Capture method | `scripts/browser-review.mjs` (Playwright + chromium-headless-shell) |
| Auth | mock JWT injected via `localStorage` (see script header) |
| API | stubbed via `page.route('**/api/**', …)` returning `{ success: true, data: {} }` |
| Screenshot mode | viewport-only (not full-page; see script comment) |
| Total images | 31 |
| Total size | ~3.1 MB (Phase 6 map captures push the total — OSM tile imagery is dense) |

## Viewports

| Viewport | Dimensions |
|---|---|
| `mobile` | 375 × 812 (iPhone X) |
| `tablet` | 768 × 1024 (iPad portrait) |
| `desktop` | 1280 × 800 |

## What's captured

| File | Page | Notes |
|---|---|---|
| `01-login-{desktop,mobile}.png` | `/login` | unauth, brand mark + form |
| `02-province-{desktop,tablet,mobile}.png` | `/province` | KPI grid + risk schools + executive summary |
| `03-school-{desktop,mobile}.png` | `/school` | completeness card + session cards + vehicle list |
| `04-driver-mobile-home.png` | `/driver` | bottom nav + session info bar (mobile only) |
| `04-driver-mobile-requests.png` | `/driver/requests` | navigated by direct URL (pretrip modal would intercept clicks) |
| `04-driver-mobile-emergency.png` | `/driver/emergency` | |
| `04-driver-mobile-profile.png` | `/driver/profile` | |
| `05-driver-desktop.png` | `/driver` | sidebar (no bottom nav on desktop) |
| `06-admin-default.png` | `/admin` | KPIGrid + AppCard action shortcuts |
| `06-admin-province-section-toggled.png` | `/admin` | sidebar "ข้อมูลจังหวัด" section expanded |
| `06-admin-profile-dropdown.png` | `/admin` | topbar profile dropdown open |
| `07-province-mobile-drawer-{open,closed}.png` | `/province` | mobile sidebar drawer interaction |
| `08-reports-monthly-{desktop,mobile}.png` | `/reports/monthly` | LeaderboardRow cards in monthly rankings |
| `09-reports-summary-{desktop,mobile}.png` | `/reports/summary` | LeaderboardRow cards in summary rankings |
| `10-admin-audit-{desktop,mobile}.png` | `/admin/audit-logs` | AuditEntry cards + filter bar + pagination |
| `11-affiliation-{desktop,tablet,mobile}.png` | `/affiliation` | Phase 4 attention panel (schools jumpable, incidents/vehicles non-jumpable) + KPIGrid + session donuts |
| `12-driver-pickup-map-{desktop,mobile}.png` | `/driver/pickup-map` | Phase 6 driver map: full-screen Leaflet + OSM, 3 markers, session pills, bottom-nav preserved |
| `13-school-pickup-map-{desktop,mobile}.png` | `/school/pickup-map` | Phase 6 school summary: list panel + map (side-by-side desktop, stacked mobile), 4 points across 2 vehicles |
| `14-admin-pickup-points-desktop.png` | `/admin/pickup-points` | Phase 6 admin CRUD: paginated table + filter dropdown + per-row Users/Edit/Delete actions |

## How to re-capture

```bash
# 1. Setup (once per machine — needs sudo)
sudo apt-get install -y libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libxkbcommon0 libxrandr2 libgbm1 libxss1 libasound2t64 libnss3
cd frontend
npm install --no-save playwright
npx playwright install chromium

# 2. Run dev server (one terminal)
npx vite --port 5173

# 3. Capture (another terminal)
npm run qa:browser

# 4. Compare against baseline
ls /tmp/lampang-shots/      # fresh capture
ls docs/ui-baseline/         # this baseline
# Diff via image-diff tool of choice (pixelmatch, ImageMagick compare, etc.)
```

## When to update this baseline

After landing any of these — refresh the affected screenshots and update
this README's `Captured at HEAD` line:

- A redesign that intentionally changes visual hierarchy on a captured page
- A primitive change (`AppCard` / `KPIStat` / `AlertBanner` / `RiskCard`) that
  alters every dashboard
- A design-token change (color palette, shadow scale, typography weight)
- A layout-shell change (`Layout`, `TopNavbar`, `Sidebar`, `MobileBottomNav`)

Don't refresh on incidental data-only changes — the API stub returns empty
data, so dashboard data shouldn't differ between captures.
