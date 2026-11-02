export default function AttendanceBreakdown({ data, monthly = false }) {
  if (!data) return null;
  const value = key => typeof data[key] === 'number' ? data[key].toLocaleString('th-TH') : '—';
  return <section aria-label="แยกการเดินทางและการลา" className="rounded-xl border border-surface-border bg-surface-raised p-4 my-4">
    <h2 className="font-semibold text-ink mb-3">แยกการเดินทางและการลา{monthly ? 'รายเดือน' : ''}</h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {['morning', 'evening'].map(session => <div key={session}>
        <h3 className="font-medium text-ink">{session === 'morning' ? 'เที่ยวเช้า' : 'เที่ยวเย็น'}</h3>
        <dl className="text-sm text-ink-muted space-y-2 mt-2">
          {[['self', session === 'morning' ? 'มาเอง' : 'กลับเอง'], ['leave', 'ลา']].map(([kind, label]) => <div key={kind} className="flex justify-between gap-3">
            <dt>{label}</dt><dd>{value(`${session}_${kind}`)} {monthly ? 'ครั้ง' : 'คน'}{monthly ? ` / ${value(`${session}_${kind}_people`)} คนไม่ซ้ำ` : ''}</dd>
          </div>)}
        </dl>
        {!!data[`${session}_conflict`] && <p role="alert" className="text-sm text-danger-ink mt-2">มีข้อมูลการเดินทางขัดกัน {value(`${session}_conflict`)} รายการ กรุณาตรวจสอบ</p>}
      </div>)}
    </div>
    {monthly && <p className="text-sm text-ink-muted mt-3">รายเดือนนับวันที่มีข้อมูลรับ–ส่ง การเดินทางเอง หรือการลาในขอบเขตนี้</p>}
    <p className="text-sm text-ink-muted mt-3">การเดินทางเองและการลาไม่นับเป็นผู้โดยสารรถ และไม่นับเป็นรายการรอรับ–ส่ง</p>
  </section>;
}
