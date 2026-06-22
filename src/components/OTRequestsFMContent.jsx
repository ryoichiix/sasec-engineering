import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import { fetchPendingOtForFM, approveFMOt, rejectFMOt } from '../lib/ot'
import { formatDate } from '../lib/dates'
import QueueSectionHeader, { QueueEmptyState } from './QueueSectionHeader'

/**
 * Field Manager's OT review queue.
 * Shows attendance rows with ot_status='pending_field_manager'.
 * FM can approve (→ pending_boss) or reject (→ rejected + hours zeroed).
 */
export default function OTRequestsFMContent({ onCountChange }) {
  const { user } = useAuth()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [busy, setBusy]     = useState({})

  useEffect(() => {
    let alive = true
    fetchPendingOtForFM().then(({ data, error: err }) => {
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
    const fn = action === 'approve' ? approveFMOt : rejectFMOt
    const { error: err } = await fn(id, user.id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== id))
  }

  return (
    <div>
      <QueueSectionHeader title="OT Requests" count={loading ? 0 : rows.length} />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm text-gray-400">
          Loading OT requests…
        </div>
      ) : rows.length === 0 ? (
        <QueueEmptyState text="No pending requests" />
      ) : (
        rows.map((r) => {
          const isBusy = !!busy[r.id]
          const name = r.worker_name || 'Unnamed worker'
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-3 hover:shadow-md transition-shadow">
              <div className="px-5 pt-4 pb-3 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{name}</span>
                    <span className="text-xs text-gray-400">{formatDate(r.attendance_date)}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-semibold text-gray-900">{r.ot_hours} OT hrs</span>
                    {' · '}by {r.supervisor_name}
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 bg-amber-50 text-amber-700 border-amber-200">
                  OT
                </span>
              </div>

              <div className="px-5 pb-4 flex gap-2 items-center">
                <button
                  onClick={() => decide(r.id, 'approve')}
                  disabled={isBusy}
                  className="flex-1 bg-[#0F172A] hover:bg-gray-800 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60"
                >
                  {isBusy ? 'Saving…' : 'Approve → send to Director'}
                </button>
                <button
                  onClick={() => decide(r.id, 'reject')}
                  disabled={isBusy}
                  className="px-4 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
