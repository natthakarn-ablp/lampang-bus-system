import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AdminContextProvider } from './hooks/useAdminContext';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { useVisitTracker } from './hooks/useVisitTracker';

// Eager: Login is the entry path for unauthed users. Lazy-loading it would add
// a Suspense flash on first paint for the most common cold-start state.
import Login from './pages/Login';

// Lazy: everything past auth. Chunks are grouped by role so each user only
// downloads what their role uses.
const ChangePassword       = lazy(() => import('./pages/ChangePassword'));
const ParentStatus         = lazy(() => import('./pages/parent/ParentStatus'));
const ParentLink           = lazy(() => import('./pages/parent/ParentLink'));
const VehicleQr            = lazy(() => import('./pages/qr/VehicleQr'));
const AdminVehicleQr       = lazy(() => import('./pages/admin/AdminVehicleQr'));
const DriverConsentForm    = lazy(() => import('./components/consent/DriverConsentForm'));

// Driver
const DriverLayout         = lazy(() => import('./pages/driver/DriverLayout'));
const DriverDashboard      = lazy(() => import('./pages/driver/DriverDashboard'));
const StudentList          = lazy(() => import('./pages/driver/StudentList'));
const EmergencyPage        = lazy(() => import('./pages/driver/EmergencyPage'));
const DriverProfile        = lazy(() => import('./pages/driver/DriverProfile'));
const DriverRosterRequests = lazy(() => import('./pages/driver/DriverRosterRequests'));
const DriverPretrip        = lazy(() => import('./pages/driver/DriverPretrip'));
const DriverPickupMap      = lazy(() => import('./pages/driver/DriverPickupMap'));

// School
const SchoolLayout         = lazy(() => import('./pages/school/SchoolLayout'));
const SchoolDashboard      = lazy(() => import('./pages/school/SchoolDashboard'));
const StudentSearch        = lazy(() => import('./pages/school/StudentSearch'));
const VehicleList          = lazy(() => import('./pages/school/VehicleList'));
const EmergencyList        = lazy(() => import('./pages/school/EmergencyList'));
const SchoolApprovals      = lazy(() => import('./pages/school/SchoolApprovals'));
const SchoolBulkVehicles   = lazy(() => import('./pages/school/SchoolBulkVehicles'));
const SchoolAuditLog       = lazy(() => import('./pages/school/SchoolAuditLog'));
const SchoolPickupMap      = lazy(() => import('./pages/school/SchoolPickupMap'));
const SchoolLiveVehicles   = lazy(() => import('./pages/school/SchoolLiveVehicles'));
const SchoolTeacherAccounts = lazy(() => import('./pages/school/SchoolTeacherAccounts'));

// Affiliation
const AffiliationLayout    = lazy(() => import('./pages/affiliation/AffiliationLayout'));
const AffiliationDashboard = lazy(() => import('./pages/affiliation/AffiliationDashboard'));
const SchoolList           = lazy(() => import('./pages/affiliation/SchoolList'));
const AffStudentSearch     = lazy(() => import('./pages/affiliation/AffStudentSearch'));
const AffVehicleList       = lazy(() => import('./pages/affiliation/AffVehicleList'));
const AffDailyStatus       = lazy(() => import('./pages/affiliation/AffDailyStatus'));
const AffEmergencyList     = lazy(() => import('./pages/affiliation/AffEmergencyList'));
const AffSchoolAccounts    = lazy(() => import('./pages/affiliation/AffSchoolAccounts'));
const AffAuditLog          = lazy(() => import('./pages/affiliation/AffAuditLog'));
const AffiliationLiveVehicles = lazy(() => import('./pages/affiliation/AffiliationLiveVehicles'));
const AffiliationPickupMap   = lazy(() => import('./pages/affiliation/AffiliationPickupMap'));

