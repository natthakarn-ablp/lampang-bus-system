# pickup-gps-eta — จุดรับส่ง, ตำแหน่งรถสด, ประวัติเส้นทาง, ETA, geofence, route deviation

## หน้าที่
คนขับส่งพิกัด GPS → เก็บตำแหน่งล่าสุด + ประวัติ; โรงเรียน/เขต/จังหวัดดูรถสดและเล่นย้อนเส้นทาง; จัดการจุดรับ-ส่ง (pickup points) และผูกนักเรียน;
เมื่อเปิด flag จะคำนวณ ETA, ตรวจเข้า-ออก geofence และตรวจการเบี่ยงเส้นทางทุกครั้งที่ได้พิกัด.

## จุดเข้า
Mount ใน `app.js` (L252-259): `/api/eta` ← `FEATURE_ETA`; `/api/geofences` ← `FEATURE_GEOFENCE`; `/api/route-deviations` ← `FEATURE_ROUTE_DEVIATION`. flag ปิด = 404 และ hook ในการส่งพิกัดถูกข้าม. ส่วนอื่นไม่มี flag. `FEATURE_*` อ่านใน `config/env.js`.

พิกัด (คนขับ, `driver.routes.js`): POST /api/driver/vehicle-location (L1260), POST /vehicle-location/batch (L1401, ส่งย้อนจาก buffer offline), DELETE /vehicle-location (L1475, หยุดแชร์ → `pauseLocation`)
รถสด/ย้อนเส้นทาง (อ่านอย่างเดียว): GET /live-vehicles ที่ school (L2489), affiliation (L720), province (L263), admin (L1927); GET /vehicles/:vehicleId/track และ /track-days ที่ admin (L1941), province (L277), affiliation (L750), school (L2517) — ใช้ `makeTrackHandlers` ร่วมกัน
แผนที่จุดรับ (aggregate ไม่มี PII): GET /pickup-map ที่ affiliation (L758), province (L284), transport (L336)
จุดรับ-ส่ง: คนขับ GET /api/driver/pickup-points (L256), /pickup-students (L284), POST /pickup-points (L306), DELETE /pickup-points/:id (L365), GET /pickup-points/:id/assignable-students (L394), PUT /pickup-points/:id/students (L418); โรงเรียนมีชุดเดียวกันที่ `school.routes.js` L309-514 (เขียนต้อง `requireFullSchoolScope`)
ผู้ปกครอง: GET /api/parent/children/:id/history (L203), /children/:id/eta (L243) — ดู [line-parent.md](line-parent.md)
ETA: GET /api/eta/vehicle/:vehicleId, GET /api/eta/student/:studentId (`eta.routes.js:84,103`)
Geofence (`geofence.routes.js`, admin/province): GET /events/list, POST /seed-defaults (admin), GET/POST /, GET/PUT/DELETE /:id
Route deviation (`routeDeviation.routes.js:25`, admin/province): GET /

## โค้ดหลัก
- `services/vehicleLocation.service.js` (470) — `upsertLocation` (L46), `appendHistoryBatch` (L117), `pauseLocation`, `computeStatus`, `vehicleScopeSql` (L286), `findVehicleInScope` (L323), `listForSchool/Affiliation/All`
- `services/vehicleTrack.service.js` (353) — `getTrack`, `getRecentDays`, `validateDay`; `routes/vehicleTrackHandlers.js` (101)
- `services/pickupPoint.service.js` (1011) — `replacePickupPointStudents` (L572), `createPickupPointWithStudents` (L720), `getReadOnlyPickupMap` (L809); `pickupCleanup.service.js` (28)
- `services/eta.service.js` (247) `refreshForVehicle`; `geofence.service.js` (473) `checkForVehicle`, `notifyParentsForPickupPoint`; `routeDeviation.service.js` (432) `checkForVehicle`, `detectStalled`, `detectLate`
- `utils/gpsTrackingWindow.js` (97) — `isWithinTrackingWindow`, `configuredWindows` (env `GPS_TRACKING_WINDOWS`, ค่าเริ่มต้น 05:00-09:00,15:00-19:00)

