import { useEffect, useState } from 'react'
import { fetchWeeklyAdvancesInPeriod } from '../lib/advances'
import { formatCurrency, weekRange, monthRange } from '../lib/payroll'
import { todayLocal } from '../lib/dates'

function splitByMode(rows) {
  let cash = 0
  let bank = 0
  for (const r of rows) {
    const amt = Number(r.amount) || 0
    if (r.payment_mode === 'bank_transfer') bank += amt
    else cash += amt
  }
  return { cash, bank, total: cash + bank }
}

export default function AdvanceSummaryCard() {
  const [weekly, setWeekly]   = useState(null) // { cash, bank, total }
  const [monthly, setMonthly] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    const today   = todayLocal()
    const week    = weekRange(today)
    const month   = monthRange(today)

    // Fetch both periods in parallel — weekly_advances is indexed on week_start,
    // so this is two fast index scans.
    Promise.all([
      fetchWeeklyAdvancesInPeriod(week.start, week.end),
      fetchWeeklyAdvancesInPeriod(month.start, month.end),
    ]).then(([wk, mo]) => {
      if (wk.error || mo.error) {
        setError((wk.error || mo.error).message)
        return
      }
      setWeekly(splitByMode(wk.data || []))
      setMonthly(splitByMode(mo.data || []))
      setLoading(false)
    })
  }, [])

  return (
    <div className="bg-white border border-slate-200 rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Advance summary</h3>
        <span className="text-xs text-slate-400">Cash arrangement needed</span>
      </div>

      {loading ? (
        <div className="px-6 py-6 text-sm text-slate-500">Loading…</div>
      ) : error ? (
        <div className="px-6 py-6 text-sm text-rose-600">{error}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          <PeriodBlock label="This week" data={weekly} />
          <PeriodBlock label="This month" data={monthly} />
        </div>
      )}
    </div>
  )
}

function PeriodBlock({ label, data }) {
  return (
    <div className="px-6 py-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
        {label}
      </p>
      <div className="space-y-2">
        <Row
          label="Cash"
          value={data.cash}
          pillClass="bg-emerald-50 text-emerald-800 ring-emerald-200"
        />
        <Row
          label="Bank Transfer"
          value={data.bank}
          pillClass="bg-sky-50 text-sky-800 ring-sky-200"
        />
        <div className="pt-2 border-t border-slate-100">
          <Row
            label="Grand total"
            value={data.total}
            pillClass="bg-slate-100 text-slate-800 ring-slate-200"
            bold
          />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, pillClass, bold }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
        {label}
      </span>
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${pillClass}`}>
        {formatCurrency(value)}
      </span>
    </div>
  )
}
