# Hybrid Motion UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this project unless the user explicitly asks for them.

**Goal:** Apply the approved Hybrid Motion Ops direction to the vehicle safety workflow UI while keeping the existing app reliable, readable, and Thai-first.

**Architecture:** Keep the existing React + Tailwind structure. Add small shared UI primitives for command-style headers and status steps, then apply them to the three in-scope workflow screens: school vehicle verification, transport verification queue, and driver shift selection. Use static design guard tests because the frontend currently has no test runner.

**Tech Stack:** React 18, Vite, Tailwind CSS 3, lucide-react, existing backend API clients, Node static checks.

**No commit/push rule:** The user explicitly asked not to commit or push. Replace commit steps with checkpoint verification and `git status --short`.

---

## File Structure

- Create: `frontend/scripts/check-hybrid-motion-ui.mjs`
  - Static design guard test for the redesign. It checks that banned visual patterns are removed and that the new shared primitives are wired into the target pages.
- Modify: `frontend/package.json`
  - Add `check:hybrid-ui` script to run the static guard.
- Modify: `frontend/src/index.css`
  - Add small global utility rules for reduced motion and balanced Thai headings.
- Create: `frontend/src/components/ui/CommandHero.jsx`
  - Reusable dark command header for dashboard/workflow surfaces. Must stay readable and avoid glass/neon/gradient text.
- Create: `frontend/src/components/ui/StatusStepRail.jsx`
  - Reusable horizontal step/status rail for workflow state.
- Modify: `frontend/src/components/ui/index.js`
  - Export new primitives.
- Modify: `frontend/src/components/ui/AlertBanner.jsx`
  - Replace side-stripe alert treatment with full border/background/icon treatment.
- Modify: `frontend/src/pages/school/VehicleVerification.jsx`
  - Apply command hero, status rail, better list/detail layout, privacy copy, and print-safe verification packet layout.
- Modify: `frontend/src/pages/transport/VerificationQueue.jsx`
  - Apply command hero, status rail, stronger queue/detail split, safer checklist ergonomics, and clearer driver authorization forms.
- Modify: `frontend/src/pages/driver/DriverShift.jsx`
  - Apply mobile-first command surface, clearer active shift state, safer blocked reasons, and large touch targets.

---

### Task 1: Static Design Guard

**Files:**
- Create: `frontend/scripts/check-hybrid-motion-ui.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing static design guard**

Create `frontend/scripts/check-hybrid-motion-ui.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const checks = [
  {
    file: 'src/components/ui/AlertBanner.jsx',
    name: 'AlertBanner must not use side-stripe borders',
    pass: content => !/border-l-[2-9]/.test(content) && !/border-l-/.test(content),
  },
  {
    file: 'src/components/ui/CommandHero.jsx',
    name: 'CommandHero component exists with reduced-motion support',
    pass: content => /export default function CommandHero/.test(content) && /motion-reduce:/.test(content),
  },
  {
    file: 'src/components/ui/StatusStepRail.jsx',
    name: 'StatusStepRail component exists and renders steps accessibly',
    pass: content => /export default function StatusStepRail/.test(content) && /aria-label/.test(content),
  },
  {
    file: 'src/pages/school/VehicleVerification.jsx',
    name: 'school verification page uses command hero and status rail',
    pass: content => /CommandHero/.test(content) && /StatusStepRail/.test(content) && /VehiclePrivacyNotice/.test(content),
  },
  {
    file: 'src/pages/transport/VerificationQueue.jsx',
    name: 'transport queue page uses command hero and status rail',
    pass: content => /CommandHero/.test(content) && /StatusStepRail/.test(content) && /InspectionChecklistPanel/.test(content),
  },
  {
    file: 'src/pages/driver/DriverShift.jsx',
    name: 'driver shift page uses command hero and driver-safe action labels',
    pass: content => /CommandHero/.test(content) && /DriverVehicleCard/.test(content) && /เริ่มรอบด้วยรถคันนี้/.test(content),
  },
];

const failures = [];

