'use strict';

// Draft operational copy only. A responsible controller and legal reviewer must
// approve the full notice, contact channel, lawful basis and retention period
// before any entry is marked approved. Acknowledgement is never consent.
const VERSION = 'meeting-pilot-20261021';
// The owner approved real production use for the 21 Oct 2026 working-group
// meeting. Operational actions remain real and retain their existing audit.
// Until the committee supplies the missing legal facts, meeting mode does not
// create legal acknowledgement evidence or present itself as a final notice.
const REVIEW_MODE = true;
const LEGAL_REVIEW = Object.freeze({
  approved: false,
  approvalReference: '',
  controllerName: '',
  contactChannel: '',
  fullNoticeUrl: '',
});

const TOPICS = Object.freeze({
  common: {
    title: 'การใช้ข้อมูลในระบบรถรับส่งนักเรียน',
    summary: 'ระบบแสดงข้อมูลตามหน้าที่ของบัญชีนี้ เพื่อจัดการรถรับส่งและความปลอดภัยของนักเรียน',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: ระบบใช้ข้อมูลตามบทบาทและขอบเขตที่บัญชีได้รับ เพื่อสนับสนุนการรับส่งและความปลอดภัย การดูหรือแก้ไขข้อมูลต้องเป็นไปตามหน้าที่และถูกบันทึกตรวจสอบ รายละเอียดผู้ควบคุมข้อมูล ช่องทางใช้สิทธิ์ ผู้รับข้อมูล และระยะเก็บเป็นหัวข้อที่คณะทำงานต้องพิจารณา',
    lawfulBasis: '',
    retentionRule: '',
  },
  school: {
    title: 'ข้อมูลนักเรียนและการเช็กชื่อ',
    summary: 'ตรวจสอบข้อมูลก่อนบันทึกหรือส่งออก และใช้เฉพาะนักเรียนในขอบเขตที่ได้รับมอบหมาย',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: โรงเรียนใช้ข้อมูลนักเรียน ผู้ปกครอง รถ และการเช็กชื่อเพื่อจัดบริการรับส่ง ตรวจความครบถ้วน และติดตามความปลอดภัย เจ้าหน้าที่ต้องใช้เฉพาะโรงเรียนหรือชั้นเรียนที่ได้รับมอบหมาย และตรวจความถูกต้องก่อนบันทึกหรือส่งออก',
    lawfulBasis: '',
    retentionRule: '',
  },
  school_import: {
    title: 'รับรองก่อนนำเข้าข้อมูลนักเรียน',
    summary: 'ตรวจจำนวนรายการ แหล่งที่มาของข้อมูล รายการที่แก้ผู้ปกครอง และรถที่จะสร้างก่อนบันทึกชุดนำเข้า',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: ก่อนนำเข้า โปรดตรวจจำนวนรายการ แหล่งที่มา รายการแก้ผู้ปกครอง รถที่จะสร้าง และข้อผิดพลาด การรับรองนี้ยืนยันการตรวจชุดงาน ไม่ใช่การให้ความยินยอมแทนนักเรียนหรือผู้ปกครอง',
    lawfulBasis: '',
    retentionRule: '',
  },
  driver: {
    title: 'รายชื่อผู้โดยสารและเหตุฉุกเฉิน',
    summary: 'ใช้รายชื่อและข้อมูลการเดินทางเฉพาะรอบรถที่รับผิดชอบ และแจ้งเหตุผ่านช่องทางของระบบ',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: คนขับใช้รายชื่อนักเรียนและข้อมูลการเดินทางเฉพาะรถหรือรอบที่ได้รับมอบหมาย ใช้การเช็กชื่อและข้อมูลตำแหน่งเท่าที่จำเป็นต่อการปฏิบัติงาน และต้องคงช่องทางแจ้งเหตุฉุกเฉินไว้เสมอ',
    lawfulBasis: '',
    retentionRule: '',
  },
  driver_shift: {
    title: 'รับรองก่อนเริ่มรอบรถ',
    summary: 'ตรวจรถที่ได้รับมอบหมาย รอบเช้าหรือเย็น และหน้าที่ของคนขับก่อนเริ่มปฏิบัติงาน',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: ก่อนเริ่มรอบ โปรดตรวจรถที่ได้รับอนุญาต รอบเช้าหรือเย็น และความพร้อมตามขั้นตอนความปลอดภัย การรับรองนี้ผูกกับรถและรอบที่เลือก และไม่แทนการตรวจสภาพรถหรือคุณสมบัติคนขับ',
    lawfulBasis: '',
    retentionRule: '',
  },
  transport: {
    title: 'ข้อมูลรถและผลการตรวจ',
    summary: 'ตรวจและส่งออกเฉพาะข้อมูลรถกับผลตรวจตามสิทธิ์ ไม่รวมข้อมูลนักเรียนหรือเบอร์โทร',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: เจ้าหน้าที่ขนส่งใช้ข้อมูลรถ คนขับ เอกสาร และผลตรวจเพื่อกำกับความปลอดภัยตามขอบเขตจังหวัด การดู แก้ไข รับรอง และส่งออกต้องผ่านสิทธิ์ฝั่งเซิร์ฟเวอร์และมี audit โดยไม่เปิดเผยข้อมูลนักเรียนหรือเบอร์โทรในรายงานรถ',
    lawfulBasis: '',
    retentionRule: '',
  },
  transport_inspection: {
    title: 'รับรองผลตรวจรถ',
    summary: 'ตรวจทะเบียนรถ วันที่ตรวจ ผลตรวจ วันหมดอายุ และหลักฐานประกอบก่อนบันทึกหรือแก้ไขผลตรวจ',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: โปรดตรวจทะเบียนรถ วันที่ตรวจ ผลตรวจ วันหมดอายุ และหลักฐานที่เกี่ยวข้องก่อนบันทึกหรือแก้ไข การรับรองนี้เป็นหลักฐานว่าตรวจรายการดังกล่าว ไม่ใช่การรับรองความพร้อมใช้แทนหน่วยงานผู้มีอำนาจ',
    lawfulBasis: '',
    retentionRule: '',
  },
  transport_export: {
    title: 'ขอบเขตรายงานรถก่อนส่งออก',
    summary: 'รายงานนี้มีเฉพาะข้อมูลรถและผลตรวจ ห้ามนำไปใช้เพื่อค้นหาหรือเปิดเผยข้อมูลนักเรียนและเบอร์โทร',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: รายงานสำหรับขนส่งมีเฉพาะข้อมูลรถและผลตรวจตามสิทธิ์ ไม่รวมรายชื่อนักเรียนหรือเบอร์โทร โปรดตรวจวัตถุประสงค์และผู้รับไฟล์ก่อนนำออกจากระบบ',
    lawfulBasis: '',
    retentionRule: '',
  },
  report_export: {
    title: 'ตรวจขอบเขตก่อนส่งออกรายงาน',
    summary: 'ตรวจช่วงข้อมูล รูปแบบไฟล์ และขอบเขตตามบทบาทก่อนนำรายงานออกจากระบบ',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: ก่อนดาวน์โหลด โปรดตรวจช่วงข้อมูล รูปแบบไฟล์ ขอบเขตตามบทบาท และผู้ที่จะได้รับไฟล์ รายงานบางรูปแบบอาจมีข้อมูลระดับนักเรียนตามสิทธิ์เดิม จึงต้องเก็บและส่งต่อผ่านช่องทางที่หน่วยงานอนุมัติ',
    lawfulBasis: '',
    retentionRule: '',
  },
  affiliation: {
    title: 'การติดตามโรงเรียนในสังกัด',
    summary: 'ใช้ข้อมูลเฉพาะโรงเรียนในสังกัดและตรวจความถูกต้องก่อนจัดทำรายงาน',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: สังกัดใช้ข้อมูลเฉพาะโรงเรียนในขอบเขตของตนเพื่อติดตามความครบถ้วนและภาพรวม การเปิดดูหรือส่งออกรายงานต้องไม่ขยายไปยังโรงเรียนต่างสังกัด และต้องแสดงข้อยกเว้นของข้อมูลตามจริง',
    lawfulBasis: '',
    retentionRule: '',
  },
  province: {
    title: 'ภาพรวมระดับจังหวัด',
    summary: 'ใช้ข้อมูลภาพรวมตามหน้าที่และตรวจขอบเขตก่อนเผยแพร่รายงาน',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: จังหวัดใช้ข้อมูลภาพรวมตามหน้าที่เพื่อกำกับ ติดตาม และจัดทำรายงาน การเผยแพร่หรือส่งต่อควรระบุช่วงเวลา ขอบเขต ผู้รับ และข้อจำกัดของข้อมูลอย่างชัดเจน',
    lawfulBasis: '',
    retentionRule: '',
  },
  admin: {
    title: 'การดูแลระบบและหลักฐานการใช้งาน',
    summary: 'เข้าถึงข้อมูลเท่าที่จำเป็นต่อการดูแลระบบ ตรวจสอบเหตุ และจัดการสิทธิ์',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: ผู้ดูแลระบบเข้าถึงบัญชี สิทธิ์ audit ข้อมูลเหตุขัดข้อง และเครื่องมือกู้ระบบเท่าที่จำเป็น ทุกการเปิดหรือส่งออกข้อมูลสำคัญต้องมีเหตุผล สิทธิ์ และหลักฐานตรวจสอบ โดยไม่ใช้สิทธิ์ผู้ดูแลแทนสิทธิ์ของเจ้าของข้อมูล',
    lawfulBasis: '',
    retentionRule: '',
  },
  admin_research_export: {
    title: 'ตรวจขอบเขตก่อนส่งออกชุดข้อมูลวิจัย',
    summary: 'ตรวจช่วงวันที่ ชุดข้อมูล รูปแบบไฟล์ และข้อจำกัดการนำผลไปใช้ก่อนดาวน์โหลด',
    body: 'ฉบับใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: ก่อนดาวน์โหลดชุดข้อมูลวิจัย โปรดตรวจช่วงวันที่ ชุดข้อมูล รูปแบบไฟล์ ความพร้อมของหลักฐาน และข้อจำกัดการอ้างผล ข้อมูลที่ส่งออกต้องใช้ตามวัตถุประสงค์ที่หน่วยงานอนุมัติและไม่ตีความเกินขอบเขตของหลักฐาน',
    lawfulBasis: '',
    retentionRule: '',
  },
});

