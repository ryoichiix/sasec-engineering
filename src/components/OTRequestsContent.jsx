import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import {
  fetchPendingOtRequests,
  approveOt,
  rejectOt,
  approveOtBulk,
} from '../lib/ot'
import { formatDate } from '../lib/dates'

/**
 * OT Requests content — shared between BossOTRequests (standalone page)
 * and BossRequests (tabbed page).
 */
export default function OTRequestsContent() {
  const { user } = useAuth()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy]     = useState({})

  const applyResult = (data, err) => {
    if (err) { setError(err.message); setRows([]) }
    else     { setError(null); setRows(data || []) }
    setSelected(new Set())
    setLoading(false)
  }

  const reload = async () => {
    setLoading(true)
    const { data, error: err } = await fetchPendingOtRequests()
    applyResult(data, err)
  }

  useEffect(() => {
    let isMounted = true
    fetchPendingOtRequests().then(({ data, error: err }) => {
      if (!isMounted) return
      applyResult(data, err)
    })
    return () => { isMounted = false }
  }, [])

  const groups = useMemo(() => {
    const byDate = new Map()
    for (const r of rows) {
      if (!byDate.has(r.attendance_date)) byDate.set(r.attendance_date, [])
      byDate.get(r.attendance_date).push(r)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([date, items]) => ({ date, items }))
  }, [rows])

  const allIds = useMemo(() => rows.map((r) => r.id), [rows])
  const allSelected = allIds.length > 0 && selected.size === allIds.length

  const toggleAll  = () => allSelected ? setSelected(new Set()) : setSelected(new Set(allIds))
  const toggleOne  = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleDate = (items) => {
    const dateIds = items.map((r) => r.id)
    const allIn   = dateIds.every((id) => selected.has(id))
    setSelected((p) => {
      const n = new Set(p)
      allIn ? dateIds.forEach((id) => n.delete(id)) : dateIds.forEach((id) => n.add(id))
      return n
    })
  }

  const decideOne = async (id, action) => {
    if (!user?.id) return
    setBusy((b) => ({ ...b, [id]: true }))
    const fn = action === 'approve' ? approveOt : rejectOt
    const { error: err } = await fn(id, user.id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => r.id !== id))
    setSelected((p) => { const n = new Set(p); n.delete(id); return n })
  }

  const bulkApprove = async () => {
    if (!user?.id || selected.size === 0) return
    const count = selected.size
    if (!window.confirm(
      `Approve ${count} OT request${count === 1 ? '' : 's'}? OT hours will be included in payroll.`
    )) return
    const { error: err } = await approveOtBulk(Array.from(selected), user.id)
    if (err) { setError(err.message); return }
    setRows((p) => p.filter((r) => !selected.has(r.id)))
    setSelected(new Set())
  }

  const totalPendingHrs = rows.reduce((s, r) => s + (Number(r.ot_hours) || 0), 0)

  return (
    <>
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="text-sm text-[#64748B]">
          {loading ? 'Loading…' : (
            <>
              <span className="font-semibold text-[#0F172A]">{rows.length}</span>{' '}
              pending request{rows.length === 1 ? '' : 's'} ·{' '}
              <span className="text-violet-700 font-medium">{totalPendingHrs} hrs</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleAll} disabled={rows.length === 0}
            className="text-xs font-medium px-3 py-1.5 border border-[#E2E8F0] rounded-md hover:bg-[#F8FAFC] disabled:opacity-40 min-h-[36px]">
            {allSelected ? 'Clear selection' : 'Select All'}
          </button>
          <button onClick={bulkApprove} disabled={selected.size === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#10B981] hover:bg-[#059669] text-white disabled:opacity-40 min-h-[36px]">
            Approve {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
          <button onClick={reload}
            className="text-xs font-medium px-3 py-1.5 border border-[#E2E8F0] rounded-md hover:bg-[#F8FAFC] min-h-[36px]">
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-[#EF4444] bg-[#FEE2E2] border border-[#FECACA] rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[#64748B]">No pending OT requests right now.</p>
          <p className="text-xs text-[#94A3B8] mt-1">OT ≤ 3 hours is auto-approved and won't appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const dateIds = g.items.map((r) => r.id)
            const allInDate = dateIds.every((id) => selected.has(id))
            return (
              <div key={g.date} className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-[#F1F5F9] flex items-center justify-between bg-[#F8FAFC]">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={allInDate} onChange={() => toggleDate(g.items)}
                      className="h-4 w-4 rounded border-[#CBD5E1] text-[#C0272D] focus:ring-[#C0272D]"
                      aria-label={`Select all on ${formatDate(g.date)}`} />
                    <h3 className="text-sm font-semibold text-[#0F172A]">{formatDate(g.date)}</h3>
                  </div>
                  <span className="text-xs text-[#64748B]">{g.items.length} request{g.items.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="divide-y divide-[#F1F5F9]">
                  {g.items.map((r) => {
                    const isBusy = !!busy[r.id]
                    return (
                      <li key={r.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)}
                            disabled={isBusy} className="h-4 w-4 rounded border-[#CBD5E1] text-[#C0272D] focus:ring-[#C0272D]" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#0F172A] truncate">{r.worker_name}</p>
                            <p className="text-xs text-[#64748B]">{r.ot_hours} OT hrs · entered by {r.supervisor_name}</p>
                          </div>
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
            )
          })}
        </div>
      )}
    </>
  )
}
