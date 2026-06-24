---
name: Lampang Bus System
description: ระบบกำกับรถรับส่งนักเรียนจังหวัดลำปางที่เชื่อมโรงเรียน ขนส่ง คนขับ และจังหวัดใน workflow เดียว
colors:
  brand-primary: "#1D4ED8"
  brand-primary-50: "#EFF6FF"
  brand-primary-600: "#2563EB"
  brand-primary-700: "#1D4ED8"
  brand-primary-800: "#1E40AF"
  brand-primary-900: "#1E3A8A"
  surface-app: "#F8FAFC"
  surface-raised: "#FFFFFF"
  surface-border: "#E2E8F0"
  ink-primary: "#0F172A"
  ink-muted: "#64748B"
  success: "#10B981"
  success-soft: "#D1FAE5"
  warning: "#F59E0B"
  warning-soft: "#FEF3C7"
  danger: "#EF4444"
  danger-soft: "#FEE2E2"
  info: "#0EA5E9"
  info-soft: "#E0F2FE"
typography:
  display:
    fontFamily: "Sarabun, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  headline:
    fontFamily: "Sarabun, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "normal"
  title:
    fontFamily: "Sarabun, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Sarabun, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Sarabun, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.02em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-x: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand-primary-600}"
    textColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card-surface:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.xl}"
    padding: "24px"
  sidebar-active-item:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.brand-primary-800}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  badge-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
---

# Design System: Lampang Bus System

## 1. Overview

**Creative North Star: "ศูนย์ควบคุมความปลอดภัยที่ตรวจสอบได้"**

ระบบนี้เป็น product UI สำหรับงานราชการเชิงปฏิบัติการ ไม่ใช่ landing page และไม่ใช่งานโชว์ visual effect เป้าหมายคือให้โรงเรียน ขนส่ง คนขับ และ อบจ. เห็นสถานะรถ คนขับ เอกสาร และงานถัดไปได้ภายในไม่กี่วินาที บุคลิกหลักคือ **น่าเชื่อถือ คล่องตัว ทันสมัย** โดยความทันสมัยมาจาก hierarchy, state feedback, และ motion ที่อธิบายการเปลี่ยนสถานะเท่านั้น

ทิศทาง visual เป็น Hybrid Motion Ops: dashboard, command center, sidebar, และ status overview ใช้โทนเข้มจาก brand navy เพื่อสร้าง focus ส่วนฟอร์ม ตาราง checklist เอกสารพิมพ์ และหน้าที่ต้องตรวจรายละเอียดใช้พื้นสว่างเพื่ออ่านง่าย ภาพรวมสามารถรู้สึกทันสมัยแบบ motion-forward ได้ แต่จุดตัดสินใจด้านความปลอดภัยต้องชัด ไม่แย่งสายตา และไม่ซ่อนหลัง interaction

ระบบนี้ปฏิเสธภาพลักษณ์แบบเกม คริปโต cyberpunk แสงนีออน กระจกเบลอ และเอฟเฟกต์เคลื่อนไหวต่อเนื่องจนรบกวนการอ่าน Dashboard ห้ามมืดจนใช้งานกลางแจ้งไม่ได้ และงานหลักห้ามถูกซ่อนหลัง animation หรือ interaction ที่ผู้ใช้ต้องค้นหาเอง

**Key Characteristics:**

- Task-first: ทุกหน้าต้องเห็นสถานะปัจจุบัน ความเสี่ยง และ action ถัดไปก่อนข้อมูลรอง
- Hybrid surfaces: dark เฉพาะส่วน command และ navigation, light สำหรับงานตรวจเอกสารและฟอร์ม
- Safety hierarchy: สถานะรถ ใบอนุญาต ความจุ และข้อห้ามต้องเด่นกว่าการตกแต่ง
- Thai-first readability: Sarabun เป็นฟอนต์หลัก ใช้ขนาดและ contrast ที่อ่านได้บนจอสำนักงานและมือถือกลางแจ้ง
- Motion with evidence: motion ใช้เพื่อบอกสถานะ เปิดรายละเอียด อัปเดตผล หรือเชื่อมความสัมพันธ์ของข้อมูล

## 2. Colors