const ROLE_TOPICS = Object.freeze({
  school: ['common', 'school'],
  driver: ['common', 'driver'],
  transport: ['common', 'transport'],
  affiliation: ['common', 'affiliation'],
  province: ['common', 'province'],
  admin: ['common', 'admin'],
});

// Action notices are intentionally separate from the first-use notice. They
// are shown at the point where a user is about to make a consequential record
// or export. A certification/warning is evidence about that action; it is not
// consent and never widens the caller's RBAC scope.
const ACTION_POLICIES = Object.freeze({
  'school.student_import_apply': Object.freeze({
    topic: 'school_import', roles: ['school', 'admin'], kind: 'certification',
    subjectType: 'import_batch',
  }),
  'transport.inspection_create': Object.freeze({
    topic: 'transport_inspection', roles: ['transport', 'admin'], kind: 'certification',
    subjectType: 'vehicle',
  }),
  'transport.inspection_update': Object.freeze({
    topic: 'transport_inspection', roles: ['transport', 'admin'], kind: 'certification',
    subjectType: 'vehicle_inspection',
  }),
  'transport.vehicle_export': Object.freeze({
    topic: 'transport_export', roles: ['transport', 'admin'], kind: 'warning',
    subjectType: 'transport_safety_report',
  }),
  'driver.shift_start': Object.freeze({
    topic: 'driver_shift', roles: ['driver'], kind: 'certification',
    subjectType: 'vehicle',
  }),
  'report.export': Object.freeze({
    topic: 'report_export', roles: ['school', 'affiliation', 'province', 'admin'], kind: 'warning',
    subjectType: 'report_export',
  }),
  'admin.research_export': Object.freeze({
    topic: 'admin_research_export', roles: ['admin'], kind: 'warning',
    subjectType: 'research_export',
  }),
});

