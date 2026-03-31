import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';

import Login            from './pages/Login';
import DriverLayout     from './pages/driver/DriverLayout';
import DriverDashboard  from './pages/driver/DriverDashboard';
import StudentList      from './pages/driver/StudentList';
import EmergencyPage    from './pages/driver/EmergencyPage';

import SchoolLayout     from './pages/school/SchoolLayout';
import SchoolDashboard  from './pages/school/SchoolDashboard';
import StudentSearch    from './pages/school/StudentSearch';
import VehicleList      from './pages/school/VehicleList';
import DailyStatus      from './pages/school/DailyStatus';
import EmergencyList    from './pages/school/EmergencyList';

import AffiliationLayout    from './pages/affiliation/AffiliationLayout';
import AffiliationDashboard from './pages/affiliation/AffiliationDashboard';
import SchoolList           from './pages/affiliation/SchoolList';
import AffStudentSearch     from './pages/affiliation/AffStudentSearch';
import AffVehicleList       from './pages/affiliation/AffVehicleList';
import AffDailyStatus       from './pages/affiliation/AffDailyStatus';
import AffEmergencyList     from './pages/affiliation/AffEmergencyList';

import ProvinceLayout       from './pages/province/ProvinceLayout';
import ProvinceDashboard    from './pages/province/ProvinceDashboard';
import ProvAffiliationList  from './pages/province/ProvAffiliationList';
import ProvSchoolList       from './pages/province/ProvSchoolList';
import ProvStudentSearch    from './pages/province/ProvStudentSearch';
import ProvVehicleList      from './pages/province/ProvVehicleList';
import ProvDailyStatus      from './pages/province/ProvDailyStatus';
import ProvEmergencyList    from './pages/province/ProvEmergencyList';

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
    affiliation: '/affiliation',   // Phase 4
    province:    '/province',     // Phase 5
    transport:   '/transport',    // Phase 5
    admin:       '/province',
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

          {/* School module — nested routes with <Outlet /> */}
          <Route
            path="/school"
            element={
              <PrivateRoute allowedRoles={['school']}>
                <SchoolLayout />
              </PrivateRoute>
            }
          >
            <Route index            element={<SchoolDashboard />} />
            <Route path="students"  element={<StudentSearch />} />
            <Route path="vehicles"  element={<VehicleList />} />
            <Route path="status"    element={<DailyStatus />} />
            <Route path="emergencies" element={<EmergencyList />} />
          </Route>

          {/* Affiliation module — nested routes with <Outlet /> */}
          <Route
            path="/affiliation"
            element={
              <PrivateRoute allowedRoles={['affiliation']}>
                <AffiliationLayout />
              </PrivateRoute>
            }
          >
            <Route index              element={<AffiliationDashboard />} />
            <Route path="schools"     element={<SchoolList />} />
            <Route path="students"    element={<AffStudentSearch />} />
            <Route path="vehicles"    element={<AffVehicleList />} />
            <Route path="status"      element={<AffDailyStatus />} />
            <Route path="emergencies" element={<AffEmergencyList />} />
          </Route>

          {/* Province module — nested routes with <Outlet /> */}
          <Route
            path="/province"
            element={
              <PrivateRoute allowedRoles={['province', 'admin']}>
                <ProvinceLayout />
              </PrivateRoute>
            }
          >
            <Route index                element={<ProvinceDashboard />} />
            <Route path="affiliations"  element={<ProvAffiliationList />} />
            <Route path="schools"       element={<ProvSchoolList />} />
            <Route path="students"      element={<ProvStudentSearch />} />
            <Route path="vehicles"      element={<ProvVehicleList />} />
            <Route path="status"        element={<ProvDailyStatus />} />
            <Route path="emergencies"   element={<ProvEmergencyList />} />
          </Route>

          {/* Phase 6+ routes will be added here */}

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
