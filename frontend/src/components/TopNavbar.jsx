import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, ChevronDown, LogOut, KeyRound, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getGradeScope } from '../utils/authScope';
import api from '../api/axios';
import { PulseDot } from '../lib/motion';

const ROLE_LABEL = {
  driver:      'คนขับรถ',
  school:      'โรงเรียน',
  affiliation: 'สังกัด',
  province:    'จังหวัด',
  transport:   'ขนส่ง',
  admin:       'ผู้ดูแลระบบ',
};

// What slice of the data this account can see. Shown in the top bar so a
// province user and a school user can tell their context apart at a glance —
// the sidebar no longer repeats the account name.
const SCOPE_LABEL = {
  PROVINCE:    'ขอบเขตจังหวัด',
  AFFILIATION: 'ขอบเขตสังกัด',
  SCHOOL:      'ขอบเขตโรงเรียน',
};

/**
 * Close a dropdown on outside click AND on Escape, returning focus to its
 * trigger so keyboard users are not stranded at the end of the header.
 */
function useDismissable(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, setOpen, ref]);
}

export default function TopNavbar({ onOpenDrawer, onToggleSidebar, sidebarCollapsed = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const isAdmin = user?.role === 'admin';

  // Pending-requests bell (admin only) — aggregates transfer + vehicle + roster.
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const [pending, setPending] = useState({ total: 0, student_transfer: 0, vehicle: 0, roster: 0 });

  useDismissable(menuOpen, setMenuOpen, menuRef);
  useDismissable(bellOpen, setBellOpen, bellRef);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    const load = () => api.get('/admin/pending-requests-count')
      .then(r => { if (alive) setPending(r.data.data || { total: 0 }); })
      .catch(() => { /* non-blocking */ });
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [isAdmin]);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  const displayName = user?.display_name || user?.username || '';
  const initial = displayName.charAt(0).toUpperCase();
  // scope_type is 'SCHOOL' for a full school account AND for a homeroom-teacher
  // sub-account, so this badge told a teacher their scope was the whole school —
  // the opposite of what it is, in the one spot whose job is to state the scope.
  // grade_scope is the only field that separates them.
  const teacherGrade = getGradeScope(user);
  const scopeLabel = teacherGrade
    ? `ขอบเขตสายชั้น ${teacherGrade}`
    : (user?.scope_type ? SCOPE_LABEL[user.scope_type] : null);

  return (
    <header className="sticky top-0 z-sticky h-topbar shrink-0 bg-surface-raised/90 backdrop-blur border-b border-surface-border">
      <div className="h-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenDrawer}
          className="focus-ring md:hidden inline-flex items-center justify-center w-11 h-11 -ml-1 rounded-lg text-ink-muted hover:bg-surface hover:text-ink active:bg-surface-border transition"
          aria-label="เปิดเมนู"
        >
          <Menu className="w-5 h-5" strokeWidth={2} />
        </button>

        {/* Desktop: collapse the sidebar to an icon rail */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="focus-ring hidden md:inline-flex items-center justify-center w-11 h-11 -ml-1 rounded-lg text-ink-muted hover:bg-surface hover:text-ink active:bg-surface-border transition"
            aria-label={sidebarCollapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
            aria-pressed={sidebarCollapsed}
          >
            {sidebarCollapsed
              ? <PanelLeftOpen className="w-5 h-5" strokeWidth={2} />
              : <PanelLeftClose className="w-5 h-5" strokeWidth={2} />}
          </button>
        )}

        <div className="md:hidden flex flex-col leading-tight min-w-0 flex-1">
          <span className="text-sm font-bold text-ink truncate">ระบบรถรับส่งนักเรียน</span>
          <span className="text-[11px] text-ink-muted truncate">จังหวัดลำปาง</span>
        </div>

        {/* Data scope — the top bar's job, not the sidebar's */}
        {scopeLabel && (
          <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-navy-50 text-navy-700 text-xs font-medium">
            {scopeLabel}
          </span>
        )}

        <div className="hidden md:block flex-1" />

        {isAdmin ? (
          <div className="relative shrink-0" ref={bellRef}>
            <button
              type="button"
              onClick={() => setBellOpen(o => !o)}
              className="focus-ring hidden sm:inline-flex items-center justify-center w-11 h-11 rounded-lg text-ink-muted hover:bg-surface hover:text-ink active:bg-surface-border transition relative"
              aria-label="การแจ้งเตือนคำขอที่รอดำเนินการ"
              aria-haspopup="menu"
              aria-expanded={bellOpen}
            >
              <Bell className="w-5 h-5" strokeWidth={2} />
              {pending.total > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold inline-flex items-center justify-center">
                  {pending.total > 9 ? '9+' : pending.total}
                  <PulseDot color="bg-danger" size="sm" className="-top-1 -right-1" />
                </span>
              )}
            </button>
            {bellOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-64 z-modal origin-top-right rounded-xl bg-surface-raised border border-surface-border shadow-elevate animate-fade-in-up overflow-hidden">
                <div className="px-4 py-2.5 border-b border-surface-border text-xs font-semibold text-ink-muted">คำขอที่รอดำเนินการ</div>
                {[
                  { label: 'คำขอโอนย้ายนักเรียน', n: pending.student_transfer, to: '/admin/transfer-requests' },
                  { label: 'คำขอเกี่ยวกับรถ', n: pending.vehicle, to: '/admin/vehicle-requests' },
                  { label: 'คำขอปรับรายชื่อ/รถ', n: pending.roster, to: '/admin' },
                ].map(item => (
                  <button
                    key={item.to}
                    role="menuitem"
                    onClick={() => { setBellOpen(false); navigate(item.to); }}
                    className="focus-ring w-full flex items-center justify-between gap-2 px-4 py-2.5 min-h-[44px] text-sm text-ink hover:bg-surface active:bg-surface-border transition"
                  >
                    <span>{item.label}</span>
                    <span className={`min-w-[20px] text-center text-xs font-semibold px-1.5 py-0.5 rounded-full ${item.n > 0 ? 'bg-brand-50 text-brand-700' : 'text-ink-muted'}`}>{item.n}</span>
                  </button>
                ))}
                {pending.total === 0 && <div className="px-4 py-3 text-xs text-ink-muted text-center">ไม่มีคำขอค้าง</div>}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="focus-ring hidden sm:inline-flex items-center justify-center w-11 h-11 rounded-lg text-ink-muted hover:bg-surface hover:text-ink active:bg-surface-border transition relative"
            aria-label="การแจ้งเตือน"
          >
            <Bell className="w-5 h-5" strokeWidth={2} />
          </button>
        )}

        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            className="focus-ring flex items-center gap-1.5 sm:gap-2 pl-1 pr-1.5 sm:pr-2 py-1 rounded-lg hover:bg-surface active:bg-surface-border transition min-h-[44px]"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="w-8 h-8 rounded-full bg-navy-700 text-white text-sm font-semibold inline-flex items-center justify-center shrink-0">
              {initial}
            </span>
            <span className="hidden sm:flex flex-col items-start leading-tight max-w-[140px]">
              <span className="text-sm font-semibold text-ink truncate w-full text-left">{displayName}</span>
              {user?.role && <span className="text-[11px] text-ink-muted">{ROLE_LABEL[user.role] || user.role}</span>}
            </span>
            <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 z-modal origin-top-right rounded-xl bg-surface-raised border border-surface-border shadow-elevate animate-fade-in-up overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-surface-border">
                <p className="text-sm font-semibold text-ink truncate">{displayName}</p>
                {user?.username && user.username !== displayName && (
                  <p className="text-xs text-ink-muted truncate">@{user.username}</p>
                )}
              </div>
              <button
                role="menuitem"
                onClick={() => { setMenuOpen(false); navigate('/change-password'); }}
                className="focus-ring w-full flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-sm text-ink hover:bg-surface active:bg-surface-border transition"
              >
                <KeyRound className="w-4 h-4 text-ink-muted" strokeWidth={2} />
                เปลี่ยนรหัสผ่าน
              </button>
              <button
                role="menuitem"
                onClick={handleLogout}
                className="focus-ring w-full flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-sm text-danger-ink hover:bg-danger-soft active:bg-danger-soft transition"
              >
                <LogOut className="w-4 h-4" strokeWidth={2} />
                ออกจากระบบ
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