Palette ปัจจุบันเป็น restrained government-blue system: น้ำเงินหลักใช้กับ identity, navigation, primary action และ current selection ส่วนพื้นงานใช้ slate-neutral ที่อ่านง่าย

### Primary

- **Lampang Authority Blue**: ใช้กับปุ่มหลัก, active state, link สำคัญ, และ item ที่เลือกอยู่ ค่านี้มาจาก `brand-primary`
- **Command Navy**: ใช้กับ sidebar, command surfaces, และ dashboard header ที่ต้องการ focus ค่านี้มาจาก `brand-primary-800` และ `brand-primary-900`
- **Action Blue Soft**: ใช้เป็นพื้นหลังของ badge, secondary action, และ selected tint ค่านี้มาจาก `brand-primary-50`

### Secondary

- **Inspection Sky**: ใช้กับสถานะข้อมูลทั่วไปหรือกำลังตรวจ ค่านี้มาจาก `info` และ `info-soft`
- **Route Green**: ใช้กับผ่านการตรวจ, สำเร็จ, ใช้งานได้ ค่านี้มาจาก `success` และ `success-soft`
- **Document Amber**: ใช้กับรอตรวจ, ต้องแก้ไข, เตือนก่อน action ค่านี้มาจาก `warning` และ `warning-soft`
- **Safety Red**: ใช้กับไม่ผ่าน, หมดอายุ, หยุดใช้งาน, หรือ action เสี่ยง ค่านี้มาจาก `danger` และ `danger-soft`

### Neutral

- **Work Surface**: พื้นหลังแอปหลักสำหรับหน้าทำงาน ค่านี้มาจาก `surface-app`
- **Raised Paper**: พื้นของ card, navbar, dropdown, modal และเอกสารตรวจ ค่านี้มาจาก `surface-raised`
- **Quiet Divider**: เส้นแบ่งและ border ของ surface ค่านี้มาจาก `surface-border`
- **Readable Ink**: ข้อความหลัก หัวข้อ และข้อมูลสำคัญ ค่านี้มาจาก `ink-primary`
- **Muted Ink**: ข้อความรอง คำอธิบาย และ metadata ค่านี้มาจาก `ink-muted`

### Named Rules

**The Safety Beats Brand Rule.** สี brand ใช้เพื่อบอก current task และ primary action เท่านั้น ถ้าสถานะ safety ขัดกับสี brand ให้สถานะ safety ชนะเสมอ

**The Light Work Surface Rule.** ฟอร์ม ตาราง checklist เอกสารพิมพ์ และหน้าที่ใช้ตรวจรายละเอียดต้องอยู่บนพื้นสว่าง ห้ามใช้ dark dashboard กับงานอ่านเอกสารยาว

**The No Color-Only Status Rule.** สถานะต้องมีข้อความหรือไอคอนประกอบเสมอ สีเป็นตัวเร่งการรับรู้ ไม่ใช่ข้อมูลเดียว

## 3. Typography

**Display Font:** Sarabun, sans-serif  
**Body Font:** Sarabun, sans-serif  
**Label/Mono Font:** Sarabun, sans-serif

**Character:** Typography ใช้ family เดียวเพื่อความเป็นระบบราชการที่อ่านง่ายและไม่ฟุ้ง ความแตกต่างเกิดจากน้ำหนัก ขนาด และระยะห่าง ไม่ใช่การเปลี่ยนฟอนต์เพื่อความสวย

### Hierarchy

- **Display** (700, 1.5rem, 1.25): ใช้กับหัวหน้าหลักของหน้า dashboard หรือ command surface เท่านั้น
- **Headline** (700, 1.25rem, 1.35): ใช้กับหัวหน้า section ใหญ่ เช่น queue, สรุปสถานะ, ใบส่งตรวจ
- **Title** (700, 1.125rem, 1.4): ใช้กับหัวข้อ card, modal, drawer, และกลุ่มข้อมูล
- **Body** (400, 0.875rem, 1.5): ใช้กับข้อความทั่วไป รายละเอียดฟอร์ม และคำอธิบาย ความยาว prose ควรอยู่ที่ 65 ถึง 75 ตัวอักษรต่อบรรทัดเมื่อเป็นข้อความอธิบาย
- **Label** (600, 0.75rem, 1.35, letter-spacing 0.02em): ใช้กับ label, badge, metadata, และหัวตาราง หลีกเลี่ยง uppercase ภาษาไทยแบบยืด tracking

