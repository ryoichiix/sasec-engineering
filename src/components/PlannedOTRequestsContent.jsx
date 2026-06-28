import { useEffect, useState } from 'react'
import { fetchPendingPlannedOtForBoss, bossApprovePlannedOt, bossRejectPlannedOt } from '../lib/plan-ot'
import { formatDate } from '../lib/dates'

/**
 * Director's PLANNED-OT approval queue — overtime scheduled in a supervisor's
 * morning work plan (work_plans.morning_plan, ot_status='pending_boss', i.e.
 * already approved by the Site Incharge). Approve → final approval, supervisor
 * notified; Reject → supervisor notified.
 *
 * Separate from OTRequestsContent, which approves actual worked OT from
 * `attendance` (that chain feeds payroll and is untouched).
 */
export default function PlannedOTRequestsContent({ onCountChange }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState({})

  useEffect(() => {
    let alive = true
    fetchPendingPlannedOtForBoss().then(({ data, error: err }) => {
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
    const fn = action === 'approve' ? bossApprovePlannedOt : bossRejectPlannedOt
    const { error: err } = await fn(row)
    setBusy((b) => { const n = { ...b }; delete n[row.id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== row.id))
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-[#EF4444] bg-[#FEE2E2] border border-[#FECACA] rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[#64748B]">No planned OT awaiting your approval.</p>
          <p className="text-xs text-[#94A3B8] mt-1">Plans appear here once the Site Incharge approves them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const isBusy = !!busy[r.id]
            const name = r.supervisor_name || 'Supervisor'
            const range = [r.ot_from, r.ot_to].filter(Boolean).join(' – ')
            return (
              <div key={r.id} className="card p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0F172A] text-sm truncate">{name}</p>
                      <p className="text-xs text-[#64748B] mt-0.5">{formatDate(r.plan_date)}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 bg-amber-50 text-amber-700 border-amber-200">
                    OT plan
                  </span>
                </div>

                <p className="text-sm text-[#64748B] mb-3">
                  <span className="font-semibold text-[#0F172A]">{range || 'OT planned'}</span>
                  {r.project_description ? <> · {r.project_description}</> : null}
                </p>

                <div className="flex items-center justify-end gap-2">
                  {isBusy && <span className="text-xs text-[#94A3B8]">Saving…</span>}
                  <button
                    onClick={() => decide(r, 'reject')}
                    disabled={isBusy}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-60 min-h-[36px]"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => decide(r, 'approve')}
                    disabled={isBusy}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#10B981] hover:bg-[#059669] text-white disabled:opacity-60 min-h-[36px]"
                  >
                    Approve
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
