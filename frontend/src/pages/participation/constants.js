/**
 * Labels and the client's copy of the case state machine.
 *
 * WHY THE STATE MACHINE IS DUPLICATED HERE
 * The server is the authority: participation.service.js validates every append
 * and answers 409 with the allowed list when a transition is refused. This copy
 * exists only so the form can offer the events that will be accepted instead of
 * offering all nine and letting the user discover the rule by being refused.
 *
 * A duplicated rule drifts, so backend/tests/participationClientContract.unit.test.js
 * compares this file against the service and fails when they disagree. If that
 * test fails, the service is right and this file is what changes.
 */

export const CASE_TYPE_LABEL = {
  POLICY_PROPOSAL:  'ข้อเสนอเชิงนโยบาย',
  SERVICE_ISSUE:    'ปัญหาการให้บริการ',
  SAFETY_CONCERN:   'ข้อกังวลด้านความปลอดภัย',
  DATA_QUALITY:     'คุณภาพข้อมูล',
  RESOURCE_REQUEST: 'ขอทรัพยากรสนับสนุน',
  OTHER:            'อื่น ๆ',
};

export const STATUS_LABEL = {
  SUBMITTED:       { label: 'ยื่นเรื่องแล้ว',   variant: 'info' },
  ACKNOWLEDGED:    { label: 'รับเรื่องแล้ว',     variant: 'info' },
  IN_CONSULTATION: { label: 'อยู่ระหว่างหารือ',  variant: 'warn' },
  DECIDED:         { label: 'มีมติแล้ว',         variant: 'warn' },
  ASSIGNED:        { label: 'มอบหมายแล้ว',       variant: 'warn' },
  COMPLETED:       { label: 'ดำเนินการเสร็จ',    variant: 'success' },
  CLOSED:          { label: 'ปิดเรื่องแล้ว',     variant: 'neutral' },
  WITHDRAWN:       { label: 'ถอนเรื่อง',         variant: 'neutral' },
};

export const EVENT_LABEL = {
  SUBMITTED:     'ยื่นเรื่อง',
  ACKNOWLEDGED:  'รับเรื่อง',
  COMMENTED:     'ให้ความเห็น',
  CONSULTED:     'เปิดหารือ',
  DECIDED:       'บันทึกมติ',
  ASSIGNED:      'มอบหมายผู้รับผิดชอบ',
  COMPLETED:     'ดำเนินการเสร็จ',
  FEEDBACK_SENT: 'แจ้งผลกลับผู้เสนอ',
  WITHDRAWN:     'ถอนเรื่อง',
};

export const DECISION_LABEL = {
  APPROVED:         'เห็นชอบ',
  REJECTED:         'ไม่เห็นชอบ',
  DEFERRED:         'ชะลอไว้ก่อน',
  NO_ACTION_NEEDED: 'ไม่ต้องดำเนินการ',
};

export const SCOPE_TYPE_LABEL = {
  SCHOOL:      'โรงเรียน',
  AFFILIATION: 'สังกัด',
  PROVINCE:    'จังหวัด',
  TRANSPORT:   'ขนส่ง',
};

export const ROLE_LABEL = {
  driver: 'คนขับรถ', school: 'โรงเรียน', affiliation: 'สังกัด',
  province: 'จังหวัด', transport: 'ขนส่ง', admin: 'ผู้ดูแลระบบ', parent: 'ผู้ปกครอง',
};

/** Mirror of ALLOWED_EVENTS in participation.service.js. */
export const ALLOWED_EVENTS = {
  SUBMITTED:       ['ACKNOWLEDGED', 'COMMENTED', 'CONSULTED', 'DECIDED', 'WITHDRAWN'],
  ACKNOWLEDGED:    ['COMMENTED', 'CONSULTED', 'DECIDED', 'ASSIGNED', 'WITHDRAWN'],
  IN_CONSULTATION: ['COMMENTED', 'CONSULTED', 'DECIDED', 'WITHDRAWN'],
  DECIDED:         ['COMMENTED', 'CONSULTED', 'ASSIGNED', 'COMPLETED', 'WITHDRAWN'],
  ASSIGNED:        ['COMMENTED', 'CONSULTED', 'COMPLETED', 'WITHDRAWN'],
  COMPLETED:       ['COMMENTED', 'FEEDBACK_SENT'],
  CLOSED:          [],
  WITHDRAWN:       [],
};

/** Field limits, mirrored from the service so the form can count before sending. */
export const LIMITS = { SUBJECT: 200, BODY: 5000, NOTE: 2000, EVIDENCE_REF: 200 };

/** Events the service refuses without a note. */
export const NOTE_REQUIRED = ['DECIDED', 'FEEDBACK_SENT'];

export const fmtDateTime = (value) => (value
  ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
  : '—');
