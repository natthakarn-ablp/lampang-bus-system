'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const env = require('../config/env');
const lineSvc = require('../services/line.service');

/**
 * Verify LINE webhook signature.
 * Returns true if valid or if no secret configured (dev mode).
 */
function verifySignature(body, signature) {
  if (!env.line.channelSecret) return true; // dev mode — no verification
  const hash = crypto.createHmac('SHA256', env.line.channelSecret)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// LINE webhook — uses express.raw to get Buffer for signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let rawBody;
  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
  } else if (typeof req.body === 'string') {
    rawBody = Buffer.from(req.body);
  } else {
    // Fallback: collect raw chunks manually if body wasn't parsed
    rawBody = Buffer.from(JSON.stringify(req.body || {}));
  }

  const signature = req.headers['x-line-signature'] || '';
  if (!verifySignature(rawBody, signature)) {
    console.warn('[LINE] Invalid signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // LINE expects 200 immediately
  res.status(200).json({ status: 'ok' });

  // Process events asynchronously
  try {
    const body = JSON.parse(rawBody.toString());
    const events = body.events || [];
    for (const event of events) {
      await handleEvent(event).catch(err =>
        console.error('[LINE] Event error:', err.message)
      );
    }
  } catch (err) {
    console.error('[LINE] Webhook parse error:', err.message);
  }
});

/**
 * Handle a single LINE event.
 */
async function handleEvent(event) {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  if (event.type === 'follow') {
    const profile = event.source; // displayName comes from profile API if needed
    await lineSvc.upsertLineUser(lineUserId, null);
    await lineSvc.logMessage(lineUserId, 'system', 'follow', 'ok', null);
    await lineSvc.sendTextMessage(lineUserId,
      'ยินดีต้อนรับสู่ระบบรถรับส่งนักเรียนจังหวัดลำปาง 🚌\n\n' +
      'พิมพ์ "ผูกบัญชี" เพื่อเชื่อมข้อมูลบุตรหลาน\n' +
      'พิมพ์ "สถานะ" เพื่อดูสถานะรับ-ส่งวันนี้\n' +
      'พิมพ์ "ข้อมูลบุตร" เพื่อดูข้อมูลนักเรียนที่ผูกไว้'
    );
    return;
  }

  if (event.type === 'unfollow') {
    await lineSvc.removeLineUser(lineUserId);
    await lineSvc.logMessage(lineUserId, 'system', 'unfollow', 'ok', null);
    return;
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();
    await lineSvc.logMessage(lineUserId, 'user', text, 'received', null);
    await handleTextMessage(lineUserId, text);
    return;
  }
}

/**
 * Handle text message commands.
 */
