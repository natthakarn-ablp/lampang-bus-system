# UI/UX Redesign — Plan & Baseline

**แนวทาง:** Modern Civic + Safety First
**Branch:** `codex/full-ui-redesign`
**Worktree:** `D:/Projects/lampang-bus-system-uiredesign`
**Base commit:** `d9485ec` — *feat: refresh production login branding*
**Base branch:** `origin/feat/tracking-security-hardening` (production source of truth)

---

## 1. เหตุผลที่ใช้ production branch เป็นฐาน (ไม่ใช่ `origin/main`)

ตรวจด้วย `git rev-list --left-right --count origin/main...origin/feat/tracking-security-hardening` ได้ `0 60`:

| | ผล |
|---|---|
| `origin/main` มีแต่ production ไม่มี | **0 commits** |
| production มีแต่ `origin/main` ไม่มี | **60 commits** |
| merge-base | `8aab2f0` = tip ของ `origin/main` เอง |

แปลว่า **`origin/main` ถูกรวมอยู่ใน production ครบแล้ว** และ production ใหม่กว่า 60 commits
(UAT seed, readiness gate, training manuals, go-live closure, tracking security, หน้า Login `d9485ec`)

การแตก branch จาก `origin/main` จึงทำให้งาน 60 commits หาย — จึงไม่ทำ

`631dccf` (`codex/login-brand-ready`) เป็นหน้า Login คนละสายที่ **diverged** จาก `d9485ec`
(ไม่มีใครเป็น ancestor ของใคร, ต่างกัน 96+/42− บรรทัดในไฟล์เดียวกัน) การ cherry-pick จะ
conflict และถอยหลังหน้า Login ที่ deploy อยู่จริง — จึงไม่ทำ

**ผล:** Phase 1 ข้อ "รวมหน้า Login ใหม่เข้าฐานโค้ดล่าสุด" เสร็จอัตโนมัติตั้งแต่สร้าง worktree

---

## 2. Baseline Inventory

### Route inventory
- **89 routes** ทั้งหมด (`outputs/ui-redesign/nav-before.json`)
- **10 routes** ไม่มี role guard: `/login` `/change-password` `/manual/*` `/qr/:token` `/parent` `/parent/link` `/parent/link/link` `/link` `/` `/*`
- routes ที่แต่ละ role เข้าถึงได้: admin 67 · school 19 · province 18 · affiliation 17 · driver 12 · transport 6

### Navigation snapshot (ก่อนแก้)
| role | เมนู | หมวดเดิม |
|---|---|---|
| driver | 8 | ภาพรวม / งานประจำวัน / ข้อมูล |
| school | 13 | ภาพรวม / นักเรียนและรถรับส่ง / แผนที่และตำแหน่ง / คำขอและบัญชี / ติดตามและบันทึก / รายงาน |
| affiliation | 12 | ภาพรวม / ข้อมูลในสังกัด / คำขอและอนุมัติ / แผนที่และตำแหน่ง / ติดตามและบันทึก / รายงาน |
| province | 12 | ภาพรวม / ข้อมูลพื้นฐาน / แผนที่และการกำกับติดตาม / ติดตามและบันทึก / รายงาน |
| transport | 4 | ภาพรวม / บันทึก |
| admin | 25 | ภาพรวม / จัดการระบบ / ตรวจสอบและสนับสนุน / มุมมองจังหวัด / รายงานและวิเคราะห์ |

**ตรวจแล้ว: ไม่มีเมนูเกินสิทธิ์** — ทุก `to` ของทุก role อยู่ใน `allowedRoles` ของ route นั้น

### Design tokens ที่มีอยู่แล้ว (`frontend/tailwind.config.js`)
| ต้องการ | สถานะเดิม |
|---|---|
| Primary Blue `#2563EB` | ✅ `brand.600` |
| Background `#F8FAFC` | ✅ `surface.DEFAULT` |
| Raised `#FFFFFF` | ✅ `surface.raised` |
| Ink `#0F172A` / muted `#64748B` | ✅ `ink` / `ink.muted` |
| success / warn / danger / info (+`soft`) | ✅ ครบ |
| Sarabun | ✅ `fontFamily.sans` |
| **Civic Navy `#123B6D`** | ❌ **ต้องเพิ่ม** |
| focus ring กลาง | ❌ ต้องเพิ่ม |
| z-index scale | ❌ ต้องเพิ่ม |

### Components ที่มีอยู่แล้ว
`components/ui/` (13): AppCard · AlertBanner · AttentionCard · KPIStat · KPIGrid · DashboardSection ·
StatusBadge · SectionTitle · CommandHero · RiskCard · StatusStepRail · LiveKpiCard · SearchableSelect

นอก `ui/` (11): PageHeader · EmptyState · ErrorState · LoadingState · Skeleton · Sidebar ·
TopNavbar · MobileBottomNav · Pagination · ErrorBoundary · Toast

**ยังไม่มี:** FilterBar · DataTable · FormField · ConfirmDialog · ResponsiveDrawer
(สร้างเมื่อมี consumer จริงเท่านั้น ตามข้อกำหนด)

### Hardcoded styles (ไม่ทำ global replace)
`bg-blue-*` 164 จุด · `bg-gray-*` 152 จุด · `bg-slate-*` 5 จุด · `bg-[#…]` 0 จุด
→ ลดเฉพาะไฟล์ที่ migrate ในแต่ละ phase

---

## 3. ปัญหาที่ยืนยันจากภาพ Before (Admin Dashboard)

