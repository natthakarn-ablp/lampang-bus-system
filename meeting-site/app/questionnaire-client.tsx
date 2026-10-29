"use client";

import { FormEvent, useState } from "react";

const formVersion = "short-5-20261021";
const organizations = [
  "สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 1",
  "สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 2",
  "สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 3",
  "สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาลำปาง ลำพูน",
  "สำนักงานศึกษาธิการจังหวัดลำปาง",
  "สำนักงานขนส่งจังหวัดลำปาง",
  "สำนักงานป้องกันและบรรเทาสาธารณภัยจังหวัดลำปาง",
  "สำนักงานส่งเสริมการปกครองท้องถิ่นจังหวัดลำปาง",
  "สำนักงานพระพุทธศาสนาจังหวัดลำปาง",
  "ผู้แทนครูและคณะทำงาน",
  "ทีมหน่วยงานสนับสนุน",
  "องค์กรสมาชิกและภาคีเครือข่าย",
];
const participationOptions = ["เสนอปัญหาหรือความต้องการ", "ทดลองใช้หรือดูการสาธิตระบบ", "เสนอแนวทางปรับปรุง", "ร่วมพิจารณาข้อสรุป", "รับผิดชอบนำไปดำเนินการต่อ"];
const benefitItems = ["ช่วยครูและโรงเรียนดูแลการรับ–ส่งนักเรียน", "ช่วยเจ้าหน้าที่ตรวจรถและติดตามความปลอดภัย", "ช่วยหน่วยงานต่าง ๆ ประสานงานกัน"];
const ratingOptions = [[5, "มากที่สุด"], [4, "มาก"], [3, "ปานกลาง"], [2, "น้อย"], [1, "น้อยที่สุด"], [0, "ยังประเมินไม่ได้"]] as const;
const priorityOptions = ["ขั้นตอนใช้งานให้ง่ายขึ้น", "ชื่อเมนูและคำอธิบายให้เข้าใจง่าย", "ตัวหนังสือและปุ่มให้ใหญ่ขึ้น", "ข้อมูลและรายงานให้ชัดเจนขึ้น", "ความเร็วในการใช้งาน", "ยังไม่พบเรื่องที่ต้องปรับ", "ยังไม่ได้ทดลองใช้"];

const initial = { organization: "", participation: [] as string[], benefits: ["", "", ""] as string[], priority: "", suggestion: "", website: "" };

