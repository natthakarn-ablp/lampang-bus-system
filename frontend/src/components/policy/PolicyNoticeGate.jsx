import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../api/axios';

// Notices are fetched from the server, which exposes only approved versions.
// This is an acknowledgement flow, not a consent form or a permission grant.
export default function PolicyNoticeGate({ user, children }) {
  const location = useLocation();
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!user?.id) return undefined;
    api.get('/policy-notices/current')
      .then(({ data }) => {
        if (!active || !data?.data?.enabled) return;
        const pending = data.data.notices.filter((notice) => !notice.acknowledged);
        const unseen = pending.filter((notice) =>
          sessionStorage.getItem(`policy_notice_later:${user.id}:${notice.key}:${notice.version}`) !== '1'
        );
        setQueue(unseen);
      })
      .catch(() => { /* An unavailable notice service must not block emergency work. */ });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  const current = queue[0];
  const emergency = /(^|\/)emergency(\/|$)/.test(location.pathname);

  function next() {
    setError('');
    setQueue((items) => items.slice(1));
  }

  function later() {
    sessionStorage.setItem(`policy_notice_later:${user.id}:${current.key}:${current.version}`, '1');
    next();
  }

  async function acknowledge() {
    if (!current || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/policy-notices/acknowledge', { key: current.key, version: current.version });
      next();
    } catch {
      setError('ยังบันทึกการรับทราบไม่ได้ กรุณาลองอีกครั้งหรืออ่านภายหลัง');
    } finally {
      setBusy(false);
    }
  }

  return <>
    {children}
    {current && !emergency && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5" role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="policy-notice-title"
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-surface-border bg-surface-raised shadow-elevate p-5 sm:p-7">
          <p className="text-xs font-semibold tracking-wide text-brand-700 mb-2">แจ้งการใช้ข้อมูล · ฉบับ {current.version}</p>
          <h2 id="policy-notice-title" className="text-xl font-semibold text-gray-900 mb-3">{current.title}</h2>
          <p className="text-sm leading-7 text-gray-700 whitespace-pre-line">{current.summary}</p>
          <p className="mt-4 text-sm leading-7 text-gray-700 whitespace-pre-line">{current.body}</p>
          <dl className="mt-4 rounded-lg bg-surface p-3 text-xs leading-5 text-gray-700">
            <dt className="font-semibold">ฐานการใช้ข้อมูล</dt><dd>{current.lawfulBasis}</dd>
            <dt className="mt-2 font-semibold">ระยะเวลาเก็บ</dt><dd>{current.retentionRule}</dd>
          </dl>
          <a href={current.fullNoticeUrl} target="_blank" rel="noopener noreferrer"
            className="focus-ring mt-4 inline-block text-sm font-medium text-brand-700 underline underline-offset-2">
            อ่านประกาศฉบับเต็ม
          </a>
          <p className="mt-4 text-xs leading-5 text-ink-muted">การกดรับทราบเป็นเพียงหลักฐานว่าเห็นประกาศ ไม่ใช่การให้ความยินยอม และไม่เปลี่ยนสิทธิ์เข้าถึงข้อมูล</p>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={later} disabled={busy}
              className="focus-ring min-h-[44px] rounded-lg px-4 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50">
              อ่านภายหลัง
            </button>
            <button type="button" onClick={acknowledge} disabled={busy}
              className="focus-ring min-h-[44px] rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? 'กำลังบันทึก…' : 'รับทราบ'}
            </button>
          </div>
        </section>
      </div>
    )}
  </>;
}
