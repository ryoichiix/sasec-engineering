import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { todayLocal } from '../lib/dates'
import { formatCurrency } from '../lib/payroll'
import {
  EXPENSE_CATEGORIES,
  CATEGORY_COLORS,
  fetchAllExpenses,
  getReceiptUrl,
} from '../lib/expenses'

// Calendar-month helpers (duplicated to avoid cross-file dep on non-lib code)
function monthBounds(ref) {
  const d = ref instanceof Date ? ref : new Date(ref + 'T00:00:00')
  const y = d.getFullYear(), m = d.getMonth()
  const pad = (n) => String(n).padStart(2, '0')
  const start = `${y}-${pad(m + 1)}-01`
  const last  = new Date(y, m + 1, 0).getDate()
  const end   = `${y}-${pad(m + 1)}-${pad(last)}`
  return { start, end, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
}

function shiftMonth(isoStart, delta) {
  const d = new Date(isoStart + 'T00:00:00')
  d.setMonth(d.getMonth() + delta)
  return monthBounds(d)
}

export default function BossExpenses() {
  const [month, setMonth] = useState(() => monthBounds(todayLocal()))
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [receiptUrls, setReceiptUrls] = useState({}) // id -> url

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    fetchAllExpenses(month.start, month.end).then(({ data, error: err }) => {
      if (!isMounted) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setError(null)
      setExpenses(data || [])

      // Fetch receipt URLs asynchronously
      for (const e of data || []) {
        if (e.receipt_path) {
          getReceiptUrl(e.receipt_path).then((url) => {
            if (url && isMounted) setReceiptUrls((p) => ({ ...p, [e.id]: url }))
          })
        }
      }
    })
    return () => { isMounted = false }
  }, [month.start, month.end])

  // ── Summaries ─────────────────────────────────────────────
  const grandTotal = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount), 0),
    [expenses]
  )

  const byCategory = useMemo(() => {
    const m = {}
    for (const e of expenses) {
      m[e.category] = (m[e.category] || 0) + Number(e.amount)
    }
    return EXPENSE_CATEGORIES
      .filter((c) => m[c] > 0)
      .map((c) => ({ category: c, total: m[c] }))
      .sort((a, b) => b.total - a.total)
  }, [expenses])

  const bySupervisor = useMemo(() => {
    const m = {}
    const names = {}
    for (const e of expenses) {
      m[e.supervisor_id] = (m[e.supervisor_id] || 0) + Number(e.amount)
      names[e.supervisor_id] = e.supervisor_name
    }
    return Object.entries(m)
      .map(([id, total]) => ({ supervisorId: id, name: names[id], total }))
      .sort((a, b) => b.total - a.total)
  }, [expenses])

  return (
    <DashboardShell title="Expenses">
      {/* ── Month navigator ─────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setMonth((m) => shiftMonth(m.start, -1))}
          className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100 transition text-slate-600 text-sm"
        >
          ← Prev
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-900">{month.label}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Grand total: <span className="font-semibold text-slate-800">{formatCurrency(grandTotal)}</span>
          </p>
        </div>
        <button
          onClick={() => setMonth((m) => shiftMonth(m.start, +1))}
          className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100 transition text-slate-600 text-sm"
        >
          Next →
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      {/* ── Summary cards ────────────────────────────────────── */}
      {!loading && expenses.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* By category */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">By category</h3>
            <ul className="space-y-2">
              {byCategory.map((item) => (
                <li key={item.category} className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.Other}`}
                  >
                    {item.category}
                  </span>
                  <div className="flex-1 mx-3">
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: `${Math.round((item.total / grandTotal) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-slate-800 flex-shrink-0">
                    {formatCurrency(item.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* By supervisor */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">By supervisor</h3>
            <ul className="space-y-2">
              {bySupervisor.map((item) => (
                <li key={item.supervisorId} className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700 truncate">{item.name}</p>
                  <div className="flex-1 mx-3">
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-navy rounded-full"
                        style={{ width: `${Math.round((item.total / grandTotal) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-slate-800 flex-shrink-0">
                    {formatCurrency(item.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Full expense list ─────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            All expenses — {month.label}
          </h3>
          <span className="text-xs text-slate-400">
            {loading ? '' : `${expenses.length} record${expenses.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-sm text-slate-500">Loading…</div>
        ) : expenses.length === 0 ? (
          <div className="px-5 py-10 text-sm text-slate-500 text-center">
            No expenses recorded for {month.label}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Supervisor</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {e.supervisor_name}
                    </td>
                    <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                      {e.expense_date}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ${CATEGORY_COLORS[e.category] || CATEGORY_COLORS.Other}`}
                      >
                        {e.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(Number(e.amount))}
                    </td>
                    <td className="px-5 py-3 text-slate-600 max-w-xs truncate">
                      {e.description || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {receiptUrls[e.id] ? (
                        <a
                          href={receiptUrls[e.id]}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand hover:underline"
                        >
                          📎 View
                        </a>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals footer */}
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-slate-700">
                    Total
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-bold text-slate-900">
                    {formatCurrency(grandTotal)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