### Named Rules

**The One Thai UI Voice Rule.** ใช้ Sarabun เป็นฟอนต์เดียวทั้งระบบ ห้ามใช้ display font แปลก ๆ กับ label, button, table หรือข้อมูลรถ

**The Small Text Must Survive Sunlight Rule.** ข้อความรองห้ามอ่อนกว่า `ink-muted` บนพื้นสว่าง และต้องมี contrast พออ่านบนมือถือกลางแจ้ง

## 4. Elevation

ระบบใช้ tonal layering เป็นหลักและใช้ shadow เบาเพื่อแยกชั้นของ card, dropdown, และ floating menu เท่านั้น พื้นหลักเป็น `surface-app`, surface ที่มีข้อมูลอยู่บน `surface-raised`, และเส้นแบ่งใช้ `surface-border` Shadow ต้องทำให้เข้าใจชั้นข้อมูล ไม่ใช่ทำให้ card ลอยเป็น decoration

### Shadow Vocabulary

- **Soft Card** (`0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)`): ใช้กับ card ปกติ เช่น `AppCard`
- **Elevated Popover** (`0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.04)`): ใช้กับ dropdown, menu, และ popover ที่อยู่เหนือ content

### Named Rules

**The Flat-Until-Needed Rule.** Surface ปกติใช้ border และ background ก่อนใช้ shadow Shadow ปรากฏเมื่อมี layer ซ้อนหรือ interaction เท่านั้น

**The No Ghost Card Rule.** ห้ามจับคู่ border บางกับ shadow ใหญ่เพื่อสร้าง card ตกแต่ง ถ้าเป็น card ข้อมูลให้ใช้ border + soft shadow ตาม token เท่านั้น

## 5. Components

### Buttons

- **Shape:** มุมโค้งปานกลางและชัดเจน (8px) ปุ่มใน mobile ต้องมีพื้นที่สัมผัสอย่างน้อย 44 x 44px
- **Primary:** พื้น `brand-primary-600`, ข้อความ `surface-raised`, padding 8px 16px ใช้กับ action ที่ทำให้ workflow เดินหน้า เช่น สร้างใบส่งตรวจ ยืนยันข้อมูลพร้อมพิมพ์ บันทึกผลตรวจ
- **Hover / Focus:** hover ใช้สีเข้มขึ้นหรือพื้น tint สั้น ๆ 150 ถึง 250ms, focus ต้องมี ring หรือ border shift ที่เห็นได้ชัด
- **Secondary / Ghost:** ใช้พื้นขาวหรือโปร่งใส พร้อม border `surface-border` สำหรับย้อนกลับ รีเฟรช เปิดรายละเอียด หรือ action รอง
- **Disabled / Loading:** ลด opacity ได้ แต่ต้องยังอ่าน label ได้ ห้ามซ่อน label เหลือแค่ spinner

### Chips

- **Style:** badge ใช้ `rounded-full`, font 11 ถึง 14px, สีพื้น soft และตัวอักษรสี semantic เข้ม
- **State:** สถานะ `success`, `warn`, `danger`, `info`, `neutral`, `brand` ต้องมีคำภาษาไทยกำกับ เช่น ผ่าน ต้องแก้ไข ไม่ผ่าน กำลังตรวจ
- **Usage:** ใช้กับ status, scope, role, และ count สั้น ๆ ไม่ใช้เป็น paragraph container

### Cards / Containers

- **Corner Style:** card หลักใช้มุม 16px (`rounded-2xl`), panel ย่อยใช้ 12px หรือ 8px ตามความหนาแน่น
- **Background:** card ใช้ `surface-raised`, app canvas ใช้ `surface-app`
- **Shadow Strategy:** card ปกติใช้ Soft Card, menu และ dropdown ใช้ Elevated Popover
- **Border:** ใช้ `surface-border` เพื่อแยกชั้นข้อมูลบนพื้นขาว
- **Internal Padding:** card ใหญ่ใช้ 24px, card compact ใช้ 16px, mobile ใช้ 12 ถึง 16px

