import { useEffect, useMemo, useState } from 'react'
import { Banknote, Landmark } from 'lucide-react'
import { todayLocal, formatDate } from '../lib/dates'
import { weekRange, formatCurrency } from '../lib/payroll'
import { fetchAdvancesWithNames, paymentModeLabel } from '../lib/advances'

const STATUS_BADGES = {
  direct:                { label: 'Direct',                    className: 'bg-emerald-100 text-emerald-800' },
  pending_site_incharge: { label: 'Pending',                   className: 'bg-amber-100 text-amber-800' },
  pending_field_manager: { label: 'Pending',                   className: 'bg-amber-100 text-amber-800' },
  pending_boss:          { label: 'Pending',                   className: 'bg-sky-100 text-sky-800' },
  approved:              { label: 'Approved',                  className: 'bg-emerald-100 text-emerald-800' },
  rejected:              { label: 'Rejected',                  className: 'bg-rose-100 text-rose-800' },
}

const PAGE_SIZE = 5 // date-groups shown per page

function dateKey(createdAt) {
  return String(createdAt).slice(0, 10)
}

/**
 * Advances list with summary bar + date-range filter + grouping.
 *
 * scope='mine'  → only advances entered by `supervisorId` (Supervisor view)
 * scope='all'   → advances from every supervisor (Boss view)
 */
export default function AdvancesList({ scope, supervisorId, refreshTick = 0 }) {
  const today = todayLocal()
  const defaultWeek = useMemo(() => weekRange(today), [today])

  const [startDate, setStartDate] = useState(defaultWeek.start)
  const [endDate, setEndDate]     = useState(defaultWeek.end)
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [visibleGroups, setVisibleGroups] = useState(PAGE_SIZE)

  useEffect(() => {
    let isMounted = true
    fetchAdvancesWithNames({
      startDate,
      endDate,
      supervisorId: scope === 'mine' ? supervisorId : undefined,
    }).then(({ data, error: err }) => {
      if (!isMounted) return
      if (err) { setError(err.message); setRows([]) }
      else     { setError(null); setRows(data || []) }
      setLoading(false)
      setVisibleGroups(PAGE_SIZE)
    })
    return () => { isMounted = false }
  }, [scope, supervisorId, startDate, endDate, refreshTick])

  const summary = useMemo(() => {
    let cash = 0, bank = 0
    for (const r of rows) {
      const amt = Number(r.amount) || 0
      if (r.payment_mode === 'bank_transfer') bank += amt
      else cash += amt
    }
    return { cash, bank, total: cash + bank }
  }, [rows])

  const groups = useMemo(() => {
    const byDate = new Map()
    for (const r of rows) {
      const key = dateKey(r.created_at)
      if (!byDate.has(key)) byDate.set(key, [])
      byDate.get(key).push(r)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([date, items]) => ({ date, items }))
  }, [rows])

  const shownGroups = groups.slice(0, visibleGroups)

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <div className="bg-white border border-slate-200 rounded-lg px-6 py-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={todayLocal()}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <button
          type="button"
          onClick={() => { setStartDate(defaultWeek.start); setEndDate(defaultWeek.end) }}
          className="text-xs font-medium px-3 py-2 border border-slate-300 rounded-md text-slate-600 hover:bg-slate-50"
        >
          This week
        </button>
      </div>

      {/* Summary bar */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatDate(startDate)} – {formatDate(endDate)}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          <SummaryCell label="Total advances" value={summary.total} pillClass="bg-slate-100 text-slate-800 ring-slate-200" />
          <SummaryCell label="Cash" value={summary.cash} pillClass="bg-emerald-50 text-emerald-800 ring-emerald-200" />
          <SummaryCell label="Bank Transfer" value={summary.bank} pillClass="bg-sky-50 text-sky-800 ring-sky-200" />
        </div>
      </div>

      {/* Grouped list */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {scope === 'mine' ? 'Advances given' : 'Advances — all supervisors'}
          </h3>
        </div>
        {error ? (
          <div className="px-6 py-10 text-sm text-rose-600">{error}</div>
        ) : loading ? (
          <div className="px-6 py-10 text-sm text-slate-500">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            No advances in this date range.
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {shownGroups.map((g) => (
                <div key={g.date}>
                  <div className="px-6 py-2.5 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      {formatDate(g.date)}
                    </p>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {g.items.map((r) => {
                      const badge = STATUS_BADGES[r.advance_status] || STATUS_BADGES.direct
                      const isBank = r.payment_mode === 'bank_transfer'
                      return (
                        <li key={r.id} className="px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex items-center gap-3">
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 ${isBank ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}>
                              {isBank ? <Landmark className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{r.worker_name}</p>
                              <p className="text-xs text-slate-500">
                                {formatCurrency(r.amount)} · {paymentModeLabel(r.payment_mode)}
                                {scope === 'all' && <> · Given by {r.supervisor_name}</>}
                              </p>
                            </div>
                          </div>
                          <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${badge.className}`}>
                            {badge.label}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {visibleGroups < groups.length && (
              <div className="px-6 py-4 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleGroups((v) => v + PAGE_SIZE)}
                  className="text-xs font-medium px-3 py-1.5 border border-slate-300 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SummaryCell({ label, value, pillClass }) {
  return (
    <div className="px-6 py-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{label}</p>
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-semibold ring-1 ring-inset ${pillClass}`}>
        {formatCurrency(value)}
      </span>
    </div>
  )
}
