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

module.exports = { VERSION, APPROVED, LEGAL_REVIEW, ROLE_TOPICS, noticesForRole };
