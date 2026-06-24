import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopNavbar from './TopNavbar';

export default function Layout({ children, bottomNav = null }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div
      className="flex h-screen overflow-hidden bg-surface"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Desktop sidebar (≥md) */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={closeDrawer} />
          <div
            className="relative z-50 w-[82vw] max-w-[300px] min-w-[260px] h-full animate-slide-in-left"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <Sidebar onClose={closeDrawer} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNavbar onOpenDrawer={openDrawer} />
        <main className="flex-1 overflow-y-auto bg-surface">
          {/* App-wide route transition: content fades in on navigation. Keyed by
              pathname so each route re-triggers; reduced-motion users get it
              instantly (motion-safe + the global prefers-reduced-motion rule). */}
          <div key={location.pathname} className="motion-safe:animate-fade-in">
            {children}
          </div>
        </main>
        {bottomNav}
      </div>
    </div>
  );
}
