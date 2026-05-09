import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, ClipboardList, AlertTriangle, User } from 'lucide-react';

const DRIVER_TABS = [
  { to: '/driver',           end: true, icon: Home,           label: 'หน้าแรก' },
  { to: '/driver/requests',  end: false, icon: ClipboardList, label: 'คำขอ' },
  { to: '/driver/emergency', end: false, icon: AlertTriangle, label: 'ฉุกเฉิน' },
  { to: '/driver/profile',   end: false, icon: User,          label: 'โปรไฟล์' },
];

// Approx height of the bar (used by overlays like Toast to avoid covering it on mobile).
const BAR_HEIGHT_PX = 60;

export default function MobileBottomNav({ tabs = DRIVER_TABS }) {
  // Expose height to floating elements (Toast etc.) via CSS var, mobile only.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    function apply() {
      if (mq.matches) {
        document.body.style.setProperty('--app-bottom-nav', `${BAR_HEIGHT_PX}px`);
      } else {
        document.body.style.removeProperty('--app-bottom-nav');
      }
    }
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.body.style.removeProperty('--app-bottom-nav');
    };
  }, []);

  return (
    <nav
      className="md:hidden shrink-0 bg-surface-raised border-t border-surface-border pb-[env(safe-area-inset-bottom)]"
      aria-label="เมนูหลัก"
    >
      <ul className="grid grid-cols-4">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition ${
                    isActive ? 'text-brand-700' : 'text-ink-muted hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className="w-6 h-6"
                      strokeWidth={isActive ? 2.4 : 1.8}
                      aria-hidden="true"
                    />
                    <span className="leading-none">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
