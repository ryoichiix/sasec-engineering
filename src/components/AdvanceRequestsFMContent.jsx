import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import {
  fetchPendingAdvancesForFM,
  approveFMAdvance,
  rejectFMAdvance,
  paymentModeLabel,
} from '../lib/advances'
import { formatCurrency } from '../lib/payroll'
import { formatDate } from '../lib/dates'
import { QueueEmptyState } from './QueueSectionHeader'

/**
 * Site Incharge's advance review queue — pending_site_incharge rows.
 * Premium card layout shared visually with the OT and Leave FM queues.
 */
export default function AdvanceRequestsFMContent({ onCountChange }) {
  const { user } = useAuth()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState({})

  useEffect(() => {
    let alive = true
    fetchPendingAdvancesForFM().then(({ data, error: err }) => {
      if (!alive) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setError(null)
      setRows(data || [])
    })
    return () => { alive = false }
  }, [])
  useEffect(() => { onCountChange?.(rows.length) }, [rows.length, onCountChange])

  const decide = async (id, action) => {
    if (!user?.id) return
    setBusy((b) => ({ ...b, [id]: true }))
    const fn = action === 'approve' ? approveFMAdvance : rejectFMAdvance
    const { error: err } = await fn(id, user.id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== id))
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm text-gray-400">
          Loading advance requests…
        </div>
      ) : rows.length === 0 ? (
        <QueueEmptyState text="No pending requests" />
      ) : (
        rows.map((r) => {
          const isBusy = !!busy[r.id]
          const name = r.worker_name || 'Unnamed worker'
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Week of {formatDate(r.week_start)}</p>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 bg-green-50 text-green-700 border-green-200">
                  Advance
                </span>
              </div>

              <p className="text-sm text-gray-600 mb-3">
                <span className="font-semibold text-gray-900">{formatCurrency(r.amount)}</span>
                {' · '}{paymentModeLabel(r.payment_mode)}
                {' · '}by {r.supervisor_name}
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => decide(r.id, 'reject')}
                  disabled={isBusy}
                  className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-60"
                >
                  Reject
                </button>
                <button
                  onClick={() => decide(r.id, 'approve')}
                  disabled={isBusy}
                  className="px-5 py-2 text-sm font-semibold bg-[#0F172A] text-white rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-60"
                >
                  {isBusy ? 'Saving…' : 'Approve → Director'}
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
