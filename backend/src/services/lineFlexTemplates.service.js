'use strict';

const { formatGradeClass } = require('../utils/gradeDisplay');

/**
 * lineFlexTemplates.service.js — Phase 10.3E-HF4.2
 *
 * Unified Flex Message design system for parent-facing LINE OA replies.
 * Every parent-side bubble shares the same visual language: tonal header,
 * icon, body rows, optional example chip, optional separator-divided
 * children summary, footer with action hints.
 *
 * Tones (one per audience signal):
 *   info     — blue   — instructions, prompts, help
 *   success  — green  — bind success, unlink success
 *   warning  — amber  — validation errors, "already linked", confirmations
 *   error    — red    — backend rejections, system errors
 *   neutral  — gray   — cancellations, "no pending command"
 *
 * Privacy rules (audited per card):
 *   • Never display: LINE userId, parent_id, student.id, raw token, full
 *     phone number (mask via maskPhone()).
 *   • Vehicle plate / driver name / child name are OK — parents already
 *     own that data.
 *
 * Builders return a complete LINE Flex message object (with altText).
 * Callers push via pushParentFlex() in line.service.js, which carries the
 * plain-text fallback for delivery failure.
 */

const BUBBLE_SIZE = 'mega';

const TONE = {
  info: {
    header: '#2563EB',
    subText: '#DBEAFE',
    accent:  '#1D4ED8',
    softBg:  '#EFF6FF',
    softBorder: '#BFDBFE',
    icon:    'ℹ️',
  },
  success: {
    header: '#059669',
    subText: '#A7F3D0',
    accent:  '#047857',
    softBg:  '#ECFDF5',
    softBorder: '#A7F3D0',
    icon:    '✅',
  },
  warning: {
    header: '#D97706',
    subText: '#FED7AA',
    accent:  '#92400E',
    softBg:  '#FEF3C7',
    softBorder: '#FCD34D',
    icon:    '⚠️',
  },
  error: {
    header: '#DC2626',
    subText: '#FECACA',
    accent:  '#991B1B',
    softBg:  '#FEE2E2',
    softBorder: '#FCA5A5',
    icon:    '❌',
  },
  neutral: {
    header: '#4B5563',
    subText: '#E5E7EB',
    accent:  '#374151',
    softBg:  '#F3F4F6',
    softBorder: '#D1D5DB',
    icon:    '📋',
  },
};

// ─── Small utilities ────────────────────────────────────────────────────────

function formatTHTimestamp(ts) {
  const d = ts instanceof Date ? ts : new Date(ts || Date.now());
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

function maskPhone(phone) {
  if (!phone) return '-';
  const s = String(phone).replace(/\D/g, '');
  if (s.length < 5) return s;
  return s.slice(0, 3) + '****' + s.slice(-3);
}

// ─── Body component builders ────────────────────────────────────────────────
// Each returns a Flex content node ready for embedding in body.contents[].

function textRow(text, opts = {}) {
  return {
    type: 'text',
    text,
    size:   opts.size   || 'sm',
    color:  opts.color  || '#374151',
    weight: opts.weight || 'regular',
    wrap:   opts.wrap !== false,
    margin: opts.margin || 'none',
    align:  opts.align  || 'start',
  };
}

function sectionTitle(text, tone) {
  return textRow(text, { size: 'sm', color: tone.accent, weight: 'bold', margin: 'md' });
}

function softBox(contents, tone, opts = {}) {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: opts.spacing || 'xs',
    backgroundColor: tone.softBg,
    borderColor: tone.softBorder,
    borderWidth: '1px',
    cornerRadius: '10px',
    paddingTop: '12px', paddingBottom: '12px',
    paddingStart: '14px', paddingEnd: '14px',
    margin: opts.margin || 'md',
    contents,
  };
}

function exampleChip(text) {
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    borderWidth: '1px',
    cornerRadius: '6px',
    paddingTop: '8px', paddingBottom: '8px',
    paddingStart: '12px', paddingEnd: '12px',
    margin: 'sm',
    contents: [
      { type: 'text', text: 'ตัวอย่าง:', size: 'xs', color: '#6B7280', flex: 0 },
      { type: 'text', text, size: 'sm', color: '#111827', weight: 'bold', align: 'end', flex: 1 },
    ],
  };
}

