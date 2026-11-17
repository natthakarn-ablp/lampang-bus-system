# รุ่น 2.2.0 — งานค้างและความช่วยเหลือ (18 พฤศจิกายน 2569)

## สิ่งที่เผยแพร่ในรุ่นนี้
- หน้าตรวจรถตรวจสถานะก่อนแสดงปุ่มบันทึก หากรถไม่ชัดเจน/เครือข่าย/ระบบล้มเหลว ให้แจ้งตั้งแต่เปิดหน้า พร้อมชื่อผู้ใช้ วิธีแจ้งปัญหาและลองใหม่ ไม่มีการข้ามด่านตรวจรถหรือเลือกคันใดเอง
- ประวัติอัปเดต /updates และวิธีแจ้งปัญหา /help เป็นข้อมูลสาธารณะ ไม่มีข้อมูลเด็ก บัญชีจริง รหัสผ่าน หรือช่องทางติดต่อที่เดาเพิ่ม เลขรุ่นกดเข้าประวัติได้ เมนูบัญชีมีทางเข้า
- หน้านโยบายเอาข้อความประชุมเก่าออกและแยกข้อมูลที่ยังรอหน่วยงานยืนยัน คง REVIEW/APPROVED gate เดิม ไม่มีการบันทึกยินยอมจากร่างหรือเปลี่ยน migration052/053
- หน้าเกิดข้อผิดพลาดแยก UI-ASSET-LOAD กับ UI-UNEXPECTED ไม่รีเฟรชอัตโนมัติ/ไม่ล้างฟอร์มหรือstorage มีคำเตือนข้อมูลที่ยังไม่บันทึกและเลขรุ่น ช่วยวินิจฉัยโดยไม่บันทึก raw URL/token ใน handler
- ป้องกัน driver บันทึกลาในรอบวันนี้ที่นักเรียนไม่ใช้รถหรือมีการเช็กชื่อแล้ว โดยคง transaction/locks/grade/full-day/SELF guards เดิม
- globalTeardown ใช้ guarded test DB helper ซึ่งตั้ง SQL session +07:00 ให้ตรงกับแอปและsetup ไม่เปิด connection ที่ข้าม timezone อีก

## ทบทวน PR ค้าง
| PR | หลักฐานและการจัดการ |
|---|---|
| 3 | PRเก่าbase mainขัดแย้งกับปัจจุบัน แอป/helper/setupมีเขตเวลาไทยและdisposable-DB guardแล้ว แต่teardownยังเปิดconnectionตรง จึงportส่วนที่ยังขาดให้ใช้helperเดิม เก็บtestDatabaseTimezone fixed-boundary integrationเป็นหลักฐาน แก้ตามรุ่นdeploy feat ไม่mergeโค้ดเก่าทับmainหรือยกเลิกguard เอกสารlaunchเก่ามีป้ายhistoricalอยู่แล้ว |
| 70 | นำcandidate snippet/runbookสองไฟล์มาเก็บครบ ไม่มีruntime nginx change: GETสาธารณะก่อนreleaseพบstatic /,/login,/manual/ ยังไม่มี4headers ส่วนAPIมีHelmetแล้ว S10ยังต้องoperator review/full nginx -T/backup/syntax/bounded rollback/LIFF-fonts-maps testingตามrunbook ห้ามอ้างว่าactivateแล้ว |
| 117 | backend issuing_school_id/defaultโรงเรียนผู้ใช้รถมากที่สุดและfrontendpickerมีอยู่แล้ว ตรวจrouteส่งparameterจริง เพิ่ม regressionจากPR117 (3/3pass) ไม่cherry-pickpatchเก่าทับงานใหม่ |
| 122 | guardฝั่งdriverยังขาดจริง portให้ตรวจtoday session-enabled/latest noncancelled check-inภายใต้student lockเดิม พร้อม regression3/3pass |
| 152 | นำเอกสารสองไฟล์มาเก็บเป็นhistorical snapshot พร้อมป้ายเตือน ไม่ใช่สถานะปัจจุบันหรือสิทธิ์ให้runงานในข้อความ |

PRเก่าที่ถูกแทนจะปิดหลังrelease PRใหม่merge/CIผ่านโดยไม่ลบbranch การปิดPR70หมายถึงcandidate sourceถูกรวมแล้ว ไม่ใช่S10runtimeเสร็จ

## Gate และ navigation
ดู nav-reconciliation-2569-11-18.md: baselineเก่าตามไม่ทันรุ่นที่deployแล้ว Reconcile114existingroutes/110menus +2publicroutes =116routes/110menus ไม่มีroute/menuเก่าหายหรือเพิ่มสิทธิ์API ไม่ลดgateหรือPartialratchet

## การทดสอบและเผยแพร่
Synthetic browser: pretrip400/500ต้องไม่มีปุ่มบันทึก, retryแล้วบันทึกครั้งเดียว, publichistory/helpทุกบริบท, policydraftไม่มีPOSTack, ErrorBoundaryไม่reloadเอง; role announcementและattendance regressionเดิม;6captureใหม่มีmetrics0 และintentionalHTTP500แยกจากnetwork errors
Focused backend20testsผ่านก่อนcommit FullLinuxCI/strictgates/fullruntime/secret scanและexactmergepushCIต้องผ่านก่อน guardeddeploy scripts/deploy-backend.sh บนfeatแบบfast-forward สำรอง/verifyDBก่อน deploy เก็บbackendrollbackrefและfrontenddist.prev ไม่มีmigrationใหม่หรือproductionข้อมูลเด็ก/รหัส/LINE test writes

## สิ่งที่ยังต้องยืนยัน ไม่ได้ทำโดยเดา
- ชื่อผู้ใช้จริงของภาพผูกรถหลายคัน: บัญชีที่ตรวจตามคำบอกก่อนหน้าไม่มีซ้ำ จึงไม่ตัด/ย้ายการมอบหมายจริง
- ผู้ควบคุมข้อมูล ฐานการใช้ข้อมูล ระยะเวลาเก็บ ช่องทางใช้สิทธิ ต้องมีข้อมูลที่หน่วยงานอนุมัติ จึงคงร่างและยังไม่เปิดlegal acknowledgement
- S10runtimeและการทดสอบLIFF/รายงานความปลอดภัยยังรอoperator/test environmentตามข้อจำกัดเดิม ไม่เปิดcollectorหรือenforcedCSP/HSTSในรุ่นนี้
- สาเหตุหน้าerrorเดิมที่หายหลังrefreshยังไม่ยืนยัน ไม่อ้างว่าแก้root causeแล้วจากการเพิ่มรหัสวินิจฉัย
