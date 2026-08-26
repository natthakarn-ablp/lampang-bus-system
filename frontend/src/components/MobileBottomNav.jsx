import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, AlertTriangle, User, FileCheck2, GraduationCap } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

// The driver bottom bar is the PRIMARY surface for elderly / low-tech drivers
// (the hamburger sidebar is rarely opened). When the consolidated
// "รายชื่อเด็กในรถ" is enabled, the middle tab leads there — the actual driver
// task — instead of the inspection-status page (which moves to the sidebar).
function driverTabs(features) {
  const reg = features && features.driverRegistration;
  return [
    { to: '/driver',           end: true,  icon: Home,          label: 'หน้าแรก' },
    reg
      ? { to: '/driver/vehicle-registration', end: false, icon: GraduationCap, label: 'รายชื่อเด็ก' }
      : { to: '/driver/applications',         end: false, icon: FileCheck2,    label: 'ขึ้นทะเบียน' },
    { to: '/driver/emergency', end: false, icon: AlertTriangle, label: 'ฉุกเฉิน' },
    { to: '/driver/profile',   end: false, icon: User,          label: 'โปรไฟล์' },
  ];
}

// Approx height of the bar (used by overlays like Toast to avoid covering it on
// mobile). 60px keeps every tab at or above the 44px WCAG 2.2 target size.
const BAR_HEIGHT_PX = 60;

export default function MobileBottomNav({ tabs }) {
  const { features } = useAuth();
  const resolvedTabs = tabs || driverTabs(features);
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
      className="md:hidden shrink-0 bg-surface-raised border-t border-surface-border pb-safe"
      aria-label="เมนูหลัก"
    >
      <ul className="grid grid-cols-4">
        {resolvedTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `focus-ring relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] py-2 text-caption transition ${
                    isActive ? 'text-brand-700 font-semibold' : 'text-ink-muted hover:text-ink active:text-brand-700'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active tab carries a top accent as well as colour, so
                        the state does not rely on hue alone. */}
                    {isActive && (
                      <span className="absolute top-0 inset-x-3 h-0.5 rounded-b bg-brand-600" aria-hidden="true" />
                    )}
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