// Province
const ProvinceLayout       = lazy(() => import('./pages/province/ProvinceLayout'));
const ProvinceDashboard    = lazy(() => import('./pages/province/ProvinceDashboard'));
const ProvAffiliationList  = lazy(() => import('./pages/province/ProvAffiliationList'));
const ProvSchoolList       = lazy(() => import('./pages/province/ProvSchoolList'));
const ProvStudentSearch    = lazy(() => import('./pages/province/ProvStudentSearch'));
const ProvVehicleList      = lazy(() => import('./pages/province/ProvVehicleList'));
const ProvDailyStatus      = lazy(() => import('./pages/province/ProvDailyStatus'));
const ProvEmergencyList    = lazy(() => import('./pages/province/ProvEmergencyList'));
const ProvAuditLog         = lazy(() => import('./pages/province/ProvAuditLog'));
const ProvinceLiveVehicles = lazy(() => import('./pages/province/ProvinceLiveVehicles'));
const ProvincePickupMap    = lazy(() => import('./pages/province/ProvincePickupMap'));

// Reports (charts-heavy — own chunk per page)
const ReportsLayout        = lazy(() => import('./pages/reports/ReportsLayout'));
const DailyReport          = lazy(() => import('./pages/reports/DailyReport'));
const MonthlyReport        = lazy(() => import('./pages/reports/MonthlyReport'));
const SummaryReport        = lazy(() => import('./pages/reports/SummaryReport'));

// Transport
const TransportLayout      = lazy(() => import('./pages/transport/TransportLayout'));
const TransportDashboard   = lazy(() => import('./pages/transport/TransportDashboard'));
const TransportVehicleList = lazy(() => import('./pages/transport/TransportVehicleList'));
const InspectionForm       = lazy(() => import('./pages/transport/InspectionForm'));
const TransportPickupMap   = lazy(() => import('./pages/transport/TransportPickupMap'));

// Admin (heaviest cluster — research/measurement/executive)
const UserManagement       = lazy(() => import('./pages/admin/UserManagement'));
const StudentTransferRequests = lazy(() => import('./pages/admin/StudentTransferRequests'));
const VehicleRequests      = lazy(() => import('./pages/admin/VehicleRequests'));
const DriverIntegrity      = lazy(() => import('./pages/admin/DriverIntegrity'));
const AdminAuditLog        = lazy(() => import('./pages/admin/AdminAuditLog'));
const AdminPickupPointManagement = lazy(() => import('./pages/admin/AdminPickupPointManagement'));
const AdminDashboard       = lazy(() => import('./pages/admin/AdminDashboard'));
const MeasurementFramework = lazy(() => import('./pages/admin/MeasurementFramework'));
const ResearchMetrics      = lazy(() => import('./pages/admin/ResearchMetrics'));
const ResearchExport       = lazy(() => import('./pages/admin/ResearchExport'));
const EvaluationDashboard  = lazy(() => import('./pages/admin/EvaluationDashboard'));
const ExecutiveSummary     = lazy(() => import('./pages/admin/ExecutiveSummary'));
const ExecutivePrint       = lazy(() => import('./pages/admin/ExecutivePrint'));
const SystemHealth         = lazy(() => import('./pages/admin/SystemHealth'));
const AdminLiveVehicles    = lazy(() => import('./pages/admin/AdminLiveVehicles'));

export const ROLE_HOME = {
  driver:      '/driver',
  school:      '/school',
  affiliation: '/affiliation',
  province:    '/province',
  transport:   '/transport',
  admin:       '/admin',
};

// ── PrivateRoute: redirects to /login if not authenticated ───────────────────
function PrivateRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) return <RouteFallback />;
  if (!user)   return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <Lock className="w-12 h-12 mx-auto mb-4 text-ink-muted" strokeWidth={1.6} />
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

