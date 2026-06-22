import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { useAuth } from '../contexts/auth-context'
import {
  fetchPendingOtRequests,
  approveOt,
  rejectOt,
  approveOtBulk,
} from '../lib/ot'
import { formatDate } from '../lib/dates'

export default function BossOTRequests() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState({}) // attendanceId -> bool

  // Internal: applies a fetched result set to local state.
  const applyResult = (data, err) => {
    if (err) {
      setError(err.message)
      setRows([])
    } else {
      setError(null)
      setRows(data || [])
    }
    setSelected(new Set())
    setLoading(false)
  }

  // Manual "Refresh" button — sets loading true on top of the fetch.
  // Not called from an effect, so the lint rule doesn't apply.
  const reload = async () => {
    setLoading(true)
    const { data, error: err } = await fetchPendingOtRequests()
    applyResult(data, err)
  }

  // Initial load — no setLoading(true) inside the effect body; initial
  // state is already true, which avoids the set-state-in-effect lint rule.
  useEffect(() => {
    let isMounted = true
    fetchPendingOtRequests().then(({ data, error: err }) => {
      if (!isMounted) return
      applyResult(data, err)
    })
    return () => { isMounted = false }
  }, [])

  // Group rows by date for cleaner display + per-date Select All
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

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allIds))
  }

  const toggleDate = (items) => {
    const dateIds = items.map((r) => r.id)
    const allInDate = dateIds.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allInDate) dateIds.forEach((id) => next.delete(id))
      else dateIds.forEach((id) => next.add(id))
      return next
    })
  }

  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const decideOne = async (id, action) => {
    if (!user?.id) return
    setBusy((b) => ({ ...b, [id]: true }))
    const fn = action === 'approve' ? approveOt : rejectOt
    const { error: err } = await fn(id, user.id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (err) { setError(err.message); return }
    setRows((prev) => prev.filter((r) => r.id !== id))
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  const bulkApprove = async () => {
    if (!user?.id || selected.size === 0) return
    const count = selected.size
    if (!window.confirm(
      `Approve ${count} OT request${count === 1 ? '' : 's'} in bulk? This will include the OT hours in payroll for those workers.`
    )) return
    const ids = Array.from(selected)
    const { error: err } = await approveOtBulk(ids, user.id)
    if (err) { setError(err.message); return }
    setRows((prev) => prev.filter((r) => !selected.has(r.id)))
    setSelected(new Set())
  }

  const totalPendingHrs = rows.reduce((s, r) => s + (Number(r.ot_hours) || 0), 0)

  return (
    <DashboardShell title="OT Requests" accent="bg-violet-500">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="text-sm text-slate-600">
          {loading ? 'Loading…' : (
            <>
              <span className="font-semibold text-slate-900">{rows.length}</span>{' '}
              pending request{rows.length === 1 ? '' : 's'} ·{' '}
              <span className="text-violet-700 font-medium">{totalPendingHrs} hrs</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            disabled={rows.length === 0}
            className="text-xs font-medium px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-40"
          >
            {allSelected ? 'Clear selection' : 'Select All'}
          </button>
          <button
            onClick={bulkApprove}
            disabled={selected.size === 0}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
          >
            Approve {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
          <button
            onClick={reload}
            className="text-xs font-medium px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">
          No pending OT requests right now.
          <p className="text-xs text-slate-400 mt-2">
            OT under 3 hours per day is auto-approved and doesn't appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const dateIds = g.items.map((r) => r.id)
            const allInDate = dateIds.every((id) => selected.has(id))
            return (
              <div key={g.date} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={allInDate}
                      onChange={() => toggleDate(g.items)}
                      className="h-4 w-4 rounded border-slate-400 text-slate-900 focus:ring-slate-900"
                      aria-label={`Select all on ${formatDate(g.date)}`}
                    />
                    <h3 className="text-sm font-semibold text-slate-900">
                      {formatDate(g.date)}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500">
                    {g.items.length} request{g.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.items.map((r) => {
                    const isBusy = !!busy[r.id]
                    const isSel = selected.has(r.id)
                    return (
                      <li
                        key={r.id}
                        className="px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleOne(r.id)}
                            disabled={isBusy}
                            className="h-4 w-4 rounded border-slate-400 text-slate-900 focus:ring-slate-900"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {r.worker_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {r.ot_hours} OT hrs · entered by {r.supervisor_name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isBusy && <span className="text-xs text-slate-400">Saving…</span>}
                          <button
                            onClick={() => decideOne(r.id, 'approve')}
                            disabled={isBusy}
                            className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => decideOne(r.id, 'reject')}
                            disabled={isBusy}
                            className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
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
          })}
        </div>
      )}
    </DashboardShell>
  )
}
