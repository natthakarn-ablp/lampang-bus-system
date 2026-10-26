# Task Plan: ปรับแผนดำเนินงานฉบับเต็มหลังตรวจเมนูและงานวิจัย

## Goal

ปรับ Master Project Closure Plan ให้ครอบคลุมการลดความซ้ำซ้อนของเมนู ความถูกต้องเชิงระเบียบวิธี การบริหารแบบมีส่วนร่วม PDPA/UAT และ rollout โดยแยกงานอัตโนมัติ งาน sandbox/external และ human sign-off

## Phases

- [x] Phase 1: ตรวจ Master Plan และผล audit ล่าสุด
- [x] Phase 2: ปรับ phase/dependency/owner/exit gate ฉบับเต็ม
- [x] Phase 3: เพิ่ม menu target, research integrity และ participatory evidence plan
- [x] Phase 4: ตรวจ references, consistency และ secret scan
- [x] Phase 5: commit/push แผนฉบับปรับปรุง

## Key Questions

1. งานวิจัยและ Logic ใดต้อง freeze ก่อนแก้ระบบหรือเก็บ baseline
2. เมนูใดต้องเก็บ รวม ซ่อน หรือ defer โดยไม่ทำลาย backward compatibility
3. หลักฐานใดวัดการมีส่วนร่วมจริง ไม่ใช่เพียงจำนวน login/action
4. งานใด Codex ทำได้ งานใดต้องใช้ sandbox/external service และงานใดต้องมีผู้มีอำนาจลงนาม

## Decisions Made

- ใช้ `docs/role-menu-participatory-research-audit-2026-09-04.md` และหลักฐาน production แบบ read-only เป็นฐาน
- แก้ research integrity ก่อนเริ่มเก็บข้อมูลผลวิจัยรอบใหม่
- ลดเมนูด้วยการรวมทางเข้า/ใช้ tabs/redirect โดยไม่ลบข้อมูลหรือ API ทันที
- ฝัง participation events ใน workflow เดิม ไม่เพิ่มหน้าใหม่หนึ่งหน้าต่อตัวชี้วัด

## Errors Encountered

- เรียกคำสั่งสำรวจครั้งแรกด้วย workdir ผิดและแก้เป็น worktree `grade-abbrev` แล้ว ไม่มีผลต่อไฟล์

## Status

**Complete** - แผนฉบับเต็มผ่านการตรวจและพร้อมจัดเก็บใน repository
