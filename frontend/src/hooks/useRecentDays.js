import { useEffect, useState } from 'react';
import api from '../api/axios';
import { todayBangkok } from '../utils/thaiTime';

const WEEKDAY = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/**
 * A row's date as a Bangkok 'YYYY-MM-DD'. A MySQL DATE can arrive either as a
 * bare date or as the UTC instant of Bangkok midnight ('…T17:00:00.000Z' of the
 * previous day), so a full timestamp is re-read in Bangkok time instead of
 * having its first ten characters taken.
 */
function dayKey(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function dayLabel(key, today) {
  if (key === today) return 'วันนี้';
  const [y, m, d] = key.split('-').map(Number);
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function toDays(rows, n) {
  const today = todayBangkok();
  const byKey = new Map();
  for (const r of rows) {
    const key = dayKey(r.date);
    if (key) byKey.set(key, r);
  }
  return [...byKey.keys()].sort().slice(-n).map(key => {
    const r = byKey.get(key);
    const round = v => (v == null || !isFinite(Number(v)) ? null : Math.round(Number(v)));
    return { key, label: dayLabel(key, today), a: round(r.morning_pct), b: round(r.evening_pct), today: key === today };
  });
}

/**
 * The last `n` days that have check-in data, as DayBars rows.
 *
 *  source 'reports'  → /reports/monthly (scoped to the caller: school, grade
 *                      teacher, affiliation). Reads the previous month too when
 *                      this month has fewer than `n` days.
 *  source 'province' → /province/trend (province + admin; province-wide; its
 *                      denominators are TODAY's rider totals).
 *
 * Days without any data are absent from both endpoints, so holidays and
 * weekends simply do not appear.
 */
export default function useRecentDays(source = 'reports', n = 7) {
  const [days, setDays] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        if (source === 'province') {
          const res = await api.get('/province/trend', { params: { days: n + 7 } });
          if (alive) setDays(toDays(Array.isArray(res.data?.data) ? res.data.data : [], n));
          return;
        }
        const month = todayBangkok().slice(0, 7);
        const cur = await api.get('/reports/monthly', { params: { month } });
        let rows = cur.data?.data?.daily_trend || [];
        if (rows.length < n) {
          const prev = await api.get('/reports/monthly', { params: { month: prevMonth(month) } }).catch(() => null);
          rows = [...(prev?.data?.data?.daily_trend || []), ...rows];
        }
        if (alive) setDays(toDays(rows, n));
      } catch {
        if (alive) setDays([]);
      }
    }
    load();
    return () => { alive = false; };
  }, [source, n]);

  return days;
}
