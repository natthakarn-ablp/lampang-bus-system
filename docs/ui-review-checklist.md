# UI Review Checklist

Reusable governance artifact for any UI redesign work on the Lampang Bus
System frontend. Run through this before merging a redesign PR or claiming
a phase done.

The rules below were captured across Phase 2 redesign QA rounds 1–4. Items
marked **(why)** include the failure mode that surfaced the rule.

---

## 1. Layout chrome

- [ ] **Topbar** is `sticky top-0`, h-14, has `backdrop-blur` over a translucent surface (`bg-surface-raised/85`)
- [ ] **Topbar** has hamburger icon on mobile only (`md:hidden`), profile dropdown on the right at every breakpoint
- [ ] **Sidebar** desktop-only (`hidden md:flex`), mobile drawer slides in from the left on hamburger tap
- [ ] **Sidebar collapsible groups** work: chevron rotates 180° on toggle, state persists in `localStorage` across navigation, active group force-expands when route changes
- [ ] **Mobile drawer** has a backdrop (`bg-black/50`), close button (`X` icon), closes on route change
- [ ] **Bottom nav** (driver only): `md:hidden`, 4 tabs (home/requests/emergency/profile), active tab uses `text-brand-700`, inactive `text-ink-muted`

## 2. Safe area & mobile chrome

- [ ] App shell root has `paddingTop: env(safe-area-inset-top)` for iPhone notch in PWA mode
- [ ] Bottom nav has `pb-[env(safe-area-inset-bottom)]` for iPhone home bar
- [ ] No fixed/sticky element relies on hardcoded pixel values for safe-area distance

## 3. Toast vs bottom nav (CSS variable wiring)

- [ ] `MobileBottomNav` sets `--app-bottom-nav` on `document.body` via `useEffect` when on mobile, removes on unmount
- [ ] `Toast` container uses `bottom: calc(1rem + var(--app-bottom-nav, 0px))` so it lifts above the nav on driver mobile but stays at `1rem` everywhere else
- [ ] Verified by capturing `04-driver-mobile-home.png` and reading toast `bottom` computed style: should be `76px` (1rem + 60px) on mobile with bottom nav, `16px` otherwise
- [ ] **(why)** Originally toast `fixed bottom-4 z-50` covered the bottom nav's rightmost tab on driver mobile

## 4. Semantic colors — not-started ≠ danger

- [ ] When dashboard data hasn't started for the day (e.g. `morning_total + evening_total === 0`), banner reads "ยังไม่เริ่มดำเนินการวันนี้" with **info** variant (blue), not success "ระบบปกติ" or danger
- [ ] KPI showing 0% / 0 pending while base is 0 must be **neutral** variant, not success or danger — the semantic state is "no data yet," not "perfect" or "broken"
- [ ] Per-session cards (morning/evening) show "ยังไม่เริ่ม" in `text-ink-muted` when `total === 0`, with no progress bar rendered
- [ ] Transport with `total_vehicles === 0` shows info "ยังไม่มีรถในระบบ" + neutral KPIs, never green "perfect inspection"
- [ ] **(why)** Original `kpiColor()` returned `text-red-600` for any value below 85, including null/NaN/0-from-zero-denom — executives saw red on cold-start and assumed system failure

## 5. Empty states

- [ ] Use `<EmptyState>` from `components/EmptyState.jsx` — never inline `<p>ไม่มีข้อมูล</p>`
- [ ] Empty state has icon (lucide), title, description; description adapts to whether a search/filter is active
- [ ] Use `variant="success"` when "empty" is good news (no emergencies, no pending issues), `variant="default"` otherwise
- [ ] Don't conflate "loading failed → no data" (use a !data branch with simpler text) with "list is empty" (use `<EmptyState>`)

## 6. Typography weight hierarchy

- [ ] `font-bold` (700) reserved for **key metrics only** — KPI value, hero number
- [ ] Section titles, primary CTAs, page headers use `font-semibold` (600)
- [ ] Labels, badge text, secondary headers use `font-medium` (500)
- [ ] Body text, descriptions use `font-normal` (400)
- [ ] `font-extrabold` not used — never needed
- [ ] **(why)** Audit found `font-bold` overused on KPI %, header, label simultaneously — visual hierarchy collapses when everything is bold

## 7. Color & primitive discipline

