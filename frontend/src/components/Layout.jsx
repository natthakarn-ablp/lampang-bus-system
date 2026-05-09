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
    <div className="flex h-screen overflow-hidden bg-surface" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Desktop sidebar (≥md) */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={closeDrawer} />
          <div className="relative z-50 w-64 h-full animate-slide-in-left">
            <Sidebar onClose={closeDrawer} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNavbar onOpenDrawer={openDrawer} />
        <main className="flex-1 overflow-y-auto bg-surface">
          {children}
        </main>
        {bottomNav}
      </div>
    </div>
  );
}