### Inputs / Fields

- **Style:** input ใช้พื้นขาวหรือพื้น surface, border `surface-border`, radius 8px หรือ 12px
- **Focus:** focus ต้องเปลี่ยน border เป็น `brand-primary-600` หรือแสดง ring ที่ contrast ชัด
- **Error / Disabled:** error ใช้ `danger` พร้อมข้อความอธิบาย Disabled ต้องบอกเหตุผลถ้า action ถูกปิดเพราะ role หรือสถานะ workflow

### Navigation

- **Desktop sidebar:** พื้น `brand-primary-800`, text ขาวและ blue tint, active item เป็นพื้นขาวพร้อม text `brand-primary-800`
- **Top navbar:** พื้น `surface-raised` แบบโปร่งเล็กน้อยพร้อม backdrop blur ใช้เฉพาะ navbar ไม่ใช้เป็น glassmorphism ทั่วระบบ
- **Mobile drawer:** sidebar เปิดจากซ้าย 200ms และปิดเมื่อเปลี่ยน route
- **Mobile bottom nav:** พื้นขาว, icon 24px, active ใช้ `brand-primary-700`, label สั้นและอ่านได้

### Signature Component

**Vehicle Verification Packet.** หน้าส่งตรวจรถต้องทำงานเหมือนเอกสารออนไลน์: สรุปรถ, จำนวนผู้โดยสารแยกโรงเรียน, QR สำหรับขนส่ง, และปุ่มพิมพ์ต้องชัดเจน โหมด print ต้องลด shadow/border ที่ไม่จำเป็น และรักษาความชัดเจนเมื่อพิมพ์ขาวดำ

## 6. Do's and Don'ts

### Do:

- **Do** ใช้ Hybrid ตามลักษณะงาน: dashboard และ command center ใช้โทนเข้มได้ แต่ฟอร์ม ตาราง checklist เอกสาร และหน้าพิมพ์ต้องใช้พื้นสว่าง
- **Do** ทำให้สถานะปัจจุบัน ความเสี่ยง และ action ถัดไปอยู่เหนือ fold โดยเฉพาะหน้าคนขับ โรงเรียน และขนส่ง
- **Do** ใช้ semantic status พร้อมข้อความหรือไอคอน ไม่ใช้สีเพียงอย่างเดียว
- **Do** ใช้ motion 150 ถึง 250ms เพื่อบอก state change, drawer, dropdown, loading skeleton, หรือเปิดรายละเอียด
- **Do** รองรับ `prefers-reduced-motion` โดยลด animation เหลือ transition สั้นหรือแสดงผลทันที
- **Do** รักษาพื้นที่สัมผัสอย่างน้อย 44 x 44px สำหรับ mobile และหน้าคนขับ
- **Do** ออกแบบ print state สำหรับเอกสารตรวจรถให้ชัดในขาวดำ

### Don't:

- **Don't** ใช้ภาพลักษณ์แบบเกม คริปโต หรือ cyberpunk
- **Don't** ใช้แสงนีออน กระจกเบลอ หรือเอฟเฟกต์เคลื่อนไหวต่อเนื่องจนรบกวนการอ่าน
- **Don't** ทำให้ dashboard มืดจนใช้งานกลางแจ้งไม่ได้
- **Don't** ซ่อนงานหลักไว้หลัง animation หรือ interaction ที่ผู้ใช้ต้องค้นหาเอง
- **Don't** ใช้ motion เพื่อความสวยเพียงอย่างเดียว
- **Don't** ลดความชัดเจนของฟอร์ม ตาราง เอกสารพิมพ์ และข้อความด้านความปลอดภัย
- **Don't** ใช้ border-left หรือ border-right หนากว่า 1px เป็นแถบสีตกแต่งบน alert หรือ card การเตือนควรใช้ icon, semantic background, full border, และข้อความชัดเจนแทน
- **Don't** ใช้ gradient text, card กระจกเบลอ, shadow ใหญ่, หรือ card มุมโค้งเกิน 16px สำหรับงานระบบ
