import { useEffect, useMemo, useState } from 'react'
import { todayLocal, formatDate } from '../lib/dates'
import { weekRange } from '../lib/payroll'
import { fetchAdvancesWithNames } from '../lib/advances'

// Status → pill style + label. Keys are the real DB `advance_status` values;
// only the displayed text changes (e.g. pending_boss → "Pending Director").
const STATUS_BADGES = {
  approved:              { label: 'Approved',        className: 'bg-green-50 text-green-700 border-green-200' },
  direct:                { label: 'Direct',          className: 'bg-blue-50 text-blue-700 border-blue-200' },
  rejected:              { label: 'Rejected',        className: 'bg-red-50 text-red-700 border-red-200' },
  pending_site_incharge: { label: 'Pending SI',      className: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending_field_manager: { label: 'Pending SI',      className: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending_boss:          { label: 'Pending Director', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  partial:               { label: 'Partial',         className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
}

const PAGE_SIZE = 5 // date-groups shown per page

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

function dateKey(createdAt) {
  return String(createdAt).slice(0, 10)
}

function timeLabel(createdAt) {
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/**
 * Advances list with summary cards + date-range filter + grouping.
 *
 * scope='mine'  → only advances entered by `supervisorId` (Supervisor view)
 * scope='all'   → advances from every supervisor (Director / Site Incharge view)
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

  const cards = [
    { label: 'Total Advances', value: summary.total, valueClass: 'text-blue-600' },
    { label: 'Cash',           value: summary.cash,  valueClass: 'text-green-600' },
    { label: 'Bank Transfer',  value: summary.bank,  valueClass: 'text-purple-600' },
  ]

  return (
    <div>
      {/* Date-range filter */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
          <span className="text-xs text-gray-400">From</span>
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-sm text-gray-700 outline-none bg-transparent"
          />
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
          <span className="text-xs text-gray-400">To</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={todayLocal()}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-sm text-gray-700 outline-none bg-transparent"
          />
        </div>
        <button
          type="button"
          onClick={() => { setStartDate(defaultWeek.start); setEndDate(defaultWeek.end) }}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors"
        >
          This week
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {cards.map(({ label, value, valueClass }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${valueClass}`}>{inr(value)}</p>
          </div>
        ))}
      </div>

      {/* Grouped list */}
      {error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-10 text-sm text-red-600">
          {error}
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-10 text-sm text-gray-400">
          Loading…
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-10 text-sm text-gray-400 text-center">
          No advances in this date range.
        </div>
      ) : (
        <>
          {shownGroups.map((g) => (
            <div key={g.date}>
              {/* Date group header */}
              <div className="flex items-center gap-3 mb-3 mt-6 first:mt-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{formatDate(g.date)}</p>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              {/* Card container for this day's rows */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 divide-y divide-gray-50">
                  {g.items.map((r) => {
                    const badge = STATUS_BADGES[r.advance_status] || STATUS_BADGES.direct
                    const isBank = r.payment_mode === 'bank_transfer'
                    const workerName = r.worker_name || 'Unnamed worker'
                    const meta = [
                      r.worker_designation,
                      scope === 'all' ? `by ${r.supervisor_name}` : null,
                    ].filter(Boolean).join(' · ') || timeLabel(r.created_at)

                    return (
                      <div key={r.id} className="flex items-center gap-4 py-4">
                        {/* Worker avatar */}
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-semibold text-gray-600 text-sm flex-shrink-0">
                          {workerName.charAt(0).toUpperCase()}
                        </div>

                        {/* Worker info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">{workerName}</p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{meta}</p>
                        </div>

                        {/* Amount + mode */}
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-gray-900">{inr(r.amount)}</p>
                          <div className="flex items-center gap-1 justify-end mt-0.5">
                            {isBank
                              ? <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">🏦 Bank</span>
                              : <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">💵 Cash</span>}
                          </div>
                        </div>

                        {/* Status badge */}
                        <div className="flex-shrink-0 ml-2 hidden sm:block">
                          <span className={`text-xs font-semibold border px-2.5 py-1 rounded-full ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}

          {visibleGroups < groups.length && (
            <div className="text-center mt-6">
              <button
                type="button"
                onClick={() => setVisibleGroups((v) => v + PAGE_SIZE)}
                className="text-xs font-medium px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
