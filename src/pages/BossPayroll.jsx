import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import PeriodNavigator from '../components/PeriodNavigator'
import { supabase } from '../lib/supabase'
import {
  PAYROLL_MODE,
  weekRange,
  monthRange,
  shiftWeek,
  shiftMonth,
  formatRangeLabel,
  formatCurrency,
  computePayroll,
} from '../lib/payroll'
import { fetchWeeklyAdvancesInPeriod } from '../lib/advances'
import { todayLocal } from '../lib/dates'

export default function BossPayroll() {
  const [mode, setMode] = useState(PAYROLL_MODE.WEEKLY)
  const [period, setPeriod] = useState(() => weekRange(todayLocal()))
  const [workers, setWorkers] = useState([])
  const [designationsById, setDesignationsById] = useState({})
  const [attendance, setAttendance] = useState([])
  const [advances, setAdvances] = useState([]) // { worker_id, amount, payment_mode }[]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load workers + designations (names only) once
  useEffect(() => {
    let isMounted = true
    Promise.all([
      supabase
        .from('workers')
        .select('id, full_name, designation_id, individual_wage, wage_type')
        .order('full_name'),
      supabase
        .from('designations')
        .select('id, name'),
    ])
      .then(([wk, des]) => {
        if (!isMounted) return
        if (wk.error || des.error) {
          setError((wk.error || des.error).message)
          setWorkers([])
          setDesignationsById({})
        } else {
          setError(null)
          setWorkers(wk.data || [])
          const map = {}
          for (const d of des.data || []) map[d.id] = d
          setDesignationsById(map)
        }
      })
    return () => { isMounted = false }
  }, [])

  // Load attendance + advances for the current period.
  // No setLoading(true) here — initial state is true; on date change
  // the table briefly shows the previous period until new data lands.
  useEffect(() => {
    let isMounted = true
    Promise.all([
      supabase
        .from('attendance')
        .select('worker_table_id, attendance_date, status, ot_hours, ot_status')
        .gte('attendance_date', period.start)
        .lte('attendance_date', period.end),
      fetchWeeklyAdvancesInPeriod(period.start, period.end),
    ]).then(([att, adv]) => {
      if (!isMounted) return
      if (att.error) { setError(att.error.message); setAttendance([]) }
      else { setError(null); setAttendance(att.data || []) }
      setAdvances(adv.data || [])
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [period.start, period.end])

  const onModeChange = (next) => {
    setMode(next)
    setPeriod(
      next === PAYROLL_MODE.WEEKLY
        ? weekRange(todayLocal())
        : monthRange(todayLocal())
    )
  }
  const goPrev = () =>
    setPeriod(
      mode === PAYROLL_MODE.WEEKLY
        ? shiftWeek(period.start, -1)
        : shiftMonth(period.start, -1)
    )
  const goNext = () =>
    setPeriod(
      mode === PAYROLL_MODE.WEEKLY
        ? shiftWeek(period.start, +1)
        : shiftMonth(period.start, +1)
    )

  // Cash vs Bank Transfer split for the selected period
  const advanceSplit = useMemo(() => {
    let cash = 0
    let bank = 0
    for (const a of advances) {
      const amt = a.advance_status === 'partial'
        ? Number(a.approved_amount) || 0
        : Number(a.amount) || 0
      if (a.payment_mode === 'bank_transfer') bank += amt
      else cash += amt
    }
    return { cash, bank, total: cash + bank }
  }, [advances])

  const rows = useMemo(() => {
    // Build per-worker attendance + OT + OT-status maps
    const byWorker = new Map()
    for (const a of attendance) {
      if (!byWorker.has(a.worker_table_id)) {
        byWorker.set(a.worker_table_id, { attendance: {}, ot: {}, otStatus: {} })
      }
      const entry = byWorker.get(a.worker_table_id)
      entry.attendance[a.attendance_date] = a.status
      const otH = Number(a.ot_hours) || 0
      if (otH > 0) {
        entry.ot[a.attendance_date] = otH
        entry.otStatus[a.attendance_date] = a.ot_status ?? null
      }
    }

    // Build per-worker advance deduction totals.
    // 'direct' (≤ ₹1000 auto), 'approved' (boss-approved >₹1000) and 'partial'
    // count. Partial advances deduct only the boss-approved portion.
    // Pending and rejected advances are excluded from payroll.
    const advByWorker = {}
    for (const a of advances) {
      const status = a.advance_status ?? 'direct'
      if (status !== 'direct' && status !== 'approved' && status !== 'partial') continue
      const amt = status === 'partial' ? Number(a.approved_amount) || 0 : Number(a.amount) || 0
      advByWorker[a.worker_table_id] = (advByWorker[a.worker_table_id] || 0) + amt
    }

    return workers
      .map((w) => {
        const desig = w.designation_id ? designationsById[w.designation_id] : null
        const dailyRate = Number(w.individual_wage) || 0
        const wageType  = w.wage_type ?? 'daily_rate'
        const workerData = byWorker.get(w.id) ?? { attendance: {}, ot: {}, otStatus: {} }
        const advanceDeduction = advByWorker[w.id] || 0
        const calc = computePayroll({
          dailyRate,
          wageType,
          attendanceByDate: workerData.attendance,
          otByDate: workerData.ot,
          otStatusByDate: workerData.otStatus,
          mode,
          advanceDeduction,
        })
        return { worker: w, designation: desig, dailyRate, wageType, ...calc }
      })
      .filter((r) => r.present + r.half + r.absent > 0 || r.dailyRate > 0 || r.advanceDeduction > 0)
  }, [workers, attendance, advances, designationsById, mode])

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          gross:             acc.gross + r.gross,
          otPay:             acc.otPay + r.otPay,
          pf:                acc.pf + r.pf,
          esi:               acc.esi + r.esi,
          pt:                acc.pt + r.pt,
          advanceDeduction:  acc.advanceDeduction + r.advanceDeduction,
          net:               acc.net + r.net,
        }),
        { gross: 0, otPay: 0, pf: 0, esi: 0, pt: 0, advanceDeduction: 0, net: 0 }
      ),
    [rows]
  )

  return (
    <DashboardShell title="Payroll" accent="bg-amber-500">
      <PeriodNavigator
        mode={mode}
        onModeChange={onModeChange}
        label={formatRangeLabel(period, mode)}
        onPrev={goPrev}
        onNext={goNext}
      />

      {/* Advance split summary — Cash vs Bank Transfer */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <SummaryTile
          label="Advances — Cash"
          value={formatCurrency(advanceSplit.cash)}
          pillClass="bg-emerald-50 text-emerald-800 ring-emerald-200"
        />
        <SummaryTile
          label="Advances — Bank Transfer"
          value={formatCurrency(advanceSplit.bank)}
          pillClass="bg-sky-50 text-sky-800 ring-sky-200"
        />
        <SummaryTile
          label="Advances — Total"
          value={formatCurrency(advanceSplit.total)}
          pillClass="bg-slate-100 text-slate-800 ring-slate-200"
        />
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
            <tr>
              <th className="px-4 py-4">Worker</th>
              <th className="px-4 py-4">Designation</th>
              <th className="px-2 py-4 text-center" title="Present">P</th>
              <th className="px-2 py-4 text-center" title="Half day">H</th>
              <th className="px-2 py-4 text-center" title="Absent">A</th>
              <th className="px-4 py-4 text-right">Rate/day</th>
              <th className="px-4 py-4 text-right">Gross</th>
              <th className="px-4 py-4 text-right">OT Pay</th>
              <th className="px-4 py-4 text-right">PF (12%)</th>
              <th className="px-4 py-4 text-right">ESI (0.75%)</th>
              <th className="px-4 py-4 text-right">PT</th>
              <th className="px-4 py-4 text-right">Weekly Adv</th>
              <th className="px-4 py-4 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={13} className="px-4 py-6 text-slate-500">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-6 text-slate-500">
                  No attendance and no assigned designations for this period.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.worker.id}>
                  <td className="px-4 py-4 text-slate-900 font-medium">
                    {r.worker.full_name || 'Unnamed worker'}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {r.designation ? (
                      <span className="inline-flex items-center gap-1.5">
                        {r.designation.name}
                        <span className={`text-[9px] font-medium uppercase tracking-wide px-1 py-0.5 rounded ${r.wageType === 'monthly_fixed' ? 'bg-slate-50 text-slate-500 ring-1 ring-slate-200' : 'bg-slate-50 text-slate-400 ring-1 ring-slate-200'}`}>
                          {r.wageType === 'monthly_fixed' ? 'Fixed' : 'Daily'}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">— None —</span>
                    )}
                  </td>
                  <td className="px-2 py-4 text-center text-slate-700">{r.present}</td>
                  <td className="px-2 py-4 text-center text-slate-700">{r.half}</td>
                  <td className="px-2 py-4 text-center text-slate-700">{r.absent}</td>
                  <td className="px-4 py-4 text-right text-slate-500 tabular-nums">
                    {formatCurrency(r.dailyRate)}
                  </td>
                  <td className="px-4 py-4 text-right text-[#0F172A] font-semibold tabular-nums">
                    {formatCurrency(r.gross)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {r.otPay > 0 ? (
                      <span className="text-[#0F172A] font-semibold tabular-nums" title={`${r.totalOtHours} OT hrs (approved)`}>
                        {formatCurrency(r.otPay)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                    {r.pendingOtHours > 0 && (
                      <div className="text-[10px] text-amber-700">
                        {r.pendingOtHours} hr pending
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right text-slate-600 tabular-nums">
                    {formatCurrency(r.pf)}
                  </td>
                  <td className="px-4 py-4 text-right text-slate-600 tabular-nums">
                    {formatCurrency(r.esi)}
                  </td>
                  <td className="px-4 py-4 text-right text-slate-600 tabular-nums">
                    {formatCurrency(r.pt)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {r.advanceDeduction > 0 ? (
                      <span className="text-[#EF4444] font-semibold tabular-nums">
                        − {formatCurrency(r.advanceDeduction)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-4 text-right font-bold tabular-nums ${r.net < 0 ? 'text-[#EF4444]' : 'text-[#0F172A]'}`}>
                    {formatCurrency(r.net)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <td className="px-4 py-4 text-slate-700 font-bold" colSpan={6}>Totals</td>
                <td className="px-4 py-4 text-right text-[#0F172A] font-bold tabular-nums">{formatCurrency(totals.gross)}</td>
                <td className="px-4 py-4 text-right text-[#0F172A] font-bold tabular-nums">
                  {totals.otPay > 0 ? formatCurrency(totals.otPay) : '—'}
                </td>
                <td className="px-4 py-4 text-right text-slate-700 tabular-nums">{formatCurrency(totals.pf)}</td>
                <td className="px-4 py-4 text-right text-slate-700 tabular-nums">{formatCurrency(totals.esi)}</td>
                <td className="px-4 py-4 text-right text-slate-700 tabular-nums">{formatCurrency(totals.pt)}</td>
                <td className="px-4 py-4 text-right text-[#EF4444] font-bold tabular-nums">
                  {totals.advanceDeduction > 0
                    ? `− ${formatCurrency(totals.advanceDeduction)}`
                    : '—'}
                </td>
                <td className={`px-4 py-4 text-right font-bold tabular-nums ${totals.net < 0 ? 'text-[#EF4444]' : 'text-[#0F172A]'}`}>{formatCurrency(totals.net)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </DashboardShell>
  )
}

function SummaryTile({ label, value, pillClass }) {
  return (
    <div className={'rounded-lg ring-1 ring-inset px-4 py-3 ' + pillClass}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  )
}
