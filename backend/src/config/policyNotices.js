'use strict';

// Draft operational copy only. A responsible controller and legal reviewer must
// approve the full notice, contact channel, lawful basis and retention period
// before any entry is marked approved. Acknowledgement is never consent.
const VERSION = 'draft-20261018';
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
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  school: {
    title: 'ข้อมูลนักเรียนและการเช็กชื่อ',
    summary: 'ตรวจสอบข้อมูลก่อนบันทึกหรือส่งออก และใช้เฉพาะนักเรียนในขอบเขตที่ได้รับมอบหมาย',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  school_import: {
    title: 'รับรองก่อนนำเข้าข้อมูลนักเรียน',
    summary: 'ตรวจจำนวนรายการ แหล่งที่มาของข้อมูล รายการที่แก้ผู้ปกครอง และรถที่จะสร้างก่อนบันทึกชุดนำเข้า',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  driver: {
    title: 'รายชื่อผู้โดยสารและเหตุฉุกเฉิน',
    summary: 'ใช้รายชื่อและข้อมูลการเดินทางเฉพาะรอบรถที่รับผิดชอบ และแจ้งเหตุผ่านช่องทางของระบบ',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  transport: {
    title: 'ข้อมูลรถและผลการตรวจ',
    summary: 'ตรวจและส่งออกเฉพาะข้อมูลรถกับผลตรวจตามสิทธิ์ ไม่รวมข้อมูลนักเรียนหรือเบอร์โทร',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  transport_inspection: {
    title: 'รับรองผลตรวจรถ',
    summary: 'ตรวจทะเบียนรถ วันที่ตรวจ ผลตรวจ วันหมดอายุ และหลักฐานประกอบก่อนบันทึกหรือแก้ไขผลตรวจ',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  transport_export: {
    title: 'ขอบเขตรายงานรถก่อนส่งออก',
    summary: 'รายงานนี้มีเฉพาะข้อมูลรถและผลตรวจ ห้ามนำไปใช้เพื่อค้นหาหรือเปิดเผยข้อมูลนักเรียนและเบอร์โทร',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  affiliation: {
    title: 'การติดตามโรงเรียนในสังกัด',
    summary: 'ใช้ข้อมูลเฉพาะโรงเรียนในสังกัดและตรวจความถูกต้องก่อนจัดทำรายงาน',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  province: {
    title: 'ภาพรวมระดับจังหวัด',
    summary: 'ใช้ข้อมูลภาพรวมตามหน้าที่และตรวจขอบเขตก่อนเผยแพร่รายงาน',
    body: '',
    lawfulBasis: '',
    retentionRule: '',
  },
  admin: {
    title: 'การดูแลระบบและหลักฐานการใช้งาน',
    summary: 'เข้าถึงข้อมูลเท่าที่จำเป็นต่อการดูแลระบบ ตรวจสอบเหตุ และจัดการสิทธิ์',
    body: '',
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
  VERSION, APPROVED, LEGAL_REVIEW, ROLE_TOPICS, ACTION_POLICIES,
  noticesForRole, actionPolicyForRole, catalogForRole,
};
