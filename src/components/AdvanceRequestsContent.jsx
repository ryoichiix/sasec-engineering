import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import {
  fetchPendingAdvanceRequests,
  approveAdvance,
  rejectAdvance,
  paymentModeLabel,
} from '../lib/advances'
import { formatCurrency } from '../lib/payroll'
import { formatDate } from '../lib/dates'

/**
 * Boss's advance review queue — pending_boss rows.
 * Mirrors the OTRequestsContent layout/visuals.
 */
export default function AdvanceRequestsContent() {
  const { user } = useAuth()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState({})

  const applyResult = (data, err) => {
    if (err) { setError(err.message); setRows([]) }
    else     { setError(null); setRows(data || []) }
    setLoading(false)
  }

  const reload = async () => {
    setLoading(true)
    const { data, error: err } = await fetchPendingAdvanceRequests()
    applyResult(data, err)
  }

  useEffect(() => {
    let isMounted = true
    fetchPendingAdvanceRequests().then(({ data, error: err }) => {
      if (!isMounted) return
      applyResult(data, err)
    })
    return () => { isMounted = false }
  }, [])

  const groups = useMemo(() => {
    const byWeek = new Map()
    for (const r of rows) {
      if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, [])
      byWeek.get(r.week_start).push(r)
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([week_start, items]) => ({ week_start, items }))
  }, [rows])

  const decideOne = async (id, action) => {
    if (!user?.id) return
    setBusy((b) => ({ ...b, [id]: true }))
    const fn = action === 'approve' ? approveAdvance : rejectAdvance
    const { error: err } = await fn(id, user.id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== id))
  }

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="text-sm text-[#64748B]">
          {loading ? 'Loading…' : (
            <>
              <span className="font-semibold text-[#0F172A]">{rows.length}</span>{' '}
              pending request{rows.length === 1 ? '' : 's'} ·{' '}
              <span className="text-violet-700 font-medium">{formatCurrency(totalAmount)}</span>
            </>
          )}
        </div>
        <button onClick={reload}
          className="text-xs font-medium px-3 py-1.5 border border-[#E2E8F0] rounded-md hover:bg-[#F8FAFC] min-h-[36px]">
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-[#EF4444] bg-[#FEE2E2] border border-[#FECACA] rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[#64748B]">No pending advance requests right now.</p>
          <p className="text-xs text-[#94A3B8] mt-1">Advances ≤ ₹1000 are auto-approved and won't appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.week_start} className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#F1F5F9] flex items-center justify-between bg-[#F8FAFC]">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Week of {formatDate(g.week_start)}
                </h3>
                <span className="text-xs text-[#64748B]">
                  {g.items.length} request{g.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="divide-y divide-[#F1F5F9]">
                {g.items.map((r) => {
                  const isBusy = !!busy[r.id]
                  return (
                    <li key={r.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F172A] truncate">{r.worker_name}</p>
                        <p className="text-xs text-[#64748B]">
                          <span className="font-semibold text-[#0F172A]">{formatCurrency(r.amount)}</span>
                          {' · '}{paymentModeLabel(r.payment_mode)}
                          {' · '}entered by {r.supervisor_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isBusy && <span className="text-xs text-[#94A3B8]">Saving…</span>}
                        <button onClick={() => decideOne(r.id, 'approve')} disabled={isBusy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#10B981] hover:bg-[#059669] text-white disabled:opacity-60 min-h-[36px]">
                          Approve
                        </button>
                        <button onClick={() => decideOne(r.id, 'reject')} disabled={isBusy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-60 min-h-[36px]">
                          Reject
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
