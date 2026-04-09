import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Sidebar from './Sidebar';

export default function Layout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  // Close drawer on route change (mobile nav tap)
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Desktop sidebar (always visible ≥md) ── */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* ── Mobile drawer overlay ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeDrawer}
          />
          {/* Drawer panel */}
          <div className="relative z-50 w-64 h-full animate-slide-in-left">
            <Sidebar onClose={closeDrawer} />
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar (visible <md only) */}
        <header className="md:hidden flex items-center justify-between bg-blue-800 text-white px-4 py-3 shrink-0">
          <button
            onClick={openDrawer}
            className="p-1 -ml-1 rounded-md hover:bg-blue-700 transition"
            aria-label="เปิดเมนู"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold truncate mx-3">ระบบรถรับส่งนักเรียน</span>
          <span className="text-xs text-blue-200 shrink-0">{user?.display_name || user?.username || ''}</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