## ข้อมูลที่รับผิดชอบ
- `pickup_points`, `student_pickup_points` — 016_pickup_points.sql
- `vehicle_latest_locations` — 017_vehicle_locations.sql
- `vehicle_location_history`, `geofences`, `geofence_events`, `route_baselines`, `route_deviations`, `eta_predictions` — 040_intelligent_tracking.sql (ดัชนีเพิ่ม 041_performance_indexes.sql)
- 021_emergency_gps.sql เกี่ยวกับ GPS ของเหตุฉุกเฉิน → [admin-ops.md](admin-ops.md)

## จุดเชื่อม
- `geofence.service` สร้างคิวแจ้งเตือนผู้ปกครอง/โรงเรียน → [line-parent.md](line-parent.md)
- ขอบเขตรถ (`vehicleScopeSql`) ใช้ร่วมกับ school/affiliation/province routers
- รถ/คนขับ ปัจจุบัน → [vehicles-drivers.md](vehicles-drivers.md); นโยบายความปลอดภัย `safetyPolicy.service` ถูกเรียกก่อน upsert (`driver.routes.js:1312`)

## กติกาสำคัญ
- ปฏิเสธพิกัดนอกช่วงเวลา tracking และ `recorded_at` ในอนาคต/เก่าเกิน — `driver.routes.js:1260-1300` (คำนวณ L1275-1300)
- hook ETA/geofence/deviation ห่อ try/catch ไม่บล็อกการเก็บพิกัด, รายงานผ่าน `tracking_health` — `driver.routes.js:1350-1384`
- รถนอก scope ตอบ 404 เหมือนไม่มีรถ (กันเดา id) และดูเส้นทางย้อนหลังถูก audit (VIEW, de-dup 5 นาที) — `vehicleTrackHandlers.js:8-17`
- ข้อมูลเส้นทางไม่มี PII นักเรียน/คนขับ, จำกัดวันย้อนหลังตาม `retentionDays()` — `vehicleTrackHandlers.js:30,55`
- แทนที่นักเรียนในจุดรับ ทำใน transaction + audit — `pickupPoint.service.js:582,625`; สร้างจุดพร้อมนักเรียนก็เช่นกัน L723,749
- แผนที่จุดรับเป็น aggregate read-only — `pickupPoint.service.js:809`
- ฝั่งโรงเรียน การเขียนจุดรับต้อง `requireFullSchoolScope` — `school.routes.js:381,441,514`; นักเรียนที่กำหนดต้องอยู่รถ/โรงเรียนเดียวกัน (`validateStudentsBelongToSchoolAndVehicle`, L660)

## การทดสอบ
DB-free: `cd backend && npx jest --config jest.unit.config.js --runInBand "(gpsTrackingWindow|gpsRecordedAtGuard|vehicleTrack|vehicleLocationPrivacy|pickupCleanup|pickupPointForeignSchoolHidden|routeLatency|refreshBaselinesTimezone|pruneLocationHistoryScript|safetyPolicy)"`
ต้องใช้ MySQL test DB (`npm run test:ci`): `vehicleTrack.test.js`, `pickupMapAggregate.test.js`, `adminPickupPointMap.test.js`. ไม่พบเทสต์เฉพาะ eta/geofence/routeDeviation service (ยังไม่ได้ตรวจเชิงลึก).

## ความเสี่ยงที่ทราบ
- `pickupPoint.service.js` 1011 บรรทัด
- hook ทั้งสามถูก `await` ภายใน request ส่งพิกัดตามลำดับ (`driver.routes.js:1357-1378`) — เวลาตอบกลับของ endpoint นี้บวกเวลาของทั้งสามเมื่อเปิด flag
- ตัวช่วย haversine ซ้ำในหลายไฟล์ (eta, geofence, routeDeviation, vehicleTrack)
