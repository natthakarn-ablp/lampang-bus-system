# ระบบรถรับส่งนักเรียนจังหวัดลำปาง (lampang-bus-system)

ระบบเช็กชื่อขึ้น-ลงรถรับส่งนักเรียน การจัดการนักเรียน/รถ/คนขับ รายงานระดับโรงเรียน เขต จังหวัด และการแจ้งเตือนผู้ปกครองผ่าน LINE — ใช้งานจริงที่ schoolbuslampang.com

- Backend: Node.js + Express + MySQL 8 (`backend/`)
- Frontend: React 18 + Vite + Tailwind (`frontend/`)
- LINE OA / LIFF สำหรับผู้ปกครอง
- บทบาท: คนขับ, โรงเรียน (และครูประจำชั้น), เขตพื้นที่, จังหวัด, ขนส่ง, ผู้ดูแลระบบ, ผู้ปกครอง (ผ่าน LINE)

## เอกสาร
| เริ่มที่ | |
|---|---|
| [`docs/INDEX.md`](docs/INDEX.md) | สารบัญ: เอกสารปัจจุบัน vs ประวัติ, สิ่งที่เผยแพร่สาธารณะ |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | สถาปัตยกรรม, runtime, CI/deploy, migration, backup |
| [`docs/modules/`](docs/modules/README.md) | เอกสารรายโมดูล (จุดเข้า โค้ด ตาราง กติกา test) |
| [`CLAUDE.md`](CLAUDE.md) | กติกากลางสำหรับ AI/ผู้พัฒนา |

## พัฒนาในเครื่อง
```bash
# backend
cd backend && npm ci
cp .env.example .env               # ตั้งค่า DB_* ชี้ MySQL 8 ในเครื่อง
npx jest --config jest.unit.config.js --runInBand --forceExit   # unit test ไม่ใช้ DB
npm run test:ci                     # integration: ต้องมีฐาน lampang_bus_test (ดู tests/loadTestEnv.js)

# frontend
cd frontend && npm ci && npm run dev
```
CI (`.github/workflows/full-quality.yml`) รันครบทุก push: unit, integration กับ MySQL, ตรวจ migration, frontend build, UI gates, Playwright, secret scan

## กติกาสำคัญ
- branch หลักที่ production ใช้: `feat/tracking-security-hardening` — ทำงานผ่าน PR
- deploy ด้วย `scripts/deploy-backend.sh` + `DEPLOY_TARGET_SHA` ที่ CI ผ่านเท่านั้น; migration apply แยกโดยเจ้าของ
- repository เป็น public: ห้าม commit ข้อมูลนักเรียน/ผู้ปกครองจริง, secret, ไฟล์ backup
