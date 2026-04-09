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
 *
 * State machine steps:
 *   (none)            → idle, process commands
 *   await_phone       → waiting for phone number (bind flow)
 *   await_student_id  → waiting for student ID (bind flow)
 *   confirm_unlink    → waiting for "ยืนยันยกเลิก"
 *   confirm_rebind    → waiting for "ยืนยันเปลี่ยนบัญชี"
 */
async function handleTextMessage(lineUserId, text) {
  const cmd = text.trim();
  const cmdLower = cmd.toLowerCase();

  // ── "ยกเลิก" resets any pending state ──
  if (cmdLower === 'ยกเลิก' || cmdLower === 'cancel') {
    const state = lineSvc.getLinkState(lineUserId);
    if (state) {
      lineSvc.clearLinkState(lineUserId);
      await lineSvc.sendTextMessage(lineUserId, 'ยกเลิกคำสั่งแล้ว');
    } else {
      await lineSvc.sendTextMessage(lineUserId, 'ไม่มีคำสั่งค้างอยู่');
    }
    return;
  }

  // ── State machine: process pending states first ──
  const state = lineSvc.getLinkState(lineUserId);

  if (state?.step === 'await_phone') {
    const phone = cmd.replace(/-/g, '').trim();
    if (!/^\d{9,10}$/.test(phone)) {
      await lineSvc.sendTextMessage(lineUserId, 'เบอร์โทรไม่ถูกต้อง กรุณาพิมพ์เบอร์โทร 10 หลัก เช่น 0812345678\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก');
      return;
    }
    const normalized = phone.length === 9 && (phone[0] === '8' || phone[0] === '9') ? '0' + phone : phone;
    lineSvc.setLinkState(lineUserId, { step: 'await_student_id', phone: normalized });
    await lineSvc.sendTextMessage(lineUserId, 'กรุณาพิมพ์รหัสนักเรียนของบุตรหลาน (ตัวเลข)\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก');
    return;
  }

  if (state?.step === 'await_student_id') {
    const studentId = parseInt(cmd, 10);
    if (!studentId || isNaN(studentId)) {
      await lineSvc.sendTextMessage(lineUserId, 'รหัสนักเรียนไม่ถูกต้อง กรุณาพิมพ์เป็นตัวเลข\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก');
      return;
    }
    const result = await lineSvc.tryLinkByPhoneAndStudentId(lineUserId, state.phone, studentId);
    lineSvc.clearLinkState(lineUserId);
    if (result.success) {
      await lineSvc.logMessage(lineUserId, 'system', 'bind_success', 'ok', `parent_id=${result.parentId}`);
      await lineSvc.sendTextMessage(lineUserId,
        '✅ ผูกบัญชีสำเร็จ!\n\nคุณจะได้รับแจ้งเตือนเมื่อบุตรหลานขึ้น-ลงรถ\n\nพิมพ์ "สถานะ" เพื่อดูสถานะวันนี้'
      );
    } else {
      await lineSvc.sendTextMessage(lineUserId, '❌ ' + result.message);
    }
    return;
  }

  if (state?.step === 'confirm_unlink') {
    if (cmdLower === 'ยืนยันยกเลิก') {
      lineSvc.clearLinkState(lineUserId);
      const result = await lineSvc.unlinkAccount(lineUserId);
      if (result.success) {
        await lineSvc.logMessage(lineUserId, 'system', 'unlink_success', 'ok', `parent_id=${result.unlinkedParentId}`);
        await lineSvc.sendTextMessage(lineUserId,
          '✅ ยกเลิกการผูกบัญชีเรียบร้อยแล้ว\n\nคุณจะไม่ได้รับแจ้งเตือนอีกจนกว่าจะผูกบัญชีใหม่\n\nพิมพ์ "ผูกบัญชี" เพื่อเริ่มต้นใหม่'
        );
      } else {
        await lineSvc.sendTextMessage(lineUserId, '❌ ' + result.message);
      }
    } else {
      lineSvc.clearLinkState(lineUserId);
      await lineSvc.sendTextMessage(lineUserId, 'ยกเลิกคำสั่ง — ไม่มีการเปลี่ยนแปลง');
    }
    return;
  }

  if (state?.step === 'confirm_rebind') {
    if (cmdLower === 'ยืนยันเปลี่ยนบัญชี') {
      const unlinkResult = await lineSvc.unlinkAccount(lineUserId);
      if (unlinkResult.success) {
        await lineSvc.logMessage(lineUserId, 'system', 'rebind_unlink', 'ok', `old_parent_id=${unlinkResult.unlinkedParentId}`);
        lineSvc.setLinkState(lineUserId, { step: 'await_phone' });
        await lineSvc.sendTextMessage(lineUserId,
          '✅ ยกเลิกการผูกบัญชีเดิมแล้ว\n\nเริ่มผูกบัญชีใหม่…\nกรุณาพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับโรงเรียน (10 หลัก)\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก'
        );
      } else {
        lineSvc.clearLinkState(lineUserId);
        await lineSvc.sendTextMessage(lineUserId, '❌ ไม่สามารถยกเลิกการผูกบัญชีเดิมได้ กรุณาลองใหม่');
      }
    } else {
      lineSvc.clearLinkState(lineUserId);
      await lineSvc.sendTextMessage(lineUserId, 'ยกเลิกคำสั่ง — ไม่มีการเปลี่ยนแปลง');
    }
    return;
  }

  // ── Commands (no pending state) ──

  if (cmdLower === 'ผูกบัญชี' || cmdLower === 'ลงทะเบียน' || cmdLower === 'link') {
    // Check if already linked
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    if (linked) {
      const summary = await lineSvc.getLinkedParentSummary(lineUserId);
      let msg = '⚠️ บัญชี LINE นี้ผูกอยู่แล้ว\n';
      if (summary?.children?.length > 0) {
        msg += '\nบุตรหลานที่ผูกอยู่:';
        for (const c of summary.children) {
          msg += `\n• ${c.first_name} ${c.last_name} (${c.grade || '-'}) — ${c.school_name || '-'}`;
        }
      }
      msg += '\n\n📌 คำสั่งที่ใช้ได้:';
      msg += '\n• "สถานะ" — ดูสถานะรับ-ส่งวันนี้';
      msg += '\n• "ยกเลิกผูกบัญชี" — ยกเลิกการเชื่อม';
      msg += '\n• "เปลี่ยนบัญชี" — เปลี่ยนเป็นผู้ปกครองอื่น';
      await lineSvc.sendTextMessage(lineUserId, msg);
      return;
    }
    lineSvc.setLinkState(lineUserId, { step: 'await_phone' });
    await lineSvc.sendTextMessage(lineUserId, 'กรุณาพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับโรงเรียน (10 หลัก)\n\nพิมพ์ "ยกเลิก" เพื่อยกเลิก');
    return;
  }

  if (cmdLower === 'ยกเลิกผูกบัญชี' || cmdLower === 'unlink') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    if (!linked) {
      await lineSvc.sendTextMessage(lineUserId, 'บัญชี LINE นี้ยังไม่ได้ผูกกับข้อมูลใด\nพิมพ์ "ผูกบัญชี" เพื่อเริ่มต้น');
      return;
    }
    const summary = await lineSvc.getLinkedParentSummary(lineUserId);
    let msg = '⚠️ คุณกำลังจะยกเลิกการผูกบัญชี\n';
    if (summary?.children?.length > 0) {
      msg += '\nบุตรหลานที่ผูกอยู่:';
      for (const c of summary.children) {
        msg += `\n• ${c.first_name} ${c.last_name}`;
      }
    }
    msg += '\n\n❗ หลังยกเลิก คุณจะไม่ได้รับแจ้งเตือนรับ-ส่งอีก';
    msg += '\n\nพิมพ์ "ยืนยันยกเลิก" เพื่อดำเนินการ';
    msg += '\nพิมพ์ "ยกเลิก" เพื่อยกเลิกคำสั่ง';
    lineSvc.setLinkState(lineUserId, { step: 'confirm_unlink' });
    await lineSvc.sendTextMessage(lineUserId, msg);
    return;
  }

  if (cmdLower === 'เปลี่ยนบัญชี' || cmdLower === 'rebind') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    if (!linked) {
      await lineSvc.sendTextMessage(lineUserId, 'บัญชี LINE นี้ยังไม่ได้ผูกกับข้อมูลใด\nพิมพ์ "ผูกบัญชี" เพื่อเริ่มต้น');
      return;
    }
    const summary = await lineSvc.getLinkedParentSummary(lineUserId);
    let msg = '⚠️ คุณกำลังจะเปลี่ยนบัญชีผู้ปกครอง\n';
    if (summary?.parent) msg += `\nบัญชีปัจจุบัน: ${summary.parent.name || '-'} (${summary.parent.phone || '-'})`;
    msg += '\n\nระบบจะยกเลิกการผูกบัญชีเดิม แล้วเริ่มผูกใหม่';
    msg += '\n\nพิมพ์ "ยืนยันเปลี่ยนบัญชี" เพื่อดำเนินการ';
    msg += '\nพิมพ์ "ยกเลิก" เพื่อยกเลิกคำสั่ง';
    lineSvc.setLinkState(lineUserId, { step: 'confirm_rebind' });
    await lineSvc.sendTextMessage(lineUserId, msg);
    return;
  }

  if (cmdLower === 'สถานะ' || cmdLower === 'status') {
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

  if (cmdLower === 'ข้อมูลบุตร' || cmdLower === 'children' || cmdLower === 'ลูก') {
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

  if (cmdLower === 'ช่วยเหลือ' || cmdLower === 'help' || cmdLower === 'เมนู' || cmdLower === 'menu') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    let msg = '📌 คำสั่งที่ใช้ได้:\n\n';
    msg += '• "ผูกบัญชี" — เชื่อมข้อมูลบุตรหลาน\n';
    msg += '• "สถานะ" — ดูสถานะรับ-ส่งวันนี้\n';
    msg += '• "ข้อมูลบุตร" — ดูข้อมูลนักเรียน\n';
    if (linked) {
      msg += '• "ยกเลิกผูกบัญชี" — ยกเลิกการเชื่อม\n';
      msg += '• "เปลี่ยนบัญชี" — เปลี่ยนผู้ปกครอง\n';
    }
    msg += '• "ช่วยเหลือ" — แสดงเมนูนี้';
    await lineSvc.sendTextMessage(lineUserId, msg);
    return;
  }

  // Default response
  await lineSvc.sendTextMessage(lineUserId,
    'ไม่เข้าใจคำสั่ง\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้'
  );
}

// ─── Notification processing endpoint (called by cron or manually) ──────────
// Protected by API key header to prevent unauthorized trigger.
// Set CRON_API_KEY env var and pass it as x-api-key header.

router.post('/process-notifications', (req, res, next) => {
  const cronKey = process.env.CRON_API_KEY;
  if (cronKey && req.headers['x-api-key'] !== cronKey) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }
  next();
}, async (req, res) => {
  try {
    const result = await lineSvc.processUnsentNotifications();
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[LINE] Notification processing error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