- [ ] No emoji glyphs in production UI — replace with `lucide-react` icons
- [ ] No hardcoded color literals in pages: forbid `bg-red-500`, `bg-blue-100`, `text-amber-700`, etc. → use design tokens (`bg-brand-*`, `text-success`, `bg-warn-soft`, etc.)
- [ ] No ad-hoc card surfaces: `bg-white rounded-xl border border-gray-200 p-4` → use `<AppCard>`
- [ ] No per-page status pills with custom color maps → use `<StatusBadge>` with semantic variant
- [ ] No `AppCard2` / `KPIStatNew` / `BetterRiskCard` — extend existing primitives via props/variants
- [ ] Variants (`success` / `warn` / `danger` / `info` / `neutral` / `brand`) carry **fixed semantic meaning** — never used purely for color appeal (no "warn for morning, info for evening" because the colors look right)

## 8. Defensive data handling

- [ ] All `data.field` interpolations in KPI hints use `?? 0` or `?? '–'` fallback — `${data.total_schools ?? 0} ร.ร.` not `${data.total_schools} ร.ร.`
- [ ] Array state setters guard with `Array.isArray(x) ? x : []` so `.filter()` / `.map()` can't crash on a partial response
- [ ] Optional chaining through nested API response shapes (`r?.data?.data?.field`)
- [ ] Division-by-zero guards on average / percentage computations

## 9. Per-dashboard sanity

- [ ] Province / School / Affiliation / Transport / Driver / Admin — all use `KPIGrid` + `KPIStat` (not legacy `KpiBox` / `StatCard` / `DashboardCard`)
- [ ] Status banner is `AlertBanner` with severity-driven variant (info / success / warn / danger), not a custom red/green box
- [ ] Section structure uses `DashboardSection` + `SectionTitle` for consistent rhythm
- [ ] Risk lists use `RiskCard` (or its accent-rail pattern) with auto level mapping (high / medium / low)

## 10. Build sanity

- [ ] `npm run build` from `frontend/` succeeds with no errors
- [ ] No chunk over `chunkSizeWarningLimit` (350 KB after Phase 2.3 bundle splitting)
- [ ] Initial-paint chunks (`index` + `react-vendor` + `lucide`) total < 280 KB raw
- [ ] Per-role dashboard chunks 5–25 KB

## 11. Browser sanity (`npm run qa:browser`)

- [ ] Script produces 17 expected screenshots in `/tmp/lampang-shots/`:
  - `01-login-{desktop,mobile}.png`
  - `02-province-{desktop,tablet,mobile}.png`
  - `03-school-{desktop,mobile}.png`
  - `04-driver-mobile-{home,requests,emergency,profile}.png`
  - `05-driver-desktop.png`
  - `06-admin-{default,province-section-toggled,profile-dropdown}.png`
  - `07-province-mobile-drawer-{open,closed}.png`
- [ ] Console output shows toast computed `bottom: 76px` and bottom-nav rect `top + height = viewportH` on driver mobile
- [ ] No `pageerror` lines in script output (no React crashes during navigation)
- [ ] No `console.error` lines that aren't expected dev warnings

## 12. Atomic commits

- [ ] One feature per commit. `feat(ui): KPI card system` is one commit; mixing it with bundle splitting is two commits
- [ ] Conventional Commit prefix matches repo style: `feat(ui):`, `fix(ui):`, `refactor(ui):`, `chore(qa):`, `docs(ui):`
- [ ] Never `git add -A` / `git add .` — list paths explicitly
- [ ] Never push without QA round green

---

## How to use this checklist

- During PR review for any redesign work
- Before claiming "phase complete" / "redesign done"
- During onboarding — gives a new contributor the rules without reading 30 commit messages
- When a primitive (`KPIStat`, `AlertBanner`, `RiskCard`, etc.) needs extending — re-read sections 7 and 6 first

If a check fails, fix at root rather than at point-of-use. Page-level
patches drift quickly; primitive-level fixes ship the rule.

## Source rules

These checks consolidate guidance captured in the project memory:

- `feedback_atomic_commits.md` → Section 12
- `feedback_enterprise_frontend_bar.md` → Sections 2, 3, 11
- `feedback_design_system_guardrails.md` → Section 7
- `feedback_semantic_color_states.md` → Section 4
- `feedback_typography_weight_hierarchy.md` → Section 6

Memory is agent-only; this file makes the same rules discoverable to humans.
