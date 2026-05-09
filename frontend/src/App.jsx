import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AdminContextProvider } from './hooks/useAdminContext';
import { ToastProvider } from './components/Toast';

import Login            from './pages/Login';
import ChangePassword   from './pages/ChangePassword';
import DriverLayout     from './pages/driver/DriverLayout';
import DriverDashboard  from './pages/driver/DriverDashboard';
import StudentList      from './pages/driver/StudentList';
import EmergencyPage    from './pages/driver/EmergencyPage';
import DriverProfile    from './pages/driver/DriverProfile';
import DriverRosterRequests from './pages/driver/DriverRosterRequests';
import DriverPretrip    from './pages/driver/DriverPretrip';

import SchoolLayout     from './pages/school/SchoolLayout';
import SchoolDashboard  from './pages/school/SchoolDashboard';
import StudentSearch    from './pages/school/StudentSearch';
import VehicleList      from './pages/school/VehicleList';
import EmergencyList    from './pages/school/EmergencyList';
import SchoolApprovals  from './pages/school/SchoolApprovals';
import SchoolBulkVehicles from './pages/school/SchoolBulkVehicles';
import SchoolAuditLog from './pages/school/SchoolAuditLog';

import AffiliationLayout    from './pages/affiliation/AffiliationLayout';
import AffiliationDashboard from './pages/affiliation/AffiliationDashboard';
import SchoolList           from './pages/affiliation/SchoolList';
import AffStudentSearch     from './pages/affiliation/AffStudentSearch';
import AffVehicleList       from './pages/affiliation/AffVehicleList';
import AffDailyStatus       from './pages/affiliation/AffDailyStatus';
import AffEmergencyList     from './pages/affiliation/AffEmergencyList';
import AffSchoolAccounts   from './pages/affiliation/AffSchoolAccounts';
import AffAuditLog         from './pages/affiliation/AffAuditLog';

import ProvinceLayout       from './pages/province/ProvinceLayout';
import ProvinceDashboard    from './pages/province/ProvinceDashboard';
import ProvAffiliationList  from './pages/province/ProvAffiliationList';
import ProvSchoolList       from './pages/province/ProvSchoolList';
import ProvStudentSearch    from './pages/province/ProvStudentSearch';
import ProvVehicleList      from './pages/province/ProvVehicleList';
import ProvDailyStatus      from './pages/province/ProvDailyStatus';
import ProvEmergencyList    from './pages/province/ProvEmergencyList';
import ProvAuditLog        from './pages/province/ProvAuditLog';

import TransportLayout     from './pages/transport/TransportLayout';
import TransportDashboard  from './pages/transport/TransportDashboard';
import TransportVehicleList from './pages/transport/TransportVehicleList';
import InspectionForm      from './pages/transport/InspectionForm';

import ParentStatus from './pages/parent/ParentStatus';
import UserManagement from './pages/admin/UserManagement';
import AdminAuditLog from './pages/admin/AdminAuditLog';
import AdminDashboard from './pages/admin/AdminDashboard';
import MeasurementFramework from './pages/admin/MeasurementFramework';
import ResearchMetrics from './pages/admin/ResearchMetrics';
import ResearchExport from './pages/admin/ResearchExport';
import EvaluationDashboard from './pages/admin/EvaluationDashboard';
import ExecutiveSummary from './pages/admin/ExecutiveSummary';
import ExecutivePrint from './pages/admin/ExecutivePrint';
import SystemHealth from './pages/admin/SystemHealth';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { useVisitTracker } from './hooks/useVisitTracker';

export const ROLE_HOME = {
  driver:      '/driver',
  school:      '/school',
  affiliation: '/affiliation',
  province:    '/province',
  transport:   '/transport',
  admin:       '/admin',
};

import ReportsLayout  from './pages/reports/ReportsLayout';
import DailyReport    from './pages/reports/DailyReport';
import MonthlyReport  from './pages/reports/MonthlyReport';
import SummaryReport  from './pages/reports/SummaryReport';

