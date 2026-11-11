import { ShieldCheck, ExternalLink } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { AppCard } from '../../components/ui';

// ลิงก์ไปยังระบบประเมินการเดินทางที่ปลอดภัยของเด็กนักเรียน (เว็บไซต์ภายนอก).
// หน้านี้แค่พาไปยังแบบประเมิน — ระบบนี้ไม่ส่งข้อมูลใด ๆ ไปยังเว็บไซต์นั้น.
export const SAFE_TRAVEL_URL = 'https://tcc-safe-travel.web.app/';

export default function SchoolSafeTravelAssessment() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <PageHeader
        icon={ShieldCheck}
        title="ประเมินการเดินทางปลอดภัย"
        subtitle="ระบบประเมินการเดินทางที่ปลอดภัยของเด็กนักเรียน"
      />

      <AppCard padding="lg">
        <div className="space-y-4">
          <p className="text-ink">
            ให้โรงเรียนเข้าไปประเมินการเดินทางของนักเรียนใน
            <strong> ระบบประเมินการเดินทางที่ปลอดภัยของเด็กนักเรียน </strong>
            ตามแบบประเมินและคำชี้แจงบนเว็บไซต์ เพื่อให้เห็นความเสี่ยงและแนวทางดูแลให้นักเรียนเดินทางไป–กลับโรงเรียนอย่างปลอดภัย
          </p>

          <ol className="list-decimal pl-5 space-y-1 text-sm text-ink">
            <li>กดปุ่ม “เปิดแบบประเมิน” ด้านล่าง (เปิดในแท็บใหม่)</li>
            <li>อ่านคำชี้แจงบนเว็บไซต์ แล้วกรอกข้อมูลตามความเป็นจริงของโรงเรียน</li>
            <li>ส่งแบบประเมินให้ครบตามขั้นตอนของเว็บไซต์</li>
          </ol>

          <a
            href={SAFE_TRAVEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex w-full sm:w-auto items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-medium px-5 min-h-[48px] rounded-lg transition"
          >
            เปิดแบบประเมิน
            <ExternalLink className="w-4 h-4" strokeWidth={2.2} aria-hidden="true" />
            <span className="sr-only">(เปิดในแท็บใหม่)</span>
          </a>

          <p className="text-xs text-ink-muted break-all">
            เว็บไซต์ภายนอก: {SAFE_TRAVEL_URL} — ระบบรถรับส่งนักเรียนไม่ได้ส่งข้อมูลนักเรียนไปยังเว็บไซต์นี้
          </p>
        </div>
      </AppCard>
    </div>
  );
}
