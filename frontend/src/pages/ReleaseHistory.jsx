import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ReleaseVersion from '../components/ReleaseVersion';
const releases = [
  { version: '2.2.1', date: '18 พฤศจิกายน 2569', groups: 'โรงเรียน · ครูขอบเขตสายชั้น', items: [
    'หน้าเช็กชื่อย้อนหลังเพิ่มปุ่มปรับเวลาทั้งสายชั้นหรือเฉพาะห้อง เลือกวันที่และรอบก่อนปรับได้เช่นเดียวกับวันปกติ',
    'แก้เฉพาะเวลารายการที่บันทึกแล้ว เก็บวันเดิมและสถานะลา/มาเอง/กลับเอง ไม่สร้างรายการใหม่และไม่ส่ง LINE ย้อนหลัง',
    'หากรายการเปลี่ยนหรือเวลาไม่เรียงตามรับ–ส่ง ระบบไม่เปลี่ยนเวลาทั้งชุด และเก็บประวัติเวลาเดิม/ใหม่พร้อมผู้แก้โดยอัตโนมัติ',
  ] },
  { version: '2.2.0', date: '18 พฤศจิกายน 2569', groups: 'ทุกสิทธิ์ · คนขับ · โรงเรียน', items: [
    'หน้าตรวจรถแจ้งปัญหาบัญชีหรือการเชื่อมต่อตั้งแต่เปิดหน้า ระงับการบันทึกจนตรวจสอบได้ พร้อมแสดงชื่อผู้ใช้และปุ่มตรวจสอบอีกครั้ง',
    'เพิ่มประวัติการอัปเดตและวิธีแจ้งปัญหา กดอ่านได้จากเลขรุ่นหรือเมนูบัญชี',
    'หน้านโยบายแยกสถานะร่างและรายการที่รอหน่วยงานยืนยัน โดยไม่เปิดบันทึกการยอมรับทางกฎหมาย',
    'ป้องกันคนขับบันทึกลาในรอบวันนี้ที่นักเรียนไม่ได้ใช้รถ หรือมีรายการเช็กชื่อแล้ว',
    'หน้าเกิดข้อผิดพลาดแยกปัญหาโหลดไฟล์หน้าเว็บ พร้อมรหัสแจ้งปัญหาและคำเตือนเรื่องข้อมูลที่ยังไม่บันทึก',
  ], next: 'คนขับที่เข้าไม่ได้ให้แจ้งชื่อผู้ใช้/ทะเบียน ข้อความ และเวลาแก่โรงเรียน ไม่ส่งรหัสผ่าน ไม่ต้องสร้างบัญชีซ้ำ' },
  { version: '2.1.0', date: '17 พฤศจิกายน 2569', groups: 'ทุกสิทธิ์ · โรงเรียน/ครูสายชั้น · สังกัด', items: [
    'รหัสชั่วคราวคนขับแสดงค้างจนกดปิด พร้อมปุ่มคัดลอก หลังรีเซ็ตโดยโรงเรียนหรือสังกัด',
    'ปรับเวลาเช็กชื่อพร้อมกันแจ้งรายการที่เวลาขัดกัน แก้แล้วลองใหม่ได้ โดยยังตรวจลำดับรับ–ส่ง',
    'ชี้แจงว่าคำขอกู้รหัสยังไม่เปลี่ยนรหัสเดิม และออกจากหน้าเปลี่ยนรหัสเพื่อเปลี่ยนบัญชีได้',
    'ลดรายการภาพรวมที่แสดงเริ่มต้น แยกข้อมูลรอติดตาม และไม่นับกลุ่มไม่มีรถเป็นรถจริง',
    'เพิ่มเลขรุ่น วันที่ และรหัสซอร์สที่ใช้สร้างหน้าเว็บ พร้อมประกาศตามสิทธิ์',
  ], next: 'กรณีรหัสชั่วคราวรอบก่อนหาย ให้ผู้มีสิทธิ์รีเซ็ตใหม่และส่งรหัสเป็นการส่วนตัว' },
];
export default function ReleaseHistory() {
  return <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <PageHeader title="ประวัติการอัปเดต" subtitle="สิ่งที่เปลี่ยนในแต่ละรุ่น และสิ่งที่ผู้ใช้ต้องทำต่อ" />
    <ReleaseVersion className="text-ink-muted" />
    <div className="flex flex-wrap gap-2"><Link className="focus-ring inline-flex items-center min-h-[44px] px-3 rounded-lg border border-surface-border text-brand-700" to="/">กลับหน้าหลัก</Link><Link className="focus-ring inline-flex items-center min-h-[44px] px-3 text-brand-700" to="/help">วิธีแจ้งปัญหา</Link></div>
    {releases.map(release => <article key={release.version} className="rounded-2xl border border-surface-border bg-surface-raised p-5 space-y-3">
      <h2 className="text-lg font-bold text-ink">รุ่น {release.version}</h2><p className="text-sm text-ink-muted">{release.date} · {release.groups}</p>
      <ul className="list-disc pl-5 space-y-2 text-sm leading-6 text-ink">{release.items.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="rounded-lg bg-brand-50 p-3 text-sm leading-6 text-ink"><strong>สิ่งที่ควรทำ:</strong> {release.next}</p>
    </article>)}
    <p className="text-sm text-ink-muted">แสดงเฉพาะรุ่นที่มีหลักฐานยืนยัน การอัปเดตโปรแกรมและฉบับนโยบายเป็นคนละรายการ ประวัตินี้ไม่ใช่การขอความยินยอมใหม่</p>
  </main>;
}
