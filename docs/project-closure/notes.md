# Notes: สถานะสำหรับปิดโครงการระบบ

เอกสารนี้ใช้บันทึกข้อค้นพบจาก repository และหลักฐาน production ระหว่างจัดทำ Master Project Closure Plan

## Verified Baseline

- Production source อยู่ที่ commit `0060c3e` และ server worktree สะอาดเมื่อ 3 กันยายน 2569
- PM2 backend online, public site และ health endpoint ทำงานหลัง deploy ล่าสุด
- Migration 43 ไฟล์ถูก track ครบ ไม่มี untracked หรือ checksum drift
- Backend unit tests ล่าสุดผ่าน 43 suites / 445 tests
- Frontend production build ผ่าน และ postdeploy/public gates ล่าสุดผ่าน 13/13 และ 5/5
- Local backup, checksum/gzip, scratch restore drill และ off-host sync ผ่านในรอบล่าสุด
- ข้อมูล production เป็นข้อมูลจริง ต้องใช้ read-only aggregate ในการ audit และห้ามใช้เป็น UAT ที่เขียนข้อมูล
- ฟังก์ชันรายงานเชิงนโยบายมี implementation จริงที่ `/api/reports/policy`; เอกสารเก่าที่ระบุว่ายังไม่มีเป็น historical snapshot
- คู่มือ PDF สร้างล่าสุด 31 สิงหาคม 2569 และมี screenshot แยกบทบาทใน `docs/manual-html/screenshots/`
- Production เปิด `FEATURE_DRIVER_REGISTRATION=true`; feature ทดลองอื่นที่ตรวจสอบอยู่ในสถานะ unset/ปิด รวมทั้ง admin password recovery

## Gaps And Dependencies

- UAT/sign-off ฉบับ 2026-08 ยังเป็น template และไม่มีหลักฐานครบทุกบทบาท
- ยังไม่มี load-test suite ที่พิสูจน์การใช้งานพร้อมกัน 1,000 คน; มีเพียง environment helper สำหรับ test
- ระบบ production เป็น single backend instance และ lockout/dedup/linking state บางส่วนอยู่ใน memory; ต้องย้าย state ไป Redis/DB ก่อน scale หลาย instance
- Security residuals ที่ต้อง fix หรือมี risk acceptance: refresh-token rotation/replay, localStorage token, export rate-limit coverage, export streaming และ legacy weak-password rotation
- ต้องยืนยัน PDPA/consent/QR/LINE policy โดย DPO/ผู้มีอำนาจจริงก่อนเปิด feature ที่เกี่ยวข้อง
- Account recovery ทุกสิทธิ์เป็น accepted scope; ต้องตัดสินใจ business logic ของบัญชีกลางโรงเรียน/ต้นสังกัด/ขนส่ง และบัญชีคนขับที่ login ด้วยทะเบียนรถก่อนเปิดแต่ละกลุ่ม
- คู่มือบางสถานะอ้าง feature flag และ commit เก่า ต้องทำ content/version audit แล้ว regenerate PDF/เว็บไซต์จาก source ปัจจุบัน
- เอกสาร screenshot tracker เดือนพฤษภาคมล้าสมัยกว่าภาพที่มีจริง จึงห้ามใช้ tracker นั้นเป็นสถานะปัจจุบันจนกว่าจะ reconcile
- ต้องทดสอบ controlled reboot, external uptime alert และกำหนด RTO/RPO/on-call เพื่อปิด operational resilience
- การเปิด feature ทดลองทั้งหมดไม่ใช่เงื่อนไขปิดโครงการ; owner สามารถ defer เป็น backlog ได้ถ้ามีเหตุผล ความเสี่ยง และผู้รับผิดชอบ

## Human And External Actions

- Project owner อนุมัติ scope freeze, rollout policy และ residual-risk acceptance
- Data owners ของโรงเรียน/ต้นสังกัดรับรองคุณภาพและ ownership ของข้อมูลจริง
- ตัวแทนแต่ละบทบาททำ UAT ใน sandbox/pilot และลงนามจากหลักฐานจริง
- Admin จริงทำ UAT ระบบกู้รหัสผ่านผ่าน LINE ก่อนเปิด feature flag
- DPO/legal ลงนาม consent, QR, parent LINE และ retention policy
- Operator ทำ controlled reboot/DR drill และรับรอง runbook/on-call
- หน่วยงานกำหนดผู้ดูแลระบบหลังส่งมอบ, backup owner, SLA และช่องทาง support
