# UI Label Enforcement — แนวทางการตรวจคำบน UI

## สรุปย่อ

ระบบมี quality gate 3 ชั้นสำหรับตรวจคำบน UI:

| ชั้น | เมื่อไหร่ | อะไร | Mode |
|------|----------|------|------|
| **Manual** | ก่อน commit | `npm run check:labels` | advisory |
| **Pre-commit** | ตอน `git commit` | git hook อัตโนมัติ | advisory / strict |
| **CI** | ตอนเปิด PR | GitHub Actions | strict |

---

## 0. หลัง clone (ทำครั้งเดียว)

```bash
# 1. ติดตั้ง dependencies
cd frontend && npm install
cd ../backend && npm install

# 2. ติดตั้ง pre-commit hook (เลือกอย่างใดอย่างหนึ่ง)
cd ../frontend

npm run hooks:install           # advisory — เตือนแต่ไม่บล็อก commit
npm run hooks:install:strict    # strict — บล็อก commit ถ้าพบคำต้องห้าม
```

Hook จะถูกติดตั้งที่ `.git/hooks/pre-commit` โดยอัตโนมัติ
ทำครั้งเดียวต่อ clone — ไม่ต้องทำซ้ำ

---

## 1. Mode ที่มี

| Mode | คำสั่ง | พฤติกรรม |
|------|--------|----------|
| **Advisory** | `npm run check:labels` | แสดง warning ถ้าพบคำต้องห้าม แต่ไม่ fail (exit 0) |
| **Strict** | `npm run check:labels:strict` | fail ทันที (exit 1) ถ้าพบคำต้องห้ามใน UI text |
| **Verbose** | `npm run check:labels:verbose` | แสดง code snippet ทุกจุดที่พบ |

---

## 2. ใช้งานประจำวัน

### ตรวจด้วยมือ
```bash
cd frontend
npm run check:labels            # advisory
npm run check:labels:strict     # strict
npm run check:labels:verbose    # verbose
```

### Pre-commit (อัตโนมัติ)
ถ้าติดตั้ง hook แล้ว จะทำงานอัตโนมัติเมื่อ `git commit`:
- ตรวจเฉพาะไฟล์ `.js`, `.jsx`, `.ts`, `.tsx` ที่ staged ใน `frontend/src/`
- Advisory mode: เตือนแต่ให้ commit ผ่าน
- Strict mode: บล็อก commit ถ้าพบคำต้องห้ามใน UI text
- ข้ามได้ด้วย `git commit --no-verify` (ไม่แนะนำ)

### เปลี่ยน mode / ถอด hook
```bash
cd frontend
npm run hooks:install           # เปลี่ยนเป็น advisory
npm run hooks:install:strict    # เปลี่ยนเป็น strict
npm run hooks:remove            # ถอด hook ออก
```

### CI / Pull Request
GitHub Actions จะรัน `check-ui-labels.js --strict` อัตโนมัติเมื่อเปิด PR ที่แตะ:
- `frontend/src/**`
- `LABEL_STANDARDS.md`
- `scripts/check-ui-labels.js`
- `frontend/src/constants/uiLabels.js`

ถ้าพบคำต้องห้ามใน UI text — PR จะไม่ผ่าน check

---

## 3. คำต้องห้าม (จาก LABEL_STANDARDS.md §5)

| คำต้องห้าม | ใช้แทน |
|-----------|--------|
| เขตพื้นที่ | สังกัด |
| ลาวันนี้ | นักเรียนลา |
| นักเรียนลาวันนี้ | นักเรียนลา |
| ดำเนินการแล้ว | สำเร็จแล้ว |
| ยังไม่ครบ | ยังมีรายการค้าง |
| สถานะรายคัน | สถานะรถแต่ละคัน |
| ภาพรวมจังหวัดลำปาง | ภาพรวมจังหวัด |
| ภาพรวมเขตพื้นที่ | ภาพรวมสังกัด |

---

## 4. ข้อยกเว้น

Script จะ **ไม่บล็อก** กรณีเหล่านี้:

- **ข้อมูลจาก DB** (เช่น ชื่อสังกัดจริง) — ไม่ถือเป็น hardcoded UI text
- **Regex / string manipulation** (เช่น `.replace(/เขตพื้นที่/g, '')`) — จัดเป็น non-UI
- **Comments** — ไม่ถือเป็น UI
- **Driver pages** — "ลาวันนี้" ได้รับอนุญาตตาม §6 (driver operational context)

ถ้าพบ false positive ที่เกิดซ้ำ:
1. เพิ่มใน `EXCEPTION_PATHS` ของ `scripts/check-ui-labels.js`
2. ระบุเหตุผลในโค้ด

---

## 5. สำหรับ dev ที่เขียนหน้าใหม่

```jsx
// ใช้ constants จากแหล่งกลาง
import { PAGE_TITLES, CARD_LABELS, STATUS, UI_MESSAGES } from '../../constants/uiLabels';

<h1>{PAGE_TITLES.SCHOOL_DASHBOARD}</h1>
<p>{UI_MESSAGES.LOADING}</p>
```

ดูรายการ constants ทั้งหมดที่: `frontend/src/constants/uiLabels.js`

---

## 6. ข้อจำกัดที่ต้องรู้

- Script เป็น **heuristic** ไม่ใช่ AST-level linter — ความแม่นยำ ~90%
- แยก UI text vs non-UI ด้วย pattern matching (ไม่ 100%)
- ผลลัพธ์ "NEEDS REVIEW" ต้องตัดสินด้วยคน
- ไม่ตรวจ: dynamic strings, template literals ที่ซับซ้อน, string concat

**สิ่งนี้คือ foundation for enforcement ไม่ใช่ perfect enforcement**