for (const check of checks) {
  const fullPath = path.join(root, check.file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${check.file}: missing file for "${check.name}"`);
    continue;
  }
  const content = read(check.file);
  if (!check.pass(content)) {
    failures.push(`${check.file}: ${check.name}`);
  }
}

if (failures.length > 0) {
  console.error('Hybrid Motion UI guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Hybrid Motion UI guard passed');
```

- [ ] **Step 2: Add script entry**

Modify `frontend/package.json` scripts:

```json
"check:hybrid-ui": "node ./scripts/check-hybrid-motion-ui.mjs"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
```

Expected: FAIL because `CommandHero.jsx`, `StatusStepRail.jsx`, and the required page wiring do not exist yet, and `AlertBanner.jsx` still uses `border-l-4`.

---

### Task 2: Shared UI Primitives

**Files:**
- Modify: `frontend/src/index.css`
- Create: `frontend/src/components/ui/CommandHero.jsx`
- Create: `frontend/src/components/ui/StatusStepRail.jsx`
- Modify: `frontend/src/components/ui/index.js`
- Modify: `frontend/src/components/ui/AlertBanner.jsx`

- [ ] **Step 1: Add global reduced-motion and text-wrap utilities**

Add to `frontend/src/index.css` after Tailwind directives:

```css
@layer utilities {
  .text-balance {
    text-wrap: balance;
  }

  .text-pretty {
    text-wrap: pretty;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}
```

- [ ] **Step 2: Implement `CommandHero`**

Create a reusable hero with props `eyebrow`, `title`, `description`, `icon`, `actions`, `meta`, `children`, `className`. It must use solid text, no gradient text, and include `motion-reduce:animate-none`.

- [ ] **Step 3: Implement `StatusStepRail`**

Create a reusable rail with props `steps`, `currentKey`, `className`, `ariaLabel`. Each step accepts `{ key, label, description, status }`. Status maps to semantic colors.

- [ ] **Step 4: Export new primitives**

Add exports to `frontend/src/components/ui/index.js`:

```js
export { default as CommandHero }     from './CommandHero';
export { default as StatusStepRail }  from './StatusStepRail';
```

- [ ] **Step 5: Refactor `AlertBanner` away from side-stripe**

Replace `border-l-4` with full border treatment. Variant styles should include `wrap`, `icon`, and `ring` classes. Example shape:

```jsx
className={`flex gap-3 rounded-xl border px-4 py-3 ${style.wrap} ${className}`}
```

- [ ] **Step 6: Run guard**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
```

Expected: still FAIL because target pages are not wired yet.

---

### Task 3: School Vehicle Verification Surface

**Files:**
- Modify: `frontend/src/pages/school/VehicleVerification.jsx`

- [ ] **Step 1: Import shared primitives**

Add imports:

```js
import { AlertTriangle, CheckCircle2, Clock3, Route, Users } from 'lucide-react';
import { CommandHero, StatusStepRail } from '../../components/ui';
```

Keep existing imports that are still used.

- [ ] **Step 2: Add page helper components**

Inside the file, add focused helpers:

- `VehiclePrivacyNotice`
- `VerificationProgress`
- `VehicleRequestCard`
- `VerificationHistoryRow`
- `VerificationPacket`

Each helper must keep labels Thai-first and use existing API data without changing backend behavior.

- [ ] **Step 3: Replace the plain header with `CommandHero`**

The hero must show:

- title: `ส่งตรวจและรับรองรถ`
- description: tells the user one online packet can combine shared-school vehicle usage
- meta: `ไม่เปิดรายชื่อนักเรียนให้ขนส่ง`
- action: refresh button with label `รีเฟรชข้อมูล`

- [ ] **Step 4: Add `StatusStepRail`**

Use steps:

```js
[
  { key: 'vehicle', label: 'เลือกรถ', description: 'เลือกรถที่โรงเรียนใช้งาน', status: 'complete' },
  { key: 'packet', label: 'ออกใบส่งตรวจ', description: 'รวมจำนวนเด็กตามโรงเรียน', status: selected ? 'complete' : 'current' },
  { key: 'transport', label: 'ขนส่งตรวจ', description: 'เจ้าหน้าที่ลงผลในระบบ', status: 'upcoming' },
  { key: 'certified', label: 'รับรองผล', description: 'โรงเรียนติดตามสถานะได้', status: 'upcoming' },
]
```

- [ ] **Step 5: Rework empty/list/detail states**

Use `AppCard`, `StatusBadge`, stronger labels, and large touch targets. Detail mode must keep QR and print button clear.

- [ ] **Step 6: Run guard and build**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
npm --prefix frontend run build
```

Expected: guard may still FAIL because transport/driver pages are not wired. Build must PASS.

---

### Task 4: Transport Verification Queue Surface

**Files:**
- Modify: `frontend/src/pages/transport/VerificationQueue.jsx`

- [ ] **Step 1: Import shared primitives**

Add:

```js
import { CommandHero, StatusStepRail } from '../../components/ui';
```

- [ ] **Step 2: Add helper components**

Inside the file, add:

- `QueueSummary`
- `QueueItem`
- `DriverAuthorizationPanel`
- `InspectionChecklistPanel`

The static guard requires `InspectionChecklistPanel` to exist by name.

- [ ] **Step 3: Replace the header**

Use `CommandHero` with:

- title: `คิวตรวจและรับรองรถ`
- description: clarifies that the queue is grouped by vehicle, not by student
- meta: `เจ้าหน้าที่เห็นข้อมูลรถ คนขับ จำนวนผู้โดยสาร และพื้นที่รับส่ง`

- [ ] **Step 4: Improve queue/detail split**

Keep the existing `lg:grid-cols-[380px_1fr]` structure, but make the left queue sticky-feeling through clearer search/filter controls and selected state.

- [ ] **Step 5: Improve checklist ergonomics**

Checklist buttons must have visible selected state, failed items must force note copy, and final submit must stay disabled until required items are complete.

- [ ] **Step 6: Run guard and build**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
npm --prefix frontend run build
```

Expected: guard may still FAIL because driver page is not wired. Build must PASS.

---

### Task 5: Driver Shift Mobile Surface

**Files:**
- Modify: `frontend/src/pages/driver/DriverShift.jsx`

- [ ] **Step 1: Import `CommandHero`**

Add:

```js
import { CommandHero } from '../../components/ui';
```

- [ ] **Step 2: Add `DriverVehicleCard` helper**

The static guard requires `DriverVehicleCard` to exist by name. It must show:

- plate number
- vehicle type
- primary/backup role
- verification status as Thai label
- blocking reasons as text, not color alone
- action label `เริ่มรอบด้วยรถคันนี้`

- [ ] **Step 3: Replace the header**

Use `CommandHero` with:

- title: `เลือกรถและเริ่มรอบ`
- description: explains the system records the actual driver for the current route
- mobile-readable action: refresh button

- [ ] **Step 4: Improve active shift state**

Active shift should use a strong success card with clear `สิ้นสุดรอบ` action. Keep touch targets large.

- [ ] **Step 5: Run guard and build**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
npm --prefix frontend run build
```

Expected: guard PASS and build PASS.

---

### Task 6: Final Verification

**Files:**
- No code changes unless verification finds a defect.

- [ ] **Step 1: Run frontend checks**

Run:

```powershell
npm --prefix frontend run check:hybrid-ui
npm --prefix frontend run check:labels
npm --prefix frontend run build
```

Expected:

- `check:hybrid-ui`: PASS
- `check:labels`: existing warnings may remain if they are unrelated, but no new fatal error
- `build`: PASS

- [ ] **Step 2: Run diff hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected:

- `git diff --check`: no whitespace errors
- `git status --short`: files changed but not committed

- [ ] **Step 3: Browser spot check if dev server is running**

Open:

- `http://127.0.0.1:5173/school/vehicle-verification`
- `http://127.0.0.1:5173/transport/verification`
- `http://127.0.0.1:5173/driver/shift`

Expected:

- Pages render without console-blocking crashes
- Primary actions are visible
- Cards and command surfaces stay readable
- No dark document/checklist surface
- Motion does not block content

---

## Self-Review

**Spec coverage:** This plan covers Hybrid surfaces, motion guardrails, Thai readability, no side-stripe alerts, status text plus color, vehicle verification packet, transport inspection queue, and driver shift mobile surface.

**Placeholder scan:** No TODO, TBD, or “implement later” placeholders are included.

**Type consistency:** Shared components use simple prop shapes. Target pages remain data-compatible with existing API responses.

**Scope control:** This is not a whole-app redesign. It upgrades the vehicle safety workflow first, which is the highest-value area for the current feature.