// ── Suspense fallback for lazy-loaded routes ────────────────────────────────
function RouteFallback() {
  return <div className="flex items-center justify-center h-screen text-ink-muted">กำลังโหลด…</div>;
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
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />

          {/* Driver module */}
          <Route
            path="/driver"
            element={
              <PrivateRoute allowedRoles={['driver']}>
                <DriverLayout />
              </PrivateRoute>
            }
          >
            <Route index           element={<DriverDashboard />} />
            <Route path="roster"    element={<StudentList />} />
            <Route path="emergency" element={<EmergencyPage />} />
            <Route path="profile"   element={<DriverProfile />} />
            <Route path="leaves"    element={<Navigate to="/driver" replace />} />
            <Route path="requests"    element={<DriverRosterRequests />} />
            <Route path="pretrip"     element={<DriverPretrip />} />
            <Route path="pickup-map"  element={<DriverPickupMap />} />
          </Route>

          {/* School module */}
          <Route
            path="/school"
            element={
              <PrivateRoute allowedRoles={['school', 'admin']}>
                <SchoolLayout />
              </PrivateRoute>
            }
          >
            <Route index               element={<SchoolDashboard />} />
            <Route path="students"     element={<StudentSearch />} />
            <Route path="vehicles"     element={<VehicleList />} />
            <Route path="status"       element={<Navigate to="/school" replace />} />
            <Route path="emergencies"  element={<EmergencyList />} />
            <Route path="missing"      element={<Navigate to="/school" replace />} />
            <Route path="approvals"    element={<SchoolApprovals />} />
            <Route path="bulk-vehicles" element={<SchoolBulkVehicles />} />
            <Route path="audit-log"    element={<SchoolAuditLog />} />
            <Route path="pickup-map"   element={<SchoolPickupMap />} />
            <Route path="live-vehicles" element={<SchoolLiveVehicles />} />
            <Route path="teacher-accounts" element={<SchoolTeacherAccounts />} />
          </Route>

          {/* Affiliation module */}
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
            <Route path="accounts"    element={<AffSchoolAccounts />} />
            <Route path="audit-log"   element={<AffAuditLog />} />
            <Route path="live-vehicles" element={<AffiliationLiveVehicles />} />
            <Route path="pickup-map"  element={<AffiliationPickupMap />} />
          </Route>

          {/* Province module */}
          <Route
            path="/province"
            element={
              <PrivateRoute allowedRoles={['province', 'admin']}>
                <ProvinceLayout />
              </PrivateRoute>
            }
          >
            <Route index               element={<ProvinceDashboard />} />
            <Route path="affiliations" element={<ProvAffiliationList />} />
            <Route path="schools"      element={<ProvSchoolList />} />
            <Route path="students"     element={<ProvStudentSearch />} />
            <Route path="vehicles"     element={<ProvVehicleList />} />
            <Route path="status"       element={<ProvDailyStatus />} />
            <Route path="emergencies"  element={<ProvEmergencyList />} />
            <Route path="audit-log"    element={<ProvAuditLog />} />
            <Route path="live-vehicles" element={<ProvinceLiveVehicles />} />
            <Route path="pickup-map"   element={<ProvincePickupMap />} />
          </Route>

          {/* Reports module */}
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

          {/* Transport module */}
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
            <Route path="pickup-map"  element={<TransportPickupMap />} />
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
          <Route path="/admin/transfer-requests" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><StudentTransferRequests /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/vehicle-requests" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><VehicleRequests /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/driver-integrity" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><DriverIntegrity /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/vehicle-qr" element={
            <PrivateRoute allowedRoles={['admin', 'transport']}>
              <Layout><AdminVehicleQr /></Layout>
            </PrivateRoute>
          } />
          <Route path="/driver/consent" element={
            <PrivateRoute allowedRoles={['driver']}>
              <div className="p-4 max-w-md mx-auto"><DriverConsentForm /></div>
            </PrivateRoute>
          } />
          <Route path="/admin/pickup-points" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><AdminPickupPointManagement /></Layout>
            </PrivateRoute>
          } />
          <Route path="/admin/live-vehicles" element={
            <PrivateRoute allowedRoles={['admin']}>
              <Layout><AdminLiveVehicles /></Layout>
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

          {/* Vehicle QR — public scan page (Level-1; escalates to Level-2 in LINE) */}
          <Route path="/qr/:token" element={<VehicleQr />} />

          {/* Parent status — standalone (LIFF / LINE webview) */}
          <Route path="/parent" element={<ParentStatus />} />
          <Route path="/parent/link" element={<ParentLink />} />
          {/* LIFF launcher defense — the bot composes `liff.line.me/<ID>/link`
              which LINE rewrites by appending `/link` to whatever LIFF
              Endpoint URL the operator set in Developers Console. The two
              redirects below let the bind page load correctly regardless of
              whether Endpoint = `/parent` (intended), `/parent/link`, or `/`. */}
          <Route path="/parent/link/link" element={<Navigate to="/parent/link" replace />} />
          <Route path="/link" element={<Navigate to="/parent/link" replace />} />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </ToastProvider>
      </AdminContextProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