function separator(margin = 'md') {
  return { type: 'separator', margin, color: '#E5E7EB' };
}

function childBullet(child) {
  const name = `${child.prefix || ''}${child.first_name} ${child.last_name}`.trim();
  const meta = [
    formatGradeClass(child.grade, child.classroom, ''),
    child.school_name,
  ].filter(Boolean).join(' · ');
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'sm',
    contents: [
      { type: 'text', text: '👦 ' + name, size: 'sm', color: '#111827', weight: 'bold', wrap: true },
      ...(meta ? [{ type: 'text', text: meta, size: 'xs', color: '#6B7280', wrap: true }] : []),
    ],
  };
}

// ─── Core bubble shell ──────────────────────────────────────────────────────

function buildParentCard({ tone: toneName, icon, title, subtitle, bodyContents, footerLines = [] }) {
  const tone = TONE[toneName] || TONE.info;
  const headerIcon = icon || tone.icon;

  const footer = footerLines.length
    ? {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        paddingTop: '0px',
        paddingBottom: '14px',
        paddingStart: '16px',
        paddingEnd: '16px',
        contents: [
          separator(),
          ...footerLines.map((line, idx) =>
            textRow(line, {
              size: 'xxs',
              color: idx === 0 ? '#374151' : '#9CA3AF',
              weight: idx === 0 ? 'bold' : 'regular',
              align: 'center',
              margin: idx === 0 ? 'md' : 'xs',
            })
          ),
        ],
      }
    : undefined;

  const bubble = {
    type: 'bubble',
    size: BUBBLE_SIZE,
    header: {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: tone.header,
      paddingTop: '18px',
      paddingBottom: '18px',
      paddingStart: '18px',
      paddingEnd: '18px',
      spacing: 'lg',
      contents: [
        { type: 'text', text: headerIcon, size: '3xl', flex: 0, gravity: 'center' },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          spacing: 'xs',
          contents: [
            { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'xl', wrap: true },
            ...(subtitle
              ? [{ type: 'text', text: subtitle, color: tone.subText, size: 'xs', weight: 'regular', wrap: true }]
              : []),
          ],
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingTop: '18px',
      paddingBottom: '14px',
      paddingStart: '16px',
      paddingEnd: '16px',
      contents: bodyContents,
    },
  };
  if (footer) bubble.footer = footer;

  return {
    type: 'flex',
    altText: `${headerIcon} ${title}`.slice(0, 400),
    contents: bubble,
  };
}

// ─── Named cards (one per UX state) ─────────────────────────────────────────

function buildParentRequestPhoneCard(opts = {}) {
  // Phase 10.3E-UX1 — primary CTA is now a LIFF-form button. The text-input
  // path stays as a fallback for clients that can't open LIFF (rare, but
  // possible on desktop LINE webview or stripped-down clients).
  const tone = TONE.info;
  const { liffId } = opts;
  // Append "/link" path so LINE rewrites the redirect from the LIFF
  // endpoint URL (which currently lands on the status page) to the new
  // bind page (/parent/link). This keeps the existing ParentStatus LIFF
  // working without changing the LINE Developer Console endpoint.
  const liffUri = liffId ? `https://liff.line.me/${liffId}/link` : null;

  const body = [
    textRow('เลือกวิธีที่สะดวก', { size: 'sm', color: '#374151', weight: 'bold', margin: 'none' }),
  ];

  if (liffUri) {
    body.push(textRow('แนะนำ: กดปุ่มด้านล่างเพื่อกรอกข้อมูลผ่านฟอร์ม', { size: 'xs', color: '#6B7280', margin: 'sm' }));
    body.push({
      type: 'button',
      style: 'primary',
      color: tone.header,
      height: 'md',
      margin: 'md',
      action: { type: 'uri', label: '📝 เปิดฟอร์มผูกบัญชี', uri: liffUri },
    });
    body.push(separator('lg'));
    body.push(textRow('หรือพิมพ์ข้อมูลในแชต', { size: 'xs', color: '#9CA3AF', weight: 'bold', margin: 'md' }));
  }

  body.push(sectionTitle('ขั้นตอนที่ 1', tone));
  body.push(textRow('พิมพ์เบอร์โทรศัพท์ 10 หลักที่ลงทะเบียนไว้กับโรงเรียน', { color: '#111827' }));
  body.push(exampleChip('0901234567'));

  return buildParentCard({
    tone: 'info',
    icon: '🔗',
    title: 'ผูกบัญชีผู้ปกครอง',
    subtitle: 'เชื่อมต่อบัญชี LINE กับข้อมูลบุตรหลาน',
    bodyContents: body,
    footerLines: ['พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้'],
  });
}

function buildParentRequestStudentCard() {
  const tone = TONE.info;
  return buildParentCard({
    tone: 'info',
    icon: '🎓',
    title: 'ยืนยันข้อมูลบุตรหลาน',
    subtitle: 'ตรวจพบข้อมูลเบอร์โทรศัพท์แล้ว',
    bodyContents: [
      sectionTitle('ขั้นตอนที่ 2', tone),
      textRow('กรุณาพิมพ์รหัสนักเรียนของบุตรหลาน (ตัวเลข)', { color: '#111827' }),
      exampleChip('18985'),
    ],
    footerLines: ['พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้'],
  });
}

function buildParentInvalidPhoneCard() {
  return buildParentCard({
    tone: 'warning',
    title: 'เบอร์โทรไม่ถูกต้อง',
    subtitle: 'กรุณาตรวจสอบและลองอีกครั้ง',
    bodyContents: [
      textRow('กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักที่ลงทะเบียนไว้กับโรงเรียน', { color: '#111827' }),
      exampleChip('0901234567'),
    ],
    footerLines: ['พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้'],
  });
}

function buildParentInvalidStudentCard() {
  return buildParentCard({
    tone: 'warning',
    title: 'รหัสนักเรียนไม่ถูกต้อง',
    subtitle: 'กรุณาพิมพ์เป็นตัวเลขเท่านั้น',
    bodyContents: [
      textRow('โปรดตรวจสอบรหัสนักเรียนของบุตรหลานจากเอกสารโรงเรียน', { color: '#111827' }),
      exampleChip('18985'),
    ],
    footerLines: ['พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้'],
  });
}

function buildParentBindSuccessCard(children = []) {
  const childContents = [];
  if (children.length > 0) {
    childContents.push(sectionTitle('บุตรหลานที่ผูกแล้ว', TONE.success));
    children.slice(0, 3).forEach((c) => childContents.push(childBullet(c)));
    if (children.length > 3) {
      childContents.push(textRow(`และอีก ${children.length - 3} คน`, { size: 'xs', color: '#6B7280', margin: 'xs' }));
    }
  }
  return buildParentCard({
    tone: 'success',
    title: 'ผูกบัญชีสำเร็จ',
    subtitle: 'เริ่มใช้งานระบบรถรับส่งนักเรียนได้แล้ว',
    bodyContents: [
      textRow('คุณจะได้รับแจ้งเตือนเมื่อบุตรหลานขึ้น-ลงรถ', { color: '#111827' }),
      ...childContents,
      separator('lg'),
      textRow('คำสั่งที่ใช้บ่อย', { size: 'xs', color: TONE.success.accent, weight: 'bold', margin: 'md' }),
      textRow('• "สถานะ" — ดูสถานะรับ-ส่งวันนี้', { size: 'xs', color: '#374151' }),
      textRow('• "ข้อมูลบุตร" — ดูข้อมูลบุตรหลาน', { size: 'xs', color: '#374151' }),
    ],
    footerLines: ['ระบบรถรับส่งนักเรียนจังหวัดลำปาง'],
  });
}

function buildParentBindErrorCard(reason) {
  return buildParentCard({
    tone: 'error',
    title: 'ไม่สามารถผูกบัญชีได้',
    subtitle: 'ตรวจสอบข้อมูลและลองอีกครั้ง',
    bodyContents: [
      textRow(reason || 'ไม่พบข้อมูลที่ตรงกับเบอร์โทรศัพท์หรือรหัสนักเรียน', { color: '#111827' }),
      softBox([
        textRow('สาเหตุที่พบบ่อย', { size: 'xs', color: TONE.error.accent, weight: 'bold' }),
        textRow('• เบอร์โทรศัพท์ไม่ตรงกับที่ลงทะเบียนไว้', { size: 'xs', color: '#7F1D1D' }),
        textRow('• รหัสนักเรียนพิมพ์ผิด', { size: 'xs', color: '#7F1D1D' }),
        textRow('• ผู้ปกครองยังไม่ได้รับการอนุมัติจากโรงเรียน', { size: 'xs', color: '#7F1D1D' }),
      ], TONE.error, { spacing: 'xs', margin: 'md' }),
    ],
    footerLines: ['หากยังไม่สำเร็จ กรุณาติดต่อโรงเรียน'],
  });
}

function buildParentBindAlreadyCard(summary) {
  const childContents = [];
  if (summary?.children?.length > 0) {
    childContents.push(sectionTitle('บุตรหลานที่ผูกอยู่', TONE.warning));
    summary.children.slice(0, 3).forEach((c) => childContents.push(childBullet(c)));
    if (summary.children.length > 3) {
      childContents.push(textRow(`และอีก ${summary.children.length - 3} คน`, { size: 'xs', color: '#6B7280', margin: 'xs' }));
    }
  }
  return buildParentCard({
    tone: 'warning',
    title: 'บัญชีนี้ผูกอยู่แล้ว',
    subtitle: 'ไม่จำเป็นต้องผูกใหม่',
    bodyContents: [
      ...childContents,
      separator('lg'),
      textRow('คำสั่งที่ใช้ได้', { size: 'xs', color: TONE.warning.accent, weight: 'bold', margin: 'md' }),
      textRow('• "สถานะ" — ดูสถานะรับ-ส่งวันนี้', { size: 'xs', color: '#374151' }),
      textRow('• "ยกเลิกผูกบัญชี" — ยกเลิกการเชื่อมต่อ', { size: 'xs', color: '#374151' }),
      textRow('• "เปลี่ยนบัญชี" — เปลี่ยนเป็นผู้ปกครองอื่น', { size: 'xs', color: '#374151' }),
    ],
  });
}

function buildParentConfirmUnbindCard(summary) {
  // Phase 10.3E-UX2 — primary CTA is now a postback button pair. The chat
  // text shortcuts ("ยืนยันยกเลิก" / "ยกเลิก") remain valid; they're listed
  // in the footer as a fallback for anyone whose LINE client doesn't render
  // Flex buttons (rare, but possible on legacy desktop builds).
  const childContents = [];
  if (summary?.children?.length > 0) {
    childContents.push(sectionTitle('บุตรหลานที่ผูกอยู่', TONE.warning));
    summary.children.slice(0, 3).forEach((c) => childContents.push(childBullet(c)));
    if (summary.children.length > 3) {
      childContents.push(textRow(`และอีก ${summary.children.length - 3} คน`, { size: 'xs', color: '#6B7280', margin: 'xs' }));
    }
  }
  const confirmButton = {
    type: 'button',
    style: 'primary',
    color: '#DC2626',
    height: 'md',
    margin: 'lg',
    action: {
      type: 'postback',
      label: 'ยืนยันยกเลิกบัญชี',
      data: 'action=unlink_confirm',
      displayText: 'ยืนยันยกเลิกบัญชี',
    },
  };
  const cancelButton = {
    type: 'button',
    style: 'secondary',
    height: 'md',
    margin: 'sm',
    action: {
      type: 'postback',
      label: 'ไม่ยกเลิก',
      data: 'action=unlink_cancel',
      displayText: 'ไม่ยกเลิก',
    },
  };
  return buildParentCard({
    tone: 'warning',
    title: 'ยืนยันการยกเลิกผูกบัญชี',
    subtitle: 'คุณกำลังจะตัดการเชื่อมต่อ',
    bodyContents: [
      ...childContents,
      softBox([
        textRow('❗ หลังยกเลิก คุณจะไม่ได้รับแจ้งเตือนรับ-ส่งของบุตรหลานผ่าน LINE นี้อีก', {
          size: 'xs', color: TONE.warning.accent, weight: 'bold',
        }),
      ], TONE.warning, { margin: 'md' }),
      confirmButton,
      cancelButton,
    ],
    footerLines: [
      'หรือพิมพ์ "ยืนยันยกเลิก" / "ยกเลิก" ในแชต',
    ],
  });
}

function buildParentConfirmRebindCard(summary) {
  const lines = [];
  if (summary?.parent) {
    const phone = maskPhone(summary.parent.phone);
    lines.push(textRow(`บัญชีปัจจุบัน: ${summary.parent.name || '-'}`, { color: '#111827', weight: 'bold' }));
    lines.push(textRow(`เบอร์โทรศัพท์: ${phone}`, { size: 'xs', color: '#6B7280' }));
  }
  return buildParentCard({
    tone: 'warning',
    icon: '🔄',
    title: 'ยืนยันการเปลี่ยนบัญชี',
    subtitle: 'คุณกำลังจะสลับเป็นผู้ปกครองอื่น',
    bodyContents: [
      ...lines,
      softBox([
        textRow('ระบบจะยกเลิกการผูกบัญชีเดิม แล้วเริ่มขั้นตอนผูกใหม่ทันที', {
          size: 'xs', color: TONE.warning.accent, weight: 'bold',
        }),
      ], TONE.warning, { margin: 'md' }),
    ],
    footerLines: [
      'พิมพ์ "ยืนยันเปลี่ยนบัญชี" เพื่อดำเนินการ',
      'พิมพ์ "ยกเลิก" เพื่อกลับ',
    ],
  });
}

function buildParentUnbindSuccessCard() {
  return buildParentCard({
    tone: 'success',
    title: 'ยกเลิกผูกบัญชีสำเร็จ',
    subtitle: 'บัญชี LINE นี้ถูกตัดการเชื่อมต่อแล้ว',
    bodyContents: [
      textRow('คุณจะไม่ได้รับแจ้งเตือนรับ-ส่งบุตรหลานผ่าน LINE นี้อีก', { color: '#111827' }),
    ],
    footerLines: ['หากต้องการใช้งานอีกครั้ง พิมพ์ "ผูกบัญชี"'],
  });
}

function buildParentRebindContinueCard() {
  const tone = TONE.success;
  return buildParentCard({
    tone: 'success',
    icon: '🔄',
    title: 'ยกเลิกบัญชีเดิมแล้ว',
    subtitle: 'เริ่มขั้นตอนผูกบัญชีใหม่',
    bodyContents: [
      sectionTitle('ขั้นตอนที่ 1', tone),
      textRow('กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักที่ลงทะเบียนไว้กับโรงเรียน', { color: '#111827' }),
      exampleChip('0901234567'),
    ],
    footerLines: ['พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้'],
  });
}

function buildParentNotBoundCard() {
  return buildParentCard({
    tone: 'warning',
    title: 'ยังไม่ได้ผูกบัญชี',
    subtitle: 'ไม่พบบัญชีผู้ปกครองที่เชื่อมต่อกับ LINE นี้',
    bodyContents: [
      textRow('กรุณาผูกบัญชีก่อนใช้งานคำสั่งนี้', { color: '#111827' }),
    ],
    footerLines: ['พิมพ์ "ผูกบัญชี" เพื่อเริ่มต้น'],
  });
}

function buildParentCancelCard(hadPendingState) {
  return buildParentCard({
    tone: 'neutral',
    icon: '✋',
    title: hadPendingState ? 'ยกเลิกขั้นตอนแล้ว' : 'ไม่มีคำสั่งค้างอยู่',
    subtitle: hadPendingState
      ? 'คุณสามารถเริ่มใหม่ได้ทุกเมื่อ'
      : 'ระบบไม่พบขั้นตอนที่กำลังทำอยู่',
    bodyContents: [
      textRow(
        hadPendingState
          ? 'ระบบได้ยกเลิกขั้นตอนปัจจุบันเรียบร้อยแล้ว'
          : 'หากต้องการใช้งาน กรุณาเลือกคำสั่งจากเมนู',
        { color: '#111827' }
      ),
    ],
    footerLines: ['พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้'],
  });
}

function buildParentChildrenInfoCard(children) {
  const total = children.length;
  const max = 3;
  const shown = children.slice(0, max);
  const truncated = total > max;

  const sections = [];
  shown.forEach((c, idx) => {
    if (idx > 0) sections.push(separator('lg'));
    if (total > 1) {
      sections.push(textRow(`คนที่ ${idx + 1}/${total}`, {
        size: 'xxs', color: '#9CA3AF', weight: 'bold', margin: 'md',
      }));
    }
    const fullName = `${c.prefix || ''}${c.first_name} ${c.last_name}`.trim();
    sections.push(textRow('👦 ' + fullName, {
      size: 'lg', color: '#111827', weight: 'bold', margin: total > 1 ? 'xs' : (idx === 0 ? 'none' : 'md'),
    }));
    const meta = [
      [c.grade, c.classroom].filter(Boolean).join(' / '),
      c.school_name,
    ].filter(Boolean).join(' · ');
    if (meta) sections.push(textRow(meta, { size: 'sm', color: '#6B7280' }));
    sections.push(textRow(`🚌 รถ: ${c.plate_no || '-'}`, { size: 'sm', color: '#374151', margin: 'sm' }));
    sections.push(textRow(`👤 ผู้ขับ: ${c.driver_name || '-'}`, { size: 'sm', color: '#374151' }));
  });
  if (truncated) {
    sections.push(separator('xl'));
    sections.push(textRow(
      `แสดง ${max} จาก ${total} คน · มีข้อมูลเพิ่มเติม กรุณาติดต่อโรงเรียน`,
      { size: 'xs', color: TONE.warning.accent, weight: 'bold', align: 'center', margin: 'lg' }
    ));
  }
  return buildParentCard({
    tone: 'info',
    icon: '👨‍👩‍👧',
    title: 'ข้อมูลบุตรหลาน',
    subtitle: total > 1 ? `ทั้งหมด ${total} คน` : 'ที่ผูกบัญชีไว้',
    bodyContents: sections,
    footerLines: ['หากข้อมูลไม่ถูกต้อง กรุณาติดต่อโรงเรียน'],
  });
}

function buildParentHelpCard(isLinked) {
  const commands = isLinked
    ? [
        '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้',
        '• "ข้อมูลบุตร" — ดูข้อมูลบุตรหลาน',
        '• "ยกเลิกผูกบัญชี" — ยกเลิกการเชื่อมต่อ',
        '• "เปลี่ยนบัญชี" — เปลี่ยนเป็นผู้ปกครองอื่น',
      ]
    : [
        '• "ผูกบัญชี" — เชื่อมข้อมูลบุตรหลาน',
        '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้ (หลังผูกบัญชี)',
        '• "ข้อมูลบุตร" — ดูข้อมูลบุตรหลาน (หลังผูกบัญชี)',
      ];
  return buildParentCard({
    tone: 'info',
    icon: '📖',
    title: 'เมนูใช้งาน LINE OA',
    subtitle: 'คำสั่งที่พิมพ์ได้',
    bodyContents: [
      ...commands.map((c) => textRow(c, { size: 'sm', color: '#111827' })),
      separator('lg'),
      textRow('พิมพ์ "ช่วยเหลือ" เพื่อแสดงเมนูนี้อีกครั้ง', {
        size: 'xs', color: '#6B7280', margin: 'md',
      }),
    ],
    footerLines: ['ระบบรถรับส่งนักเรียนจังหวัดลำปาง'],
  });
}

function buildParentUnknownCommandCard(isLinked) {
  const tone = TONE.neutral;
  const commands = isLinked
    ? [
        '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้',
        '• "ข้อมูลบุตร" — ดูข้อมูลบุตรหลาน',
        '• "ยกเลิกผูกบัญชี"',
      ]
    : [
        '• "ผูกบัญชี" — เชื่อมข้อมูลบุตรหลาน',
        '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้',
        '• "ข้อมูลบุตร" — ดูข้อมูลบุตรหลาน',
      ];
  return buildParentCard({
    tone: 'neutral',
    icon: '❓',
    title: 'ไม่เข้าใจคำสั่ง',
    subtitle: 'ลองพิมพ์คำสั่งจากรายการด้านล่าง',
    bodyContents: [
      sectionTitle('คำสั่งที่ใช้บ่อย', tone),
      ...commands.map((c) => textRow(c, { size: 'sm', color: '#111827' })),
    ],
    footerLines: ['พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมด'],
  });
}

// ─── Plain-text fallback builders ───────────────────────────────────────────
// Used by pushParentFlex() when Flex delivery fails. Each mirrors the card
// it accompanies — same wording, same info, just no formatting.

function fallbackRequestPhone() {
  return 'ผูกบัญชีผู้ปกครอง\n\n' +
    'ขั้นตอนที่ 1: กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักที่ลงทะเบียนไว้กับโรงเรียน\n' +
    'ตัวอย่าง: 0901234567\n\n' +
    'พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้';
}

function fallbackRequestStudent() {
  return 'ยืนยันข้อมูลบุตรหลาน\n\n' +
    'ขั้นตอนที่ 2: กรุณาพิมพ์รหัสนักเรียนของบุตรหลาน (ตัวเลข)\n' +
    'ตัวอย่าง: 18985\n\n' +
    'พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้';
}

function fallbackInvalidPhone() {
  return '⚠️ เบอร์โทรไม่ถูกต้อง\nกรุณาพิมพ์เบอร์โทรศัพท์ 10 หลัก เช่น 0901234567\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก';
}

function fallbackInvalidStudent() {
  return '⚠️ รหัสนักเรียนไม่ถูกต้อง\nกรุณาพิมพ์เป็นตัวเลข เช่น 18985\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก';
}

function fallbackBindSuccess(children = []) {
  let m = '✅ ผูกบัญชีสำเร็จ\n\nคุณจะได้รับแจ้งเตือนเมื่อบุตรหลานขึ้น-ลงรถ\n';
  if (children.length) {
    m += '\nบุตรหลานที่ผูกแล้ว:';
    children.slice(0, 3).forEach((c) => {
      m += `\n• ${c.prefix || ''}${c.first_name} ${c.last_name}`;
    });
    if (children.length > 3) m += `\nและอีก ${children.length - 3} คน`;
  }
  m += '\n\nพิมพ์ "สถานะ" เพื่อดูสถานะวันนี้';
  return m;
}

function fallbackBindError(reason) {
  return '❌ ไม่สามารถผูกบัญชีได้\n' + (reason || 'ไม่พบข้อมูลที่ตรงกัน') +
    '\n\nกรุณาตรวจสอบข้อมูลและลองอีกครั้ง หรือติดต่อโรงเรียน';
}

function fallbackBindAlready(summary) {
  let m = '⚠️ บัญชีนี้ผูกอยู่แล้ว\n';
  if (summary?.children?.length) {
    m += '\nบุตรหลานที่ผูกอยู่:';
    summary.children.slice(0, 3).forEach((c) => {
      m += `\n• ${c.first_name} ${c.last_name}`;
    });
  }
  m += '\n\nพิมพ์ "สถานะ" หรือ "ยกเลิกผูกบัญชี" หรือ "เปลี่ยนบัญชี"';
  return m;
}

function fallbackConfirmUnbind(summary) {
  let m = '⚠️ ยืนยันการยกเลิกผูกบัญชี\n';
  if (summary?.children?.length) {
    m += '\nบุตรหลานที่ผูกอยู่:';
    summary.children.slice(0, 3).forEach((c) => {
      m += `\n• ${c.first_name} ${c.last_name}`;
    });
  }
  m += '\n\n❗ หลังยกเลิก คุณจะไม่ได้รับแจ้งเตือนรับ-ส่งอีก';
  m += '\n\nพิมพ์ "ยืนยันยกเลิก" เพื่อดำเนินการ\nพิมพ์ "ยกเลิก" เพื่อกลับ';
  return m;
}

function fallbackConfirmRebind(summary) {
  let m = '🔄 ยืนยันการเปลี่ยนบัญชี\n';
  if (summary?.parent) {
    m += `\nบัญชีปัจจุบัน: ${summary.parent.name || '-'} (${maskPhone(summary.parent.phone)})`;
  }
  m += '\n\nระบบจะยกเลิกการผูกบัญชีเดิม แล้วเริ่มผูกใหม่';
  m += '\n\nพิมพ์ "ยืนยันเปลี่ยนบัญชี" เพื่อดำเนินการ\nพิมพ์ "ยกเลิก" เพื่อกลับ';
  return m;
}

function fallbackUnbindSuccess() {
  return '✅ ยกเลิกผูกบัญชีสำเร็จ\nบัญชี LINE นี้ถูกตัดการเชื่อมต่อแล้ว\n\nหากต้องการใช้งานอีกครั้ง พิมพ์ "ผูกบัญชี"';
}

function fallbackRebindContinue() {
  return '✅ ยกเลิกบัญชีเดิมแล้ว\n\nเริ่มผูกบัญชีใหม่…\nกรุณาพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับโรงเรียน (10 หลัก)\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก';
}

function fallbackNotBound() {
  return '⚠️ ยังไม่ได้ผูกบัญชี\nไม่พบบัญชีผู้ปกครองที่เชื่อมต่อกับ LINE นี้\n\nพิมพ์ "ผูกบัญชี" เพื่อเริ่มต้น';
}

function fallbackCancel(hadPendingState) {
  return hadPendingState
    ? 'ยกเลิกขั้นตอนแล้ว\nคุณสามารถเริ่มใหม่ได้ทุกเมื่อ\n\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่ง'
    : 'ไม่มีคำสั่งค้างอยู่\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้';
}

function fallbackChildrenInfo(children) {
  let m = '👨‍👩‍👧 ข้อมูลบุตรหลาน\n';
  const total = children.length;
  children.slice(0, 3).forEach((c, idx) => {
    if (total > 1) m += `\n— คนที่ ${idx + 1}/${total} —`;
    m += `\n👦 ${c.prefix || ''}${c.first_name} ${c.last_name}`;
    const meta = [c.grade, c.classroom].filter(Boolean).join('/');
    if (meta) m += `\nชั้น: ${meta}`;
    if (c.school_name) m += `\nโรงเรียน: ${c.school_name}`;
    m += `\n🚌 รถ: ${c.plate_no || '-'}`;
    m += `\n👤 ผู้ขับ: ${c.driver_name || '-'}`;
    m += '\n';
  });
  if (total > 3) m += `\nและอีก ${total - 3} คน\n`;
  m += '\nหากข้อมูลไม่ถูกต้อง กรุณาติดต่อโรงเรียน';
  return m.trim();
}

function fallbackHelp(isLinked) {
  let m = '📌 เมนูใช้งาน LINE OA\n\n';
  m += '• "ผูกบัญชี" — เชื่อมข้อมูลบุตรหลาน\n';
  m += '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้\n';
  m += '• "ข้อมูลบุตร" — ดูข้อมูลบุตรหลาน\n';
  if (isLinked) {
    m += '• "ยกเลิกผูกบัญชี" — ยกเลิกการเชื่อม\n';
    m += '• "เปลี่ยนบัญชี" — เปลี่ยนผู้ปกครอง\n';
  }
  m += '• "ช่วยเหลือ" — แสดงเมนูนี้';
  return m;
}

function fallbackUnknownCommand(isLinked) {
  return 'ไม่เข้าใจคำสั่ง\n\n' + fallbackHelp(isLinked);
}

module.exports = {
  TONE,
  formatTHTimestamp,
  maskPhone,
  // Card builders (Flex)
  buildParentRequestPhoneCard,
  buildParentRequestStudentCard,
  buildParentInvalidPhoneCard,
  buildParentInvalidStudentCard,
  buildParentBindSuccessCard,
  buildParentBindErrorCard,
  buildParentBindAlreadyCard,
  buildParentConfirmUnbindCard,
  buildParentConfirmRebindCard,
  buildParentUnbindSuccessCard,
  buildParentRebindContinueCard,
  buildParentNotBoundCard,
  buildParentCancelCard,
  buildParentChildrenInfoCard,
  buildParentHelpCard,
  buildParentUnknownCommandCard,
  // Fallbacks (plain text)
  fallbackRequestPhone,
  fallbackRequestStudent,
  fallbackInvalidPhone,
  fallbackInvalidStudent,
  fallbackBindSuccess,
  fallbackBindError,
  fallbackBindAlready,
  fallbackConfirmUnbind,
  fallbackConfirmRebind,
  fallbackUnbindSuccess,
  fallbackRebindContinue,
  fallbackNotBound,
  fallbackCancel,
  fallbackChildrenInfo,
  fallbackHelp,
  fallbackUnknownCommand,
};
