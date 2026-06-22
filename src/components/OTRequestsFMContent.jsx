import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import { fetchPendingOtForFM, approveFMOt, rejectFMOt } from '../lib/ot'
import { formatDate } from '../lib/dates'

/**
 * Field Manager's OT review queue.
 * Shows attendance rows with ot_status='pending_field_manager'.
 * FM can approve (→ pending_boss) or reject (→ rejected + hours zeroed).
 */
export default function OTRequestsFMContent() {
  const { user } = useAuth()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [busy, setBusy]     = useState({})

  const load = async () => {
    setLoading(true)
    const { data, error: err } = await fetchPendingOtForFM()
    setLoading(false)
    if (err) { setError(err.message); return }
    setError(null)
    setRows(data || [])
  }

  useEffect(() => { load() }, [])

  const decide = async (id, action) => {
    if (!user?.id) return
    setBusy((b) => ({ ...b, [id]: true }))
    const fn = action === 'approve' ? approveFMOt : rejectFMOt
    const { error: err } = await fn(id, user.id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== id))
  }

  const totalHrs = rows.reduce((s, r) => s + (Number(r.ot_hours) || 0), 0)

  if (loading) return <p className="text-sm text-[#64748B] py-4">Loading OT requests…</p>
  if (rows.length === 0) return (
    <p className="text-sm text-[#64748B] py-4">
      No OT requests pending your review.
    </p>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#64748B]">
        <span className="font-semibold text-[#0F172A]">{rows.length}</span> pending ·{' '}
        <span className="text-[#F59E0B] font-semibold">{totalHrs} hrs total</span>
      </p>
      {error && <p className="text-xs text-[#EF4444]">{error}</p>}
      <ul className="space-y-2">
        {rows.map((r) => {
          const isBusy = !!busy[r.id]
          return (
            <li key={r.id} className="card p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0F172A] truncate">{r.worker_name}</p>
                <p className="text-xs text-[#64748B] mt-0.5">
                  {r.ot_hours} OT hrs · {formatDate(r.attendance_date)} · by {r.supervisor_name}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isBusy && <span className="text-xs text-[#94A3B8]">Saving…</span>}
                <button
                  onClick={() => decide(r.id, 'approve')}
                  disabled={isBusy}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#10B981] hover:bg-[#059669] text-white disabled:opacity-60 min-h-[36px]"
                >
                  Approve → Boss
                </button>
                <button
                  onClick={() => decide(r.id, 'reject')}
                  disabled={isBusy}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-60 min-h-[36px]"
                >
                  Reject
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
