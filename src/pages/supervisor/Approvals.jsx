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
const TABS = [
  { key: 'leave',    label: 'Leave'    },
  { key: 'ot',       label: 'OT'       },
  { key: 'advances', label: 'Advances' },
]

export default function Approvals() {
  const { profile } = useAuth()
  const isFM = profile?.field_manager === true

  const [activeTab, setActiveTab] = useState('leave')
  const [leaveCount, setLeaveCount]     = useState(0)
  const [otCount, setOtCount]           = useState(0)
  const [advanceCount, setAdvanceCount] = useState(0)
  const totalPending = leaveCount + otCount + advanceCount
  const countByTab = { leave: leaveCount, ot: otCount, advances: advanceCount }

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

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map((tab) => {
          const count = countByTab[tab.key]
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${
                  active ? 'bg-[#C0272D] text-white' : 'bg-gray-300 text-gray-600'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Queues stay mounted (so their own fetch/count logic is untouched) — only visibility toggles */}
      <div className={activeTab === 'leave' ? '' : 'hidden'}>
        <LeaveQueue stage="field_manager" onCountChange={setLeaveCount} />
      </div>
      <div className={activeTab === 'ot' ? '' : 'hidden'}>
        <OTRequestsFMContent onCountChange={setOtCount} />
      </div>
      <div className={activeTab === 'advances' ? '' : 'hidden'}>
        <AdvanceRequestsFMContent onCountChange={setAdvanceCount} />
      </div>
    </DashboardShell>
  )
}
