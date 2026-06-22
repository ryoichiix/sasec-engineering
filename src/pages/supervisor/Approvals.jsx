import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import DashboardShell from '../../components/DashboardShell'
import LeaveQueue from '../../components/LeaveQueue'
import OTRequestsFMContent from '../../components/OTRequestsFMContent'
import AdvanceRequestsFMContent from '../../components/AdvanceRequestsFMContent'
import { useAuth } from '../../contexts/auth-context'

/**
 * Site Incharge's dedicated approval queue — Leave / OT / Advance requests
 * pending their review. Moved out of SupervisorDashboard so the dashboard
 * home can stay a quick summary instead of the full queues.
 */
export default function Approvals() {
  const { profile } = useAuth()
  const isFM = profile?.field_manager === true

  const [leaveCount, setLeaveCount]     = useState(0)
  const [otCount, setOtCount]           = useState(0)
  const [advanceCount, setAdvanceCount] = useState(0)
  const totalPending = leaveCount + otCount + advanceCount

  // Not a Site Incharge — this page has nothing to show them.
  if (profile && !isFM) return <Navigate to="/supervisor" replace />

  return (
    <DashboardShell title="Approvals">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold bg-[#0F172A] text-white px-2.5 py-1 rounded-full">Site Incharge</span>
          <span className="text-gray-300">·</span>
          <span className="text-sm text-gray-500">Approval Queue</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Pending Reviews</h1>
        <p className="text-sm text-gray-400 mt-1">
          {totalPending} item{totalPending !== 1 ? 's' : ''} awaiting your approval
        </p>
      </div>

      <LeaveQueue stage="field_manager" onCountChange={setLeaveCount} />
      <OTRequestsFMContent onCountChange={setOtCount} />
      <AdvanceRequestsFMContent onCountChange={setAdvanceCount} />
    </DashboardShell>
  )
}
