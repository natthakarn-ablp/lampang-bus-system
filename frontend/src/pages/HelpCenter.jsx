import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ReleaseVersion from '../components/ReleaseVersion';
import { RECOVERY_CONTACTS } from '../utils/passwordRecovery';
export default function HelpCenter() {
  return <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <PageHeader title="แจ้งปัญหาและขอความช่วยเหลือ" subtitle="เตรียมข้อมูลเท่าที่จำเป็น แล้วแจ้งผู้ประสานงานตามสิทธิ์ของคุณ" />
    <div className="flex flex-wrap gap-2"><Link to="/" className="focus-ring inline-flex items-center min-h-[44px] px-3 rounded-lg border border-surface-border text-brand-700">กลับหน้าหลัก</Link><Link to="/updates" className="focus-ring inline-flex items-center min-h-[44px] px-3 text-brand-700">ประวัติการอัปเดต</Link></div>
    <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 space-y-3">
      <h2 className="text-lg font-bold text-ink">ข้อมูลที่ใช้แจ้งปัญหา</h2>
      <ol className="list-decimal pl-5 space-y-2 text-sm leading-6 text-ink"><li>ชื่อผู้ใช้หรือทะเบียนบัญชี และสิทธิ์ที่กำลังใช้งาน</li><li>หน้าที่เกิดปัญหา สิ่งที่กด และวันเวลาที่เกิด</li><li>ข้อความแจ้งเตือนหรือรหัสปัญหา พร้อมภาพที่ปิดชื่อเด็กและข้อมูลส่วนตัวแล้ว</li><li>เลขรุ่นที่แสดงบนหน้าเว็บ</li></ol>
      <ReleaseVersion className="text-ink-muted" />
      <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn-ink">ไม่ส่งรหัสผ่าน รหัส OTP ลิงก์กู้รหัสที่มี token ข้อมูลเด็ก หรือเบอร์โทรผู้ปกครองในกลุ่มสาธารณะ หน้านี้ไม่ส่งข้อมูลออกให้อัตโนมัติ</p>
    </section>
    <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 space-y-3">
      <h2 className="text-lg font-bold text-ink">ลืมรหัสผ่านหรือยังไม่ผูก LINE</h2>
      <p className="text-sm leading-6 text-ink">กดลืมรหัสเป็นเพียงการขอลิงก์ ยังไม่เปลี่ยนรหัสเดิม หากไม่เคยผูก LINE ให้ติดต่อผู้ดูแลตามรายการด้านล่าง</p>
      <ul className="space-y-2 text-sm text-ink">{RECOVERY_CONTACTS.map(row => <li key={row.key}><strong>{row.label}:</strong> {row.contact}</li>)}</ul>
      <p className="text-sm text-ink">ผู้ปกครองใช้บัญชี LINE หากเข้าไม่ถึงข้อมูลบุตรหลานให้ติดต่อโรงเรียนเพื่อตรวจความสัมพันธ์บัญชี</p>
      <p className="text-sm text-ink">ผู้รีเซ็ตรหัสคนขับต้องคัดลอกรหัสชั่วคราวจากหน้าต่างที่แสดง แล้วส่งให้เจ้าของบัญชีเป็นการส่วนตัว หากปิดไปแล้วดูย้อนหลังไม่ได้ ต้องรีเซ็ตใหม่</p>
      <Link to="/forgot-password" className="focus-ring inline-flex items-center min-h-[44px] px-3 rounded-lg text-brand-700 border border-surface-border">ไปหน้าลืมรหัสผ่าน</Link>
    </section>
    <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 space-y-3">
      <h2 className="text-lg font-bold text-ink">แจ้งว่าบัญชีผูกกับรถหลายคัน</h2>
      <p className="text-sm leading-6 text-ink">แจ้งชื่อผู้ใช้/ทะเบียนจริง ภาพข้อความ และเวลาแก่ครูผู้ประสานงานหรือผู้ดูแล ไม่ต้องรีเซ็ตรหัสหรือสร้างบัญชีใหม่เพื่อแก้ข้อความนี้ และอย่าตัดการผูกรถเอง รถหนึ่งคันที่รับนักเรียนหลายโรงเรียนเป็นคนละกรณีกับโปรไฟล์คนขับที่ผูกหลายคัน</p>
      <p className="text-sm leading-6 text-ink">หากยังบันทึกตรวจรถไม่ได้ ให้ตรวจรถจริงและจดผลพร้อมเวลาไว้ การเห็นหน้ารายการตรวจไม่ถือว่าระบบบันทึกสำเร็จ</p>
    </section>
    <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 space-y-2"><h2 className="text-lg font-bold text-ink">ช่องทางติดต่อและนโยบาย</h2><p className="text-sm leading-6 text-ink">ติดต่อครูหรือเจ้าหน้าที่ผู้ประสานงานของโรงเรียน/หน่วยงานผ่านช่องทางที่ใช้งานอยู่ ระบบยังไม่แสดงอีเมลหรือโทรศัพท์กลางจนกว่าหน่วยงานจะยืนยัน</p><p className="text-sm text-ink-muted">ชื่อผู้ควบคุมข้อมูล ช่องทางใช้สิทธิ ฐานการใช้ข้อมูลและระยะเวลาเก็บ ยังต้องได้รับการยืนยันจากหน่วยงานก่อนเผยแพร่ฉบับจริง</p></section>
  </main>;
}
