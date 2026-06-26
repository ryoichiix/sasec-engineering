import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/auth-context'
import ProtectedRoute from './components/ProtectedRoute'
import NoProfile from './components/NoProfile'
import WorkerNotAllowed from './components/WorkerNotAllowed'
import { roleHome } from './lib/roles'
import { ROLES } from './lib/supabase'
import Login from './pages/Login'
// Signup removed — no public registration. All accounts created by Boss.
import BossDashboard from './pages/BossDashboard'
import SupervisorDashboard from './pages/SupervisorDashboard'
import SupervisorAttendance from './pages/SupervisorAttendance'
import BossAttendance from './pages/BossAttendance'
import BossWorkers from './pages/BossWorkers'
// Lazy — pulls in the heavy xlsx parser only when the Boss opens this page.
const BossImportWorkers = lazy(() => import('./pages/BossImportWorkers'))
// Lazy — weight calculator pages pull in xlsx + the extraction client.
const SupervisorWeightCalculations = lazy(() => import('./pages/SupervisorWeightCalculations'))
const SupervisorWeightCalculator = lazy(() => import('./pages/SupervisorWeightCalculator'))
const BossWeightReports = lazy(() => import('./pages/BossWeightReports'))
import SupervisorLeave from './pages/SupervisorLeave'
import BossRequests from './pages/BossRequests'
import TodaysPlan from './pages/supervisor/TodaysPlan'
import BossWorkFeed from './pages/BossWorkFeed'
import BossPayroll from './pages/BossPayroll'
import BossDesignations from './pages/BossDesignations'
import DailyUpdates from './pages/supervisor/DailyUpdates'
import Approvals from './pages/supervisor/Approvals'
import SiteInchargeWorkFeed from './pages/supervisor/SiteInchargeWorkFeed'
import BossAssignments from './pages/BossAssignments'
import BossDevices from './pages/BossDevices'
import BossAdvances from './pages/BossAdvances'
import SupervisorAdvances from './pages/SupervisorAdvances'
import BossWorkerProfile from './pages/BossWorkerProfile'
import BossStaff from './pages/BossStaff'
import BossSupervisors from './pages/BossSupervisors'
import BossExpenses from './pages/BossExpenses'
import BossVehicles from './pages/BossVehicles'
import SupervisorExpenses from './pages/SupervisorExpenses'
import BossForms from './pages/BossForms'
import SupervisorForms from './pages/SupervisorForms'
import Notifications from './pages/Notifications'

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-site-bg">
      <div className="flex flex-col items-center gap-3">
        <img src="/logo.png" alt="SASEC" className="h-14 w-14 object-contain opacity-80" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  )
}

function RootRedirect() {
  const { user, profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-site-bg">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="SASEC" className="h-14 w-14 object-contain opacity-80" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!profile) return <NoProfile />
  // Workers do not have app access — show a friendly screen with sign-out.
  if (profile.role === ROLES.WORKER) return <WorkerNotAllowed />
  return <Navigate to={roleHome(profile.role)} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />

          <Route
            path="/boss"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/supervisors"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossSupervisors />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/attendance"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossAttendance />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/workers"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossWorkers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/workers/:id"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossWorkerProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/import-workers"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <Suspense fallback={<PageFallback />}>
                  <BossImportWorkers />
                </Suspense>
              </ProtectedRoute>
            }
          />
          {/* Merged requests page */}
          <Route
            path="/boss/requests"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossRequests />
              </ProtectedRoute>
            }
          />
          {/* Keep old routes as redirects so any bookmarks / notification links still work */}
          <Route path="/boss/leave" element={<Navigate to="/boss/requests" replace />} />
          <Route path="/boss/ot-requests" element={<Navigate to="/boss/requests" replace />} />
          <Route
            path="/boss/work-feed"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossWorkFeed />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/payroll"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossPayroll />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/designations"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossDesignations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/assignments"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossAssignments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/advances"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossAdvances />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/staff"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossStaff />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/forms"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossForms />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/expenses"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossExpenses />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/vehicles"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossVehicles />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/devices"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <BossDevices />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boss/weight-reports"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS]}>
                <Suspense fallback={<PageFallback />}>
                  <BossWeightReports />
                </Suspense>
              </ProtectedRoute>
            }
          />

          <Route
            path="/supervisor"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SupervisorDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/attendance"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SupervisorAttendance />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/advances"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SupervisorAdvances />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/approvals"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <Approvals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/leave"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SupervisorLeave />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/todays-plan"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <TodaysPlan />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/daily-updates"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <DailyUpdates />
              </ProtectedRoute>
            }
          />
          {/* Old routes kept as redirects so bookmarks / notification links still work */}
          <Route path="/supervisor/work-plan" element={<Navigate to="/supervisor/todays-plan" replace />} />
          <Route
            path="/supervisor/forms"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SupervisorForms />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/expenses"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SupervisorExpenses />
              </ProtectedRoute>
            }
          />
          <Route path="/supervisor/team" element={<Navigate to="/supervisor/todays-plan" replace />} />
          <Route
            path="/supervisor/weight"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <Suspense fallback={<PageFallback />}>
                  <SupervisorWeightCalculations />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/weight/new"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <Suspense fallback={<PageFallback />}>
                  <SupervisorWeightCalculator />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/weight/:id"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <Suspense fallback={<PageFallback />}>
                  <SupervisorWeightCalculator />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor/work-feed"
            element={
              <ProtectedRoute allowedRoles={[ROLES.SUPERVISOR]}>
                <SiteInchargeWorkFeed />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute allowedRoles={[ROLES.BOSS, ROLES.SUPERVISOR]}>
                <Notifications />
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
