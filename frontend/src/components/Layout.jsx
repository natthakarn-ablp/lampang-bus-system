import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopNavbar from './TopNavbar';
import ResponsiveDrawer from './ui/ResponsiveDrawer';

const COLLAPSE_KEY = 'sidebar:collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    // Private mode / storage disabled — fall back to expanded.
    return false;
  }
}

export default function Layout({ children, bottomNav = null }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch { /* ignore quota / privacy-mode errors */ }
  }, [collapsed]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleCollapsed = useCallback(() => setCollapsed(c => !c), []);

  return (
    <div
      className="flex h-screen overflow-hidden bg-surface"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Desktop sidebar (≥md) — collapses to a 72px icon rail */}
      <div className="hidden md:flex">
        <Sidebar collapsed={collapsed} />
      </div>

      {/* Mobile drawer — dialog semantics, Escape, focus trap, scroll lock */}
      <ResponsiveDrawer open={drawerOpen} onClose={closeDrawer} title="เมนูหลัก">
        <Sidebar onClose={closeDrawer} />
      </ResponsiveDrawer>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopNavbar
          onOpenDrawer={openDrawer}
          onToggleSidebar={toggleCollapsed}
          sidebarCollapsed={collapsed}
        />
        {/* The single page-level scroll container. Pages must not add their
            own full-height scrollers on top of this one. */}
        <main className="app-scrollbar scrollbar-gutter-stable flex-1 overflow-y-auto overscroll-contain bg-surface">
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