// Fail closed, including when somebody sets a runtime flag before legal review.
const APPROVED = LEGAL_REVIEW.approved
  && !!LEGAL_REVIEW.approvalReference
  && !!LEGAL_REVIEW.controllerName
  && !!LEGAL_REVIEW.contactChannel
  && /^https:\/\//.test(LEGAL_REVIEW.fullNoticeUrl)
  && Object.values(TOPICS).every((topic) =>
    topic.body.length >= 100 && !!topic.lawfulBasis && !!topic.retentionRule
  );

function noticesForRole(role) {
  return (ROLE_TOPICS[role] || []).map((key) => ({
    key,
    version: VERSION,
    title: TOPICS[key].title,
    summary: TOPICS[key].summary,
    body: TOPICS[key].body,
    lawfulBasis: TOPICS[key].lawfulBasis,
    retentionRule: TOPICS[key].retentionRule,
    fullNoticeUrl: LEGAL_REVIEW.fullNoticeUrl,
    kind: 'notice',
  }));
}

function actionPolicyForRole(role, context) {
  const policy = ACTION_POLICIES[context];
  if (!policy || !policy.roles.includes(role)) return null;
  const topic = TOPICS[policy.topic];
  return {
    context,
    key: policy.topic,
    version: VERSION,
    kind: policy.kind,
    subjectType: policy.subjectType,
    title: topic.title,
    summary: topic.summary,
    body: topic.body,
    lawfulBasis: topic.lawfulBasis,
    retentionRule: topic.retentionRule,
    fullNoticeUrl: LEGAL_REVIEW.fullNoticeUrl,
  };
}

function catalogForRole(role) {
  const session = noticesForRole(role).map((notice) => ({ ...notice, contexts: ['first_use'] }));
  const byKey = new Map(session.map((notice) => [notice.key, notice]));
  for (const context of Object.keys(ACTION_POLICIES)) {
    const action = actionPolicyForRole(role, context);
    if (!action) continue;
    const existing = byKey.get(action.key);
    if (existing) existing.contexts.push(context);
    else byKey.set(action.key, { ...action, contexts: [context] });
  }
  return [...byKey.values()];
}

module.exports = {
  VERSION, APPROVED, REVIEW_MODE, LEGAL_REVIEW, ROLE_TOPICS, ACTION_POLICIES,
  noticesForRole, actionPolicyForRole, catalogForRole,
};
