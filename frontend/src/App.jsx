import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';

import Login            from './pages/Login';
import DriverLayout     from './pages/driver/DriverLayout';
import DriverDashboard  from './pages/driver/DriverDashboard';
import StudentList      from './pages/driver/StudentList';
import EmergencyPage    from './pages/driver/EmergencyPage';

// ── PrivateRoute: redirects to /login if not authenticated ───────────────────
function PrivateRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">กำลังโหลด…</div>;
  if (!user)   return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <div className="p-8 text-red-600">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</div>;
  }
  return children;
}

// ── Role-based redirect after login ─────────────────────────────────────────
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" replace />;

  const roleHome = {
    driver:      '/driver',
    school:      '/school',       // Phase 3
    affiliation: '/district',     // Phase 4
    province:    '/central',      // Phase 4
    transport:   '/transport',    // Phase 5
    admin:       '/central',
  };
  return <Navigate to={roleHome[user.role] || '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/*
           * Driver module — nested routes with <Outlet />.
           * DriverLayout renders <Layout><Outlet /></Layout>.
           * Each child Route swaps only the main content area.
           */}
          <Route
            path="/driver"
            element={
              <PrivateRoute allowedRoles={['driver']}>
                <DriverLayout />
              </PrivateRoute>
            }
          >
            <Route index        element={<DriverDashboard />} />
            <Route path="roster"    element={<StudentList />} />
            <Route path="emergency" element={<EmergencyPage />} />
          </Route>

          {/* Phase 3+ routes will be added here */}

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
