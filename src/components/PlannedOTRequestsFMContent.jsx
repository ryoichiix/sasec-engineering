import { useEffect, useState } from 'react'
import { fetchPendingPlannedOtForFM, fmApprovePlannedOt, fmRejectPlannedOt } from '../lib/plan-ot'
import { formatDate } from '../lib/dates'
import { QueueEmptyState } from './QueueSectionHeader'

/**
 * Site Incharge's PLANNED-OT review queue — overtime a supervisor scheduled in
 * their morning work plan (work_plans.morning_plan, ot_status='pending_field_manager').
 * Approve → escalates to the Director; Reject → supervisor notified.
 *
 * Separate from OTRequestsFMContent, which reviews actual worked OT logged in
 * `attendance` (that chain feeds payroll and is untouched).
 */
export default function PlannedOTRequestsFMContent({ onCountChange }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState({})

  useEffect(() => {
    let alive = true
    fetchPendingPlannedOtForFM().then(({ data, error: err }) => {
      if (!alive) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setError(null)
      setRows(data || [])
    })
    return () => { alive = false }
  }, [])
  useEffect(() => { onCountChange?.(rows.length) }, [rows.length, onCountChange])

  const decide = async (row, action) => {
    setBusy((b) => ({ ...b, [row.id]: true }))
    const fn = action === 'approve' ? fmApprovePlannedOt : fmRejectPlannedOt
    const { error: err } = await fn(row)
    setBusy((b) => { const n = { ...b }; delete n[row.id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== row.id))
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm text-gray-400">
          Loading OT plans…
        </div>
      ) : rows.length === 0 ? (
        <QueueEmptyState text="No planned OT awaiting review" />
      ) : (
        rows.map((r) => {
          const isBusy = !!busy[r.id]
          const name = r.supervisor_name || 'Supervisor'
          const range = [r.ot_from, r.ot_to].filter(Boolean).join(' – ')
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(r.plan_date)}</p>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 bg-amber-50 text-amber-700 border-amber-200">
                  OT plan
                </span>
              </div>

              <p className="text-sm text-gray-600 mb-3">
                <span className="font-semibold text-gray-900">{range || 'OT planned'}</span>
                {r.project_description ? <> · {r.project_description}</> : null}
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => decide(r, 'reject')}
                  disabled={isBusy}
                  className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-60"
                >
                  Reject
                </button>
                <button
                  onClick={() => decide(r, 'approve')}
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
