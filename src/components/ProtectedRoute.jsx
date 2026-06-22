import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/auth-context'
import { roleHome } from '../lib/roles'
import NoProfile from './NoProfile'

export default function ProtectedRoute({ allowedRoles, children }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!profile) return <NoProfile />

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={roleHome(profile.role)} replace />
  }

  return children
}
