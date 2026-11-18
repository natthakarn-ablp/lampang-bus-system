import { ChevronDown, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import ReleaseVersion from './ReleaseVersion';

export function releaseAudience(role, gradeScope) {
  if (role === 'school' && gradeScope) return { title: 'ครูขอบเขตสายชั้น',
    message: `ปรับเวลาเช็กชื่อพร้อมกันได้ทุกห้องหรือเฉพาะห้องในสายชั้น ${gradeScope} ที่รับผิดชอบ และเลือกการลาทั้งวันให้เชื่อมถึงรอบกลับได้` };
  const audiences = {
    school: { title: 'บัญชีโรงเรียน', message: 'เลือกสายชั้น แล้วปรับเวลาเช็กชื่อพร้อมกันได้ทั้งสายชั้นหรือเฉพาะห้อง พร้อมเลือกการลาทั้งวันให้เชื่อมถึงรอบกลับ' },
    driver: { title: 'ผู้ขับรถ', message: 'เมื่อโรงเรียนหรือครูบันทึกลาทั้งวัน สถานะลาจะครอบคลุมทั้งรอบเช้าและรอบกลับ กรุณาตรวจสถานะนักเรียนในรอบที่รับ–ส่งตามข้อมูลจริง' },
    parent: { title: 'ผู้ปกครอง', message: 'เมื่อโรงเรียนหรือครูบันทึกลาทั้งวัน สถานะลาของบุตรหลานจะครอบคลุมทั้งรอบเช้าและรอบกลับ หากลาเพียงบางช่วง กรุณาแจ้งรอบให้โรงเรียนทราบ' },
    affiliation: { title: 'สังกัด', message: 'ใช้รูปแบบการบันทึกใหม่ในการติดตามข้อมูลโรงเรียนและแนะนำผู้ใช้งานในสังกัด ตามขอบเขตที่รับผิดชอบ' },
    province: { title: 'จังหวัด', message: 'ใช้รูปแบบการบันทึกใหม่ในการติดตามการเช็กชื่อและการลาของโรงเรียน ตามขอบเขตที่รับผิดชอบ' },
    transport: { title: 'ขนส่ง', message: 'รับทราบรูปแบบการลาทั้งวันและการปรับเวลา เพื่อประสานงานกับโรงเรียนและผู้ขับรถตามขอบเขตที่รับผิดชอบ' },
    admin: { title: 'ผู้ดูแลระบบ', message: 'ใช้รายละเอียดการอัปเดตนี้แนะนำบัญชีโรงเรียนและครู ตรวจสอบประวัติการแก้เวลา และติดตามข้อมูลตามสิทธิ์ที่มีอยู่' },
  };
  return audiences[role] || null;
}

export default function ReleaseUpdateNotice({ role, gradeScope = null, className = '' }) {
  const audience = releaseAudience(role, gradeScope);
  if (!audience) return null;
  return <aside aria-label="ข่าวอัปเดตระบบ" className={`rounded-xl border border-brand-200 bg-brand-50 text-ink ${className}`}>
    <details className="group">
      <summary className="focus-ring flex min-h-[48px] cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <Megaphone className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-brand-800">อัปเดตระบบ · รุ่น {__RELEASE_VERSION__} · {__RELEASE_DATE__}</span>
        <span className="text-sm text-brand-700">อ่านรายละเอียด</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-brand-700 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 border-t border-brand-200 px-4 py-4 text-sm leading-6">
        <ReleaseVersion className="text-ink-muted" />
        <section aria-label="ปรับปรุงการใช้งานรุ่นใหม่" className="space-y-2">
          <h2 className="font-semibold">สิ่งที่เปลี่ยนในรุ่นนี้</h2>
          {role === 'school' && <p>หน้าเช็กชื่อย้อนหลัง: เลือกวันที่และรอบ แล้วปรับเวลาทั้งสายชั้นหรือเฉพาะห้องได้ แก้เฉพาะรายการที่บันทึกแล้ว คงสถานะลา/มาเอง/กลับเอง และไม่ส่ง LINE ย้อนหลัง</p>}
          <p>รุ่น 2.2.0: เพิ่มประวัติการอัปเดตและวิธีแจ้งปัญหาในเมนูบัญชี หน้าตรวจรถจะหยุดและแจ้งบัญชีที่มีปัญหาตั้งแต่เปิดหน้า ส่วนหน้านโยบายแยกสิ่งที่รอหน่วยงานยืนยันชัดเจนขึ้น</p>
          <Link to="/updates" className="focus-ring inline-flex items-center min-h-[44px] px-3 rounded-lg border border-brand-200 font-semibold text-brand-700">อ่านประวัติการอัปเดตทั้งหมด</Link>
          <p>ทุกบัญชี: หน้าลืมรหัสชี้แจงว่าคำขอยังไม่เปลี่ยนรหัสเดิม พร้อมวิธีขอความช่วยเหลือเมื่อไม่ผูก LINE หน้าเปลี่ยนรหัสบังคับออกจากระบบเพื่อเปลี่ยนบัญชีได้</p>
          {['school', 'affiliation', 'admin'].includes(role) && <p>ผู้จัดการบัญชีรถ: หลังรีเซ็ตรหัสคนขับ หน้าต่างรหัสชั่วคราวจะค้างจนกดปิด กรุณาคัดลอกส่งให้คนขับเป็นการส่วนตัว</p>}
          {role === 'school' && <p>โรงเรียนและครูสายชั้น: ปรับเวลาพร้อมกันจะแจ้งรายการและช่วงเวลาที่ขัดกัน แก้แล้วลองใหม่ได้ ภาพรวมแยกผู้ยังไม่ผูกรถออกจากยอดรอเช็กชื่อ</p>}
          {['school', 'affiliation', 'province', 'admin', 'transport'].includes(role) && <p>หน้าภาพรวม: แสดงงานหลักก่อน รายละเอียดงานอนุมัติและรายการเพิ่มเติมเปิดดูได้ตามสิทธิ์เดิม ไม่มีการเพิ่มสิทธิ์หรือเปลี่ยนข้อมูลย้อนหลัง</p>}
        </section>
        <div>
          <h2 className="font-semibold text-brand-800">สำหรับ{audience.title}</h2>
          <p>{audience.message}</p>
        </div>
        <p className="rounded-lg border border-brand-200 bg-surface-raised p-3">รุ่นนี้ไม่เปลี่ยนข้อมูลการเช็กชื่อหรือรายการลาเดิมย้อนหลัง หากพบปัญหาให้ใช้ชื่อบัญชี รหัสปัญหา และเลขรุ่นในการแจ้งผู้ประสานงาน</p>
        {role === 'school' && <Link to="/school/teacher-check" className="focus-ring inline-flex min-h-[44px] items-center rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800">ไปหน้าเช็กชื่อวันนี้</Link>}
      </div>
    </details>
  </aside>;
}
