// Which rounds of a report date have not opened yet (Bangkok time), so the
// daily report does not paint a round red, or list it under
// 'จุดที่ต้องติดตาม', before it has had a chance to happen (QA ui-visual-07).
// The evening round opens at 12:00, the same split TeacherCheck uses.

function bangkokNow(now) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const hour = Number(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false })) % 24;
  return { today, hour };
}

/** { morning, evening }: true when that round of `date` (YYYY-MM-DD) has not started. */
export function roundsNotStarted(date, now = new Date()) {
  const { today, hour } = bangkokNow(now);
  if (!date) return { morning: false, evening: false };
  if (date > today) return { morning: true, evening: true };
  if (date === today) return { morning: false, evening: hour < 12 };
  return { morning: false, evening: false };
}