// ── PrivateRoute: redirects to /login if not authenticated ───────────────────
function PrivateRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">กำลังโหลด…</div>;
  if (!user)   return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <p className="text-4xl mb-4">🔒</p>
          <h1 className="text-xl font-bold text-gray-800 mb-2">ไม่มีสิทธิ์เข้าถึง</h1>
          <p className="text-gray-600 mb-6">คุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณากลับไปหน้าหลักของคุณ</p>
          <button onClick={() => window.location.href = '/'}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl transition">
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    );
  }
  return children;
}

// ── VisitTracker: fires once per browser tab session ────────────────────────
function VisitTracker() {
  useVisitTracker();
  return null;
}

// ── Role-based redirect after login ─────────────────────────────────────────
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" replace />;

  return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <VisitTracker />
      <AdminContextProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />

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
            <Route path="profile"  element={<DriverProfile />} />
            <Route path="leaves"   element={<Navigate to="/driver" replace />} />
            <Route path="requests" element={<DriverRosterRequests />} />
            <Route path="pretrip"  element={<DriverPretrip />} />
          </Route>

          {/* School module — nested routes with <Outlet /> */}
          <Route
            path="/school"
            element={
              <PrivateRoute allowedRoles={['school', 'admin']}>
                <SchoolLayout />
              </PrivateRoute>
            }
          >
            <Route index            element={<SchoolDashboard />} />
            <Route path="students"  element={<StudentSearch />} />
            <Route path="vehicles"  element={<VehicleList />} />
            <Route path="status"    element={<Navigate to="/school" replace />} />
            <Route path="emergencies" element={<EmergencyList />} />
            <Route path="missing"     element={<Navigate to="/school" replace />} />
            <Route path="approvals"   element={<SchoolApprovals />} />
            <Route path="bulk-vehicles" element={<SchoolBulkVehicles />} />
            <Route path="audit-log" element={<SchoolAuditLog />} />
          </Route>

          {/* Affiliation module — nested routes with <Outlet /> */}
          <Route
            path="/affiliation"
            element={
              <PrivateRoute allowedRoles={['affiliation', 'admin']}>
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
            <Route path="accounts"   element={<AffSchoolAccounts />} />
            <Route path="audit-log"  element={<AffAuditLog />} />
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
            <Route path="audit-log"     element={<ProvAuditLog />} />
          </Route>

          {/* Reports module — shared across school/affiliation/province */}
          <Route
            path="/reports"
            element={
              <PrivateRoute allowedRoles={['school', 'affiliation', 'province', 'admin']}>
                <ReportsLayout />
              </PrivateRoute>
            }
          >
            <Route index          element={<DailyReport />} />
            <Route path="daily"   element={<DailyReport />} />
            <Route path="monthly" element={<MonthlyReport />} />
            <Route path="summary" element={<SummaryReport />} />
          </Route>

          {/* Transport module — vehicle inspections */}
          <Route
            path="/transport"
            element={
              <PrivateRoute allowedRoles={['transport', 'admin']}>
                <TransportLayout />
              </PrivateRoute>
            }
          >
            <Route index             element={<TransportDashboard />} />
            <Route path="vehicles"   element={<TransportVehicleList />} />
            <Route path="inspections" element={<InspectionForm />} />
          </Route>

          {/* Admin pages */}
          <Route path="/admin" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><AdminDashboard /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/users" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><UserManagement /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/audit-logs" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><AdminAuditLog /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/measurement" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><MeasurementFramework /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/research" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><ResearchMetrics /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/research-export" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><ResearchExport /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/evaluation" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><EvaluationDashboard /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/executive" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><ExecutiveSummary /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/system-health" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><SystemHealth /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/executive-print" element={
            <PrivateRoute allowedRoles={['admin']}>
              <ExecutivePrint />
            </PrivateRoute>
          } />

          {/* Parent status — standalone page, no auth needed (LIFF / LINE) */}
          <Route path="/parent" element={<ParentStatus />} />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
      </AdminContextProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
