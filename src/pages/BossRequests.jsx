import { useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import LeaveQueue from '../components/LeaveQueue'
import OTRequestsContent from '../components/OTRequestsContent'
import AdvanceRequestsContent from '../components/AdvanceRequestsContent'

const TABS = [
  { id: 'leave',   label: 'Leave Requests'   },
  { id: 'ot',      label: 'OT Requests'      },
  { id: 'advance', label: 'Advance Requests' },
]

export default function BossRequests() {
  const [tab, setTab] = useState('leave')

  return (
    <DashboardShell title="Requests">
      {/* Tab bar */}
      <div className="flex border-b border-[#E2E8F0] mb-6 gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
              tab === t.id
                ? 'border-[#C0272D] text-[#C0272D] bg-white'
                : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'leave'   && <LeaveQueue stage="boss" />}
      {tab === 'ot'      && <OTRequestsContent />}
      {tab === 'advance' && <AdvanceRequestsContent />}
    </DashboardShell>
  )
}