| # | ปัญหา | หลักฐาน |
|---|---|---|
| 1 | **KPI "ผู้ใช้งาน" = 0** ทั้งที่รถ 481 / นักเรียน 4,696 / โรงเรียน 317 | บั๊กจริง — ดูข้อ 4 |
| 2 | Alert เหลืองใหญ่แสดง "รอส่งเช้า 4654 คน" ทั้งที่ยังไม่เริ่มรอบ | ไม่มี context |
| 3 | การ์ด Attention ที่ count=0 สูงเท่าการ์ดที่มีข้อมูล | พื้นที่ว่างเปล่า 2 ใบ |
| 4 | Active state เป็นแถบขาวเต็มใบ | `bg-white` ทับทั้ง item |
| 5 | Scrollbar ซ้อน 2 ชั้น | `nav overflow-y-auto` + `main overflow-y-auto` |
| 6 | ชื่อผู้ใช้ซ้ำ sidebar + topbar | "เข้าสู่ระบบในฐานะ System Admin" + "System Admin" |
| 7 | Sidebar กว้าง 224px (`md:w-56`) | สเปกต้องการ 240–256px |
| 8 | สี sidebar เป็น `brand-800` `#1E40AF` (น้ำเงิน) | สเปกต้องการ Navy `#123B6D` |

## 4. บั๊ก KPI ผู้ใช้งาน — root cause

`frontend/src/pages/admin/AdminDashboard.jsx`
```
บรรทัด 34:  api.get('/admin/users?per_page=5&is_active=false')   ← ดึงเฉพาะบัญชีถูกระงับ
บรรทัด 56:  const totalUsers = users?.meta?.total ?? 0;
บรรทัด 111: <KPIStat label="ผู้ใช้งาน" value={totalUsers} />     ← แสดงเป็นผู้ใช้ทั้งหมด
```

ยืนยัน API (`backend/src/routes/admin.routes.js:35-50`): `is_active` เป็น optional filter,
ถ้าไม่ส่งจะนับทุกบัญชีที่ `is_deleted = FALSE`

**วิธีแก้:** เพิ่ม request `/admin/users?per_page=1` (ไม่ส่ง `is_active`) แล้วใช้ `meta.total`
→ **frontend อย่างเดียว ไม่แตะ backend ไม่แตะ schema**

---

## 5. วิธีทำ Before/After

ใช้ **Playwright + mock route interception** (`scripts/browser-review.mjs` ที่มีอยู่ใน repo)

**เหตุผลที่ไม่ใช้ local MySQL:** goal กำหนดให้ทดสอบสถานะ zero-count / large-count /
partial-error / empty / loading ซึ่ง **ฐานข้อมูลจริงสร้างสถานะเหล่านี้ไม่ได้** แต่ mock ทำได้ครบ
และการันตี PDPA โดยโครงสร้าง เพราะเป็นข้อมูลสมมติภาษาไทยล้วน ไม่มีข้อมูลจริงเข้ามาได้เลย
(Docker มีในเครื่อง แต่ `.env` ไม่มีใน worktree และเส้นทาง 43 migrations + seed + boot backend
มีจุดล้มเหลวมากกว่า โดยไม่เพิ่มคุณค่าให้ภาพ)

- Viewports: **390 / 768 / 1280 / 1920**
- Artifacts: `outputs/ui-redesign/{before,after}/`
- ห้ามต่อ local frontend เข้า production API — mock ดักทุก `/api/**` จึงเป็นไปไม่ได้โดยโครงสร้าง

---

## 6. เครื่องมือตรวจ regression

`scripts/ui-redesign/nav-snapshot.mjs` — สกัด route inventory + navigation snapshot จาก source
(ไม่ต้องใช้ browser/DB)

```bash
node scripts/ui-redesign/nav-snapshot.mjs --compare outputs/ui-redesign/nav-before.json
```

ตรวจ 3 อย่าง: **ไม่มี route หาย** · **ไม่มีเมนูหาย** · **ไม่มีเมนูชี้ไป route ที่ไม่มีจริง**
รันหลังทุก phase — exit 1 ถ้าพบปัญหา

---

## 7. Route/Page completion matrix

ดู `outputs/ui-redesign/route-matrix.md` (สร้างจาก route inventory จริง)

---

## 8. ข้อจำกัดที่ยึดตลอดงาน

- ไม่แก้ backend, schema, migrations, authentication, authorization, API contract
- ไม่ลบ/เปลี่ยน path เดิม — เปลี่ยนได้แค่การจัดกลุ่มและการนำเสนอ
- ไม่แตะ worktree เดิมทั้งสาม
- ไม่ push, ไม่ deploy

---

## 9. Outcome (updated at the end of the redesign work)

| metric | before | after |
|---|---|---|
| Captures | 23 | 46 |
| Sub-44×44px tap targets | **370** | **0** |
| Horizontal overflow at 390/768/1280/1920 | 0 | 0 |
| Sub-16px inputs on mobile | — | 0 |
| Console errors (excluding the deliberate failure scenario) | 8 | 0 |
| Routes | 89 | 89 — none lost |
| Menu entries across 6 roles | 74 | 74 — none lost |
| Menu entries outside a role's `allowedRoles` | 0 | 0 |

**Bugs found and fixed** (all frontend-only; no backend, schema, auth or API
contract was touched):

1. Admin KPI "ผู้ใช้งาน" reported the count of *suspended* accounts
2. `TransportDashboard` blanked the page on a non-array vehicles response —
   plus the same latent crash in 12 more files (16 assignments)
3. The attention queue reported "เรียบร้อย" when the request had failed
4. Semantic text on `-soft` backgrounds failed WCAG AA in four tones
   (warn at 1.93:1); `kpiColor` failed on white in three
5. The audit log described an EXPORT as "แก้ไข: format, rows"

See `docs/ui-redesign-uat.md` for the UAT plan, the per-page migration status
and the known limitations.