export default function ShortQuestionnaire() {
  const [form, setForm] = useState(initial);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);

  function toggleParticipation(value: string) {
    setForm(current => ({ ...current, participation: current.participation.includes(value) ? current.participation.filter(item => item !== value) : [...current.participation, value] }));
  }
  function setBenefit(index: number, value: string) {
    setForm(current => ({ ...current, benefits: current.benefits.map((item, itemIndex) => itemIndex === index ? value : item) }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!form.organization) return setMessage("กรุณาเลือกหน่วยงานของท่าน");
    if (form.benefits.some(value => value === "")) return setMessage("กรุณาเลือกคำตอบในแต่ละด้าน หรือเลือก ‘ยังประเมินไม่ได้’");
    if (!form.priority) return setMessage("กรุณาเลือกเรื่องที่อยากให้ปรับก่อน");
    setSending(true);
    try {
      const response = await fetch("/api/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formVersion, ...form }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
      setCompleted(true);
      setForm(initial);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSending(false);
    }
  }

  if (completed) return <main className="shortPage"><section className="thankYou"><span>✓</span><p className="eyebrow dark">บันทึกคำตอบแล้ว</p><h1>ขอบคุณที่ร่วมประเมิน</h1><p>คำตอบของท่านจะนำไปใช้สรุปภาพรวมเพื่อปรับปรุงระบบ โดยไม่ขอชื่อหรือข้อมูลส่วนบุคคล</p><button onClick={() => setCompleted(false)}>ตอบแบบประเมินอีกชุด</button></section></main>;

  return <main className="shortPage">
    <header className="shortHeader"><div className="shortBrand"><span>SB</span><div><b>School Bus Lampang</b><small>แบบประเมินระบบรถรับส่งนักเรียน</small></div></div><div className="shortIntro"><p className="eyebrow">แบบประเมินฉบับสั้น · 5 ข้อ</p><h1>ช่วยบอกเราว่า<br/><em>ระบบควรดีขึ้นอย่างไร</em></h1><p>ใช้เวลาประมาณ 2 นาที ไม่ต้องระบุชื่อบุคคล และเลือก “ยังประเมินไม่ได้” ได้หากยังไม่เห็นข้อมูลเพียงพอ</p></div></header>
    <form className="shortForm" onSubmit={submit}>
      <ShortQuestion number="1" title="ท่านเป็นตัวแทนหน่วยงานใด?">
        <select value={form.organization} onChange={event => setForm(current => ({ ...current, organization: event.target.value }))}>
          <option value="">เลือกหน่วยงาน</option>{organizations.map(organization => <option key={organization}>{organization}</option>)}
        </select>
      </ShortQuestion>
      <ShortQuestion number="2" title="วันนี้ท่านได้ร่วมทำอะไรบ้าง?" hint="เลือกได้มากกว่าหนึ่งข้อ หรือเว้นไว้หากยังไม่ได้ร่วมกิจกรรม">
        <div className="shortChoices">{participationOptions.map(option => <label key={option}><input type="checkbox" checked={form.participation.includes(option)} onChange={() => toggleParticipation(option)}/><span>{option}</span></label>)}</div>
      </ShortQuestion>
      <ShortQuestion number="3" title="จากที่ได้เห็น ระบบนี้มีประโยชน์ในแต่ละด้านเพียงใด?" hint="กรุณาตอบครบทั้ง 3 ด้าน">
        <div className="benefitList">{benefitItems.map((item, index) => <fieldset key={item}><legend>{item}</legend><div className="ratingOptions">{ratingOptions.map(([value, label]) => <label key={label}><input type="radio" name={`benefit-${index}`} value={value} checked={form.benefits[index] === String(value)} onChange={event => setBenefit(index, event.target.value)}/><span>{label}</span></label>)}</div></fieldset>)}</div>
      </ShortQuestion>
      <ShortQuestion number="4" title="ท่านอยากให้ปรับเรื่องใดก่อน?">
        <div className="shortChoices single">{priorityOptions.map(option => <label key={option}><input type="radio" name="priority" checked={form.priority === option} onChange={() => setForm(current => ({ ...current, priority: option }))}/><span>{option}</span></label>)}</div>
      </ShortQuestion>
      <ShortQuestion number="5" title="มีเรื่องใดอยากฝากให้ทีมปรับปรุงอีกไหม?" hint="ไม่บังคับ — พิมพ์สั้น ๆ ได้ หรือเว้นว่าง">
        <textarea maxLength={400} value={form.suggestion} onChange={event => setForm(current => ({ ...current, suggestion: event.target.value }))} placeholder="ข้อเสนอเพิ่มเติม (ถ้ามี)"/>
        <small className="characterCount">{form.suggestion.length}/400</small>
      </ShortQuestion>
      <label className="trap">เว็บไซต์<input tabIndex={-1} autoComplete="off" value={form.website} onChange={event => setForm(current => ({ ...current, website: event.target.value }))}/></label>
      <div className="privacyNote"><b>ก่อนส่งคำตอบ</b><span>กรุณาอย่าใส่ชื่อเด็ก ผู้ปกครอง เบอร์โทร รหัสผ่าน หรือข้อมูลลับในช่องข้อเสนอ</span></div>
      <button className="shortSubmit" disabled={sending}>{sending ? "กำลังส่ง…" : "ส่งคำตอบ"}</button>
      <output className="shortMessage" aria-live="polite">{message}</output>
    </form>
    <footer className="shortFooter"><span>แบบประเมินฉบับ short-5-20261021</span><a href="/secretary">หน้าบันทึกมติสำหรับเลขานุการ →</a></footer>
  </main>;
}

function ShortQuestion({ number, title, hint, children }: { number: string; title: string; hint?: string; children: React.ReactNode }) {
  return <section className="shortQuestion"><div className="shortQuestionTitle"><span>{number}</span><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>;
}