async function handleTextMessage(lineUserId, text) {
  // ── Linking flow state machine ──
  const state = lineSvc.getLinkState(lineUserId);

  if (state?.step === 'await_phone') {
    const phone = text.replace(/-/g, '').trim();
    if (!/^\d{9,10}$/.test(phone)) {
      await lineSvc.sendTextMessage(lineUserId, 'เบอร์โทรไม่ถูกต้อง กรุณาพิมพ์เบอร์โทร 10 หลัก เช่น 0812345678');
      return;
    }
    // Auto-pad leading zero
    const normalized = phone.length === 9 && (phone[0] === '8' || phone[0] === '9') ? '0' + phone : phone;
    lineSvc.setLinkState(lineUserId, { step: 'await_student_id', phone: normalized });
    await lineSvc.sendTextMessage(lineUserId, 'กรุณาพิมพ์รหัสนักเรียนของบุตรหลาน (ตัวเลข)');
    return;
  }

  if (state?.step === 'await_student_id') {
    const studentId = parseInt(text, 10);
    if (!studentId || isNaN(studentId)) {
      await lineSvc.sendTextMessage(lineUserId, 'รหัสนักเรียนไม่ถูกต้อง กรุณาพิมพ์เป็นตัวเลข');
      return;
    }
    const result = await lineSvc.tryLinkByPhoneAndStudentId(lineUserId, state.phone, studentId);
    lineSvc.clearLinkState(lineUserId);
    if (result.success) {
      await lineSvc.sendTextMessage(lineUserId,
        '✅ ผูกบัญชีสำเร็จ!\n\nคุณจะได้รับแจ้งเตือนเมื่อบุตรหลานขึ้น-ลงรถ\n\nพิมพ์ "สถานะ" เพื่อดูสถานะวันนี้'
      );
    } else {
      await lineSvc.sendTextMessage(lineUserId, '❌ ' + result.message);
    }
    return;
  }

  // ── Commands ──
  const cmd = text.toLowerCase();

  if (cmd === 'ผูกบัญชี' || cmd === 'ลงทะเบียน' || cmd === 'link') {
    lineSvc.setLinkState(lineUserId, { step: 'await_phone' });
    await lineSvc.sendTextMessage(lineUserId, 'กรุณาพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับโรงเรียน (10 หลัก)');
    return;
  }

  if (cmd === 'สถานะ' || cmd === 'status') {
    const children = await lineSvc.getLinkedChildren(lineUserId);
    if (children.length === 0) {
      await lineSvc.sendTextMessage(lineUserId, 'ยังไม่ได้ผูกบัญชี\nพิมพ์ "ผูกบัญชี" เพื่อเริ่มต้น');
      return;
    }
    let msg = '📋 สถานะรับ-ส่งวันนี้\n';
    for (const child of children) {
      const st = await lineSvc.getChildStatusToday(child.id);
      const mLabel = st.morning_done ? `✅ ส่งแล้ว ${st.morning_ts ? new Date(st.morning_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''}` : '⏳ ยังไม่ส่ง';
      const eLabel = st.evening_done ? `✅ รับแล้ว ${st.evening_ts ? new Date(st.evening_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''}` : '⏳ ยังไม่รับ';
      msg += `\n👦 ${child.prefix || ''}${child.first_name} ${child.last_name}`;
      msg += `\n   ${child.grade || ''}${child.classroom ? '/' + child.classroom : ''} - ${child.school_name || ''}`;
      msg += `\n   เช้า: ${mLabel}`;
      msg += `\n   เย็น: ${eLabel}`;
      if (child.plate_no) msg += `\n   🚐 ${child.plate_no}`;
      msg += '\n';
    }
    await lineSvc.sendTextMessage(lineUserId, msg.trim());
    return;
  }

  if (cmd === 'ข้อมูลบุตร' || cmd === 'children' || cmd === 'ลูก') {
    const children = await lineSvc.getLinkedChildren(lineUserId);
    if (children.length === 0) {
      await lineSvc.sendTextMessage(lineUserId, 'ยังไม่ได้ผูกบัญชี\nพิมพ์ "ผูกบัญชี" เพื่อเริ่มต้น');
      return;
    }
    let msg = '👨‍👩‍👧‍👦 ข้อมูลบุตรหลาน\n';
    for (const child of children) {
      msg += `\n• ${child.prefix || ''}${child.first_name} ${child.last_name}`;
      msg += `\n  รหัส: ${child.id}`;
      msg += `\n  ชั้น: ${child.grade || '-'}${child.classroom ? '/' + child.classroom : ''}`;
      msg += `\n  โรงเรียน: ${child.school_name || '-'}`;
      msg += `\n  ทะเบียนรถ: ${child.plate_no || 'ยังไม่ระบุ'}`;
    }
    await lineSvc.sendTextMessage(lineUserId, msg.trim());
    return;
  }

  if (cmd === 'ช่วยเหลือ' || cmd === 'help' || cmd === 'เมนู' || cmd === 'menu') {
    await lineSvc.sendTextMessage(lineUserId,
      '📌 คำสั่งที่ใช้ได้:\n\n' +
      '• "ผูกบัญชี" — เชื่อมข้อมูลบุตรหลาน\n' +
      '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้\n' +
      '• "ข้อมูลบุตร" — ดูข้อมูลนักเรียน\n' +
      '• "ช่วยเหลือ" — แสดงเมนูนี้'
    );
    return;
  }

  // Default response
  await lineSvc.sendTextMessage(lineUserId,
    'ไม่เข้าใจคำสั่ง\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้'
  );
}

// ─── Notification processing endpoint (called by cron or manually) ──────────

router.post('/process-notifications', async (req, res) => {
  try {
    const result = await lineSvc.processUnsentNotifications();
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[LINE] Notification processing error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
