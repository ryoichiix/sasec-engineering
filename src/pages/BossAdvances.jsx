import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import AdvancesList from '../components/AdvancesList'
import { supabase } from '../lib/supabase'

export default function BossAdvances() {
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    let isMounted = true
    supabase
      .from('weekly_advances')
      .select('id', { count: 'exact', head: true })
      .eq('advance_status', 'pending_boss')
      .then(({ count }) => {
        if (!isMounted) return
        setPendingCount(count || 0)
      })
    return () => { isMounted = false }
  }, [])

  return (
    <DashboardShell title="Advances" accent="bg-rose-500">
      <div className="space-y-6">
        {pendingCount > 0 && (
          <div className="bg-sky-50 border border-sky-200 rounded-lg px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-sky-900">
              <span className="font-semibold">{pendingCount}</span> advance request{pendingCount === 1 ? '' : 's'} waiting for your approval.
            </p>
            <Link
              to="/boss/requests"
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 text-white"
            >
              Review in Requests
            </Link>
          </div>
        )}

        <AdvancesList scope="all" />
      </div>
    </DashboardShell>
  )
}
