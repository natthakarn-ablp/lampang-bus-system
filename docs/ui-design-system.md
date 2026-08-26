# UI Design System — Modern Civic + Safety First

**Branch:** `codex/full-ui-redesign` · **Base:** `d9485ec` (production)

This describes the tokens and shared components the redesign builds on. It is
additive: every token that existed before still exists and still means the same
thing, so nothing that already consumed them shifted.

---

## 1. Colour

### Structure vs action

The single most important rule here: **navy is structure, brand blue is action.**

| role | token | value |
|---|---|---|
| Structure — shell, sidebar, rail, brand surfaces | `navy-700` | `#123B6D` |
| Action — buttons, links, selected state | `brand-600` | `#2563EB` |
| Page background | `surface` | `#F8FAFC` |
| Raised surface | `surface-raised` | `#FFFFFF` |
| Border | `surface-border` | `#E2E8F0` |
| Text | `ink` | `#0F172A` |
| Secondary text | `ink-muted` | `#64748B` |

One token cannot do both jobs. If the sidebar and the primary button are the
same blue, the interface loses the distinction between *where am I* and *what
can I press*.

`navy` runs 50–950; `brand` runs 50–900. Both were kept as full scales so tints
(`navy-50` chips, `brand-50` icon wells) come from the palette rather than
opacity guesses.

### Semantic colour

| token | means | never used for |
|---|---|---|
| `success` `#10B981` (+ `success-soft`) | done, ready, healthy | branding |
| `warn` `#F59E0B` (+ `warn-soft`) | worth following up | normal pending work |
| `danger` `#EF4444` (+ `danger-soft`) | error, hazard, destructive | "not finished yet" |
| `info` `#0EA5E9` (+ `info-soft`) | neutral notice | success |

**Colour is never the only signal.** Every state carries an icon or a word as
well. `DailyOperationStatus` is the reference implementation: each tile renders
a percentage, a coloured bar, an icon and a Thai word
(`ยังไม่เริ่มรอบ` / `กำลังดำเนินการ` / `ต้องติดตาม` / `ล่าช้า` / `ครบแล้ว`).

**Pending work is not a warning.** A round that has not started is neutral, not
amber. This is the rule the old dashboard broke by announcing
"รอส่งเข้า 4654 คน" in a yellow banner before any bus had left.

---

## 2. Typography

- Family: **Sarabun** (`font-sans`), self-hosted at 400 and 700.
- Numbers in KPIs, progress and tables use `tabular-nums` so digits align
  between rows and do not jitter while polling.
- `text-caption` (12px) is the floor for meaningful content. Anything smaller is
  decorative only.
- Form inputs are **≥16px** on mobile — below that iOS zooms the viewport on
  focus, which reads as the page jumping.

---

## 3. Spacing, shape, elevation

| token | value | use |
|---|---|---|
| `w-sidebar` | 240px | expanded sidebar |
| `w-sidebar-rail` | 72px | collapsed icon rail |
| `h-topbar` | 60px | top navigation bar |
| `shadow-soft` | — | resting cards |
| `shadow-elevate` | — | hover on interactive cards |
| `shadow-overlay` | — | drawers and modals only |

Radii: `rounded-lg` for controls, `rounded-xl` for chips and wells,
`rounded-2xl` for cards. Borders are hairline (`surface-border`); elevation is
reserved for things that genuinely float.

### z-index

Named, not ad hoc — `z-sticky` 20 · `z-rail` 30 · `z-drawer` 40 · `z-modal` 50 ·
`z-toast` 60. Before this, ordering between the drawer, dropdowns and toasts was
a guess made per file.

---

## 4. Focus and touch targets

```
.focus-ring          2px brand-600 outline, 2px offset   — light surfaces
.focus-ring-inverse  2px white outline, 2px offset       — the navy shell
```

Both are `:focus-visible` only, so pointer users never see a ring. **Every
interactive element uses one of these two** rather than a per-component variant.

`.tap-target` extends an element's hit box to the WCAG 2.2 (2.5.8) 44×44px
minimum via a centred `::after`, without changing how large the control looks.
Prefer a genuinely 44px control; use the utility only where the visual box must
stay small.

---

## 5. Motion

Motion explains a state change; it never decorates. Durations are 150–320ms.
`prefers-reduced-motion` is honoured globally in `index.css` (all animation and
transition durations collapse to 1ms), and entrance animations are additionally
gated behind `motion-safe:`.

---

## 6. Components

### Shell
| component | responsibility |
|---|---|
| `Layout` | shell frame, collapse state, single page scroll container |
| `Sidebar` | role navigation, 6 shared sections, rail mode |
| `TopNavbar` | page context, data scope, notifications, account menu |
| `MobileBottomNav` | driver's primary surface on mobile |
| `ResponsiveDrawer` | off-canvas panel with full dialog semantics |

### Content primitives (`components/ui/`)
`AppCard` · `AlertBanner` · `StatusBadge` · `SectionTitle` · `DashboardSection` ·
`KPIGrid` · `KPIStat` · `LiveKpiCard` · `RiskCard` · `AttentionCard` ·
`AttentionQueue` · `DailyOperationStatus` · `CommandHero` · `StatusStepRail` ·
`SearchableSelect` · `ResponsiveDrawer`

### Page-level
`PageHeader` · `EmptyState` · `ErrorState` · `LoadingState` · `Skeleton` ·
`Pagination` · `Toast` · `ErrorBoundary`

### Added by this redesign

**`ResponsiveDrawer`** — `role="dialog"` + `aria-modal`, Escape to close, focus
trap, background scroll lock, and focus returned to the trigger on close. It
replaced a bare `div` overlay that had none of those.

**`AttentionQueue`** — takes a list of signals and renders those with work as
full cards, folding the clear ones into a single "เรียบร้อย" line. Attention
should scale with the attention required; previously two empty cards occupied
as much of the fold as the one reporting 643 people waiting.
A signal whose request **failed** is reported separately as "ไม่ทราบสถานะ" —
never folded in with the clear ones, because claiming all-clear on the strength
of a failed request is worse than showing nothing.

**`DailyOperationStatus`** — morning/evening/emergency status with the
not-started rule described in §1.

---

## 7. Navigation

Six sections, identical vocabulary for all roles:

`ภาพรวม` · `งานดำเนินการ` · `ข้อมูลหลัก` · `ตรวจสอบและสนับสนุน` ·
`รายงานและวิจัย` · `ตั้งค่าระบบ`

Rules:
- A menu entry must point at a route that exists. `scripts/ui-redesign/nav-snapshot.mjs --compare`
  fails the check if one does not.
- Regrouping must never change *which* entries a role sees — only how they are
  ordered and labelled as groups.
- A role must never see an entry outside its route's `allowedRoles`.
- Feature-flagged routes stay hidden while their flag is off.

---

## 8. States every component must handle

`default` · `hover` · `focus` · `active` · `disabled` · `loading` · `error` ·
`empty`

Plus, at page level: partial error, permission denied, session expired, offline,
no search results, destructive confirmation, success feedback.

Partial failure must degrade, never blank the page: each request is tracked
independently, what loaded is shown, and what did not is stated plainly with a
retry.

---

## 9. PDPA

- Show the minimum identifying data the task needs.
- Server-side permission checks are the boundary; UI filtering is convenience,
  never security.
- Screenshots and fixtures use synthetic Thai data only — `capture.mjs`
  intercepts every `/api/` call, so real data cannot reach a capture.
- No third-party tracking, no data leaving the system.
- If a legal question is genuinely unclear, leave
  `// TODO: ตรวจสอบกับผู้เชี่ยวชาญ` rather than guessing.
