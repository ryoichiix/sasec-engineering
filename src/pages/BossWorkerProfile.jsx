import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dates'
import {
  PAYROLL_MODE,
  monthRange,
  formatRangeLabel,
  formatCurrency,
  computePayroll,
} from '../lib/payroll'
import { fetchAllAdvancesForWorker, paymentModeLabel } from '../lib/advances'

const WAGE_TYPES = [
  { value: 'daily_rate',    label: 'Daily Rate'    },
  { value: 'monthly_fixed', label: 'Monthly Fixed' },
]

const EDITABLE_FIELDS = [
  { key: 'full_name',           label: 'Full name',          type: 'text' },
  { key: 'pf_id',               label: 'PF ID',              type: 'text' },
  { key: 'bank_name',           label: 'Bank name',          type: 'text' },
  { key: 'bank_account_number', label: 'Bank account no.',   type: 'text' },
  { key: 'ifsc_code',           label: 'IFSC code',          type: 'text' },
]

export default function BossWorkerProfile() {
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [designation, setDesignation] = useState(null)
  const [supervisorName, setSupervisorName] = useState(null)
  const [designations, setDesignations] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)

  // Histories
  const [thisMonthAttendance, setThisMonthAttendance] = useState([])
  const [allTimeOtHours, setAllTimeOtHours] = useState(0)
  const [leaveHistory, setLeaveHistory] = useState([])
  const [advanceHistory, setAdvanceHistory] = useState([])

  // For 6-month payroll history
  const [historyAttendance, setHistoryAttendance] = useState([])
  const [historyAdvances, setHistoryAdvances] = useState([])

  // Compute the 6-month window. Memoised so the value is stable per
  // mount and doesn't trigger redundant re-fetches.
  const { monthsBack, earliestISO } = useMemo(() => {
    const n = 6
    const now = new Date()
    const earliest = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1)
    const iso = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-01`
    return { monthsBack: n, earliestISO: iso }
  }, [])

  useEffect(() => {
    if (!id) return
    let isMounted = true
    Promise.all([
      supabase
        .from('workers')
        .select('id, full_name, role, supervisor_id, designation_id, individual_wage, wage_type, pf_id, bank_name, bank_account_number, bank_ifsc, designations(name, daily_wage, wage_type)')
        .eq('id', id)
        .single(),
      supabase
        .from('designations')
        .select('id, name, daily_wage, wage_type')
        .order('name'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'supervisor')
        .order('full_name'),
    ]).then(async ([p, des, sup]) => {
      if (!isMounted) return
      if (p.error) { setError(p.error.message); setLoading(false); return }
      setProfile(p.data)
      setDesignation(p.data?.designations ?? null)
      setDesignations(des.data || [])
      setSupervisors(sup.data || [])
      if (p.data?.supervisor_id) {
        const found = (sup.data || []).find((s) => s.id === p.data.supervisor_id)
        setSupervisorName(found?.full_name ?? null)
      } else {
        setSupervisorName(null)
      }
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [id])

  // Load all histories once profile is known
  useEffect(() => {
    if (!id) return
    let isMounted = true

    const monthStart = monthRange(new Date())

    Promise.all([
      // Attendance for the last 6 months (covers both current-month summary
      // and the 6-month payroll history)
      supabase
        .from('attendance')
        .select('attendance_date, status, ot_hours, ot_status')
        .eq('worker_id', id)
        .gte('attendance_date', earliestISO)
        .order('attendance_date', { ascending: false }),
      // Lifetime OT total (approved-only)
      supabase
        .from('attendance')
        .select('ot_hours, ot_status')
        .eq('worker_id', id),
      // Leaves
      supabase
        .from('leave_requests')
        .select('id, start_date, end_date, reason, status, created_at, supervisor_note, boss_note')
        .eq('worker_id', id)
        .order('created_at', { ascending: false }),
      // Advances
      fetchAllAdvancesForWorker(id),
    ]).then(([att, allOt, leaves, advs]) => {
      if (!isMounted) return

      const attRows = att.data || []
      setHistoryAttendance(attRows)
      // Current-month subset for the summary card
      setThisMonthAttendance(
        attRows.filter(
          (r) => r.attendance_date >= monthStart.start && r.attendance_date <= monthStart.end
        )
      )

      const allOtRows = allOt.data || []
      const totalOt = allOtRows.reduce((s, r) => {
        const h = Number(r.ot_hours) || 0
        // Treat NULL (auto) and 'approved' as counted, pending+rejected as not
        if (h > 0 && (r.ot_status === null || r.ot_status === 'approved')) {
          return s + h
        }
        return s
      }, 0)
      setAllTimeOtHours(totalOt)

      setLeaveHistory(leaves.data || [])
      setAdvanceHistory(advs.data || [])
      setHistoryAdvances(advs.data || [])
    })
    return () => { isMounted = false }
  }, [id, earliestISO])

  // ── Summaries ──────────────────────────────────────────────

  const monthSummary = useMemo(() => {
    let p = 0, h = 0, a = 0, otThisMonth = 0
    for (const r of thisMonthAttendance) {
      if (r.status === 'present') p += 1
      else if (r.status === 'half_day') h += 1
      else if (r.status === 'absent') a += 1
      const otH = Number(r.ot_hours) || 0
      if (otH > 0 && (r.ot_status === null || r.ot_status === 'approved')) {
        otThisMonth += otH
      }
    }
    return { present: p, half: h, absent: a, otThisMonth }
  }, [thisMonthAttendance])

  const payrollHistory = useMemo(() => {
    if (!profile) return []
    const months = []
    const now = new Date()
    for (let i = 0; i < monthsBack; i++) {
      const ref = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const range = monthRange(ref)

      // Filter attendance + advances for this month
      const monthAtt = {}
      const monthOt = {}
      const monthOtStatus = {}
      for (const r of historyAttendance) {
        if (r.attendance_date >= range.start && r.attendance_date <= range.end) {
          monthAtt[r.attendance_date] = r.status
          const otH = Number(r.ot_hours) || 0
          if (otH > 0) {
            monthOt[r.attendance_date] = otH
            monthOtStatus[r.attendance_date] = r.ot_status ?? null
          }
        }
      }
      const advTotal = historyAdvances
        .filter((a) => a.week_start >= range.start && a.week_start <= range.end)
        .reduce((s, a) => s + Number(a.amount), 0)

      const calc = computePayroll({
        dailyRate: Number(profile.individual_wage) || 0,
        wageType: profile.wage_type ?? 'daily_rate',
        attendanceByDate: monthAtt,
        otByDate: monthOt,
        otStatusByDate: monthOtStatus,
        mode: PAYROLL_MODE.MONTHLY,
        advanceDeduction: advTotal,
      })
      months.push({
        range,
        label: formatRangeLabel(range, PAYROLL_MODE.MONTHLY),
        ...calc,
      })
    }
    return months
  }, [profile, historyAttendance, historyAdvances, monthsBack])

  // ── Edit handlers ──────────────────────────────────────────

  const startEdit = () => {
    if (!profile) return
    setDraft({
      full_name:           profile.full_name ?? '',
      pf_id:               profile.pf_id ?? '',
      bank_name:           profile.bank_name ?? '',
      bank_account_number: profile.bank_account_number ?? '',
      bank_ifsc:           profile.bank_ifsc ?? '',
      designation_id:      profile.designation_id ?? '',
      supervisor_id:       profile.supervisor_id ?? '',
      individual_wage:     String(Number(profile.individual_wage) || 0),
      wage_type:           profile.wage_type ?? 'daily_rate',
    })
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setDraft({}) }

  const onDraft = (key) => (e) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }))

  const saveEdit = async () => {
    setSaving(true)
    setError(null)
    const wage = parseFloat(draft.individual_wage)
    const update = {
      full_name:           draft.full_name?.trim() || null,
      pf_id:               draft.pf_id?.trim() || null,
      bank_name:           draft.bank_name?.trim() || null,
      bank_account_number: draft.bank_account_number?.trim() || null,
      bank_ifsc:           draft.bank_ifsc?.trim() || null,
      designation_id:      draft.designation_id || null,
      supervisor_id:       draft.supervisor_id || null,
      individual_wage:     Number.isFinite(wage) ? Math.max(0, wage) : 0,
      wage_type:           draft.wage_type || 'daily_rate',
    }
    const { data, error: err } = await supabase
      .from('workers')
      .update(update)
      .eq('id', id)
      .select('id, full_name, role, supervisor_id, designation_id, individual_wage, wage_type, pf_id, bank_name, bank_account_number, bank_ifsc, designations(name, daily_wage, wage_type)')
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setProfile(data)
    setDesignation(data?.designations ?? null)
    const supName = supervisors.find((s) => s.id === data.supervisor_id)?.full_name ?? null
    setSupervisorName(supName)
    setEditing(false)
    setDraft({})
  }

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardShell title="Worker profile">
        <p className="text-sm text-slate-500">Loading…</p>
      </DashboardShell>
    )
  }
  if (error && !profile) {
    return (
      <DashboardShell title="Worker profile">
        <p className="text-sm text-rose-600">{error}</p>
        <Link to="/boss/workers" className="text-xs text-brand hover:underline">
          ← Back to Workers
        </Link>
      </DashboardShell>
    )
  }
  if (!profile) return null

  const wageUnit = profile.wage_type === 'monthly_fixed' ? '/ month' : '/ day'

  return (
    <DashboardShell title={profile.full_name || 'Worker profile'}>
      <div className="mb-4">
        <Link to="/boss/workers" className="text-xs text-brand hover:underline">
          ← Back to Workers
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {/* Personal details + editable form */}
      <div className="bg-white border border-slate-200 rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Personal details</h3>
          {!editing ? (
            <button
              onClick={startEdit}
              className="text-xs font-medium px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-100"
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="text-xs font-medium px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {EDITABLE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              {editing ? (
                <input
                  type={f.type}
                  value={draft[f.key] ?? ''}
                  onChange={onDraft(f.key)}
                  className={INPUT_CLS}
                />
              ) : (
                <span className="text-slate-800">{profile[f.key] || <span className="text-slate-400 italic">— not set —</span>}</span>
              )}
            </Field>
          ))}

          <Field label="Designation">
            {editing ? (
              <select
                value={draft.designation_id ?? ''}
                onChange={(e) => {
                  const value = e.target.value
                  const desig = designations.find((d) => d.id === value)
                  setDraft((prev) => ({
                    ...prev,
                    designation_id: value,
                    individual_wage: desig ? String(Number(desig.daily_wage) || 0) : prev.individual_wage,
                    wage_type: desig?.wage_type || prev.wage_type,
                  }))
                }}
                className={INPUT_CLS + ' bg-white'}
              >
                <option value="">— None —</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-slate-800">{designation?.name || <span className="text-slate-400 italic">— None —</span>}</span>
            )}
          </Field>

          <Field label="Supervisor">
            {editing ? (
              <select
                value={draft.supervisor_id ?? ''}
                onChange={onDraft('supervisor_id')}
                className={INPUT_CLS + ' bg-white'}
              >
                <option value="">— Unassigned —</option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name || s.id}</option>
                ))}
              </select>
            ) : (
              <span className="text-slate-800">{supervisorName || <span className="text-slate-400 italic">— Unassigned —</span>}</span>
            )}
          </Field>

          <Field label="Wage type">
            {editing ? (
              <select
                value={draft.wage_type ?? 'daily_rate'}
                onChange={onDraft('wage_type')}
                className={INPUT_CLS + ' bg-white'}
              >
                {WAGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            ) : (
              <span className="text-slate-800">
                {profile.wage_type === 'monthly_fixed' ? 'Monthly Fixed' : 'Daily Rate'}
              </span>
            )}
          </Field>

          <Field label="Individual wage">
            {editing ? (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-sm">₹</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.individual_wage ?? '0'}
                  onChange={onDraft('individual_wage')}
                  className={INPUT_CLS + ' w-32'}
                />
                <span className="text-xs text-slate-500">{wageUnit}</span>
              </div>
            ) : (
              <span className="text-slate-800">
                {formatCurrency(profile.individual_wage)} <span className="text-slate-400 text-xs">{wageUnit}</span>
              </span>
            )}
          </Field>
        </div>
      </div>

      {/* This month: attendance + OT summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <SummaryCard title="Attendance this month">
          <Stat label="Present"  value={monthSummary.present} pillClass="bg-emerald-50 text-emerald-800 ring-emerald-200" />
          <Stat label="Half day" value={monthSummary.half}    pillClass="bg-amber-50 text-amber-800 ring-amber-200" />
          <Stat label="Absent"   value={monthSummary.absent}  pillClass="bg-rose-50 text-rose-800 ring-rose-200" />
        </SummaryCard>
        <SummaryCard title="Overtime">
          <Stat label="This month" value={`${monthSummary.otThisMonth} hrs`}  pillClass="bg-violet-50 text-violet-800 ring-violet-200" />
          <Stat label="All-time"   value={`${allTimeOtHours} hrs`}            pillClass="bg-slate-100 text-slate-800 ring-slate-200" />
        </SummaryCard>
      </div>

      {/* Leave history */}
      <div className="bg-white border border-slate-200 rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Leave history</h3>
          <span className="text-xs text-slate-400">{leaveHistory.length} total</span>
        </div>
        {leaveHistory.length === 0 ? (
          <div className="px-6 py-6 text-sm text-slate-500">No leaves on record.</div>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {leaveHistory.map((l) => (
              <li key={l.id} className="px-6 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {formatDate(l.start_date)}
                    {l.end_date && l.end_date !== l.start_date && (
                      <span className="text-slate-500"> → {formatDate(l.end_date)}</span>
                    )}
                  </p>
                  <span className={
                    'text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ' +
                    leaveStatusClass(l.status)
                  }>
                    {l.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1">{l.reason}</p>
                {l.supervisor_note && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Supervisor: {l.supervisor_note}
                  </p>
                )}
                {l.boss_note && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Boss: {l.boss_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Advance history */}
      <div className="bg-white border border-slate-200 rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Advance history</h3>
          <span className="text-xs text-slate-400">{advanceHistory.length} total</span>
        </div>
        {advanceHistory.length === 0 ? (
          <div className="px-6 py-6 text-sm text-slate-500">No advances on record.</div>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {advanceHistory.map((a) => (
              <li key={a.id} className="px-6 py-2.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-800 font-medium">
                    Week of {formatDate(a.week_start)}
                  </p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {paymentModeLabel(a.payment_mode)}
                  </p>
                </div>
                <span className="text-sm text-rose-700 font-semibold">
                  − {formatCurrency(a.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Payroll history — last 6 months */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Payroll history — last 6 months</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Month</th>
              <th className="px-2 py-3 text-center">P</th>
              <th className="px-2 py-3 text-center">H</th>
              <th className="px-2 py-3 text-center">A</th>
              <th className="px-4 py-3 text-right">Gross</th>
              <th className="px-4 py-3 text-right text-violet-600">OT Pay</th>
              <th className="px-4 py-3 text-right">PF</th>
              <th className="px-4 py-3 text-right">ESI</th>
              <th className="px-4 py-3 text-right">PT</th>
              <th className="px-4 py-3 text-right text-rose-600">Advance</th>
              <th className="px-4 py-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payrollHistory.map((m) => (
              <tr key={m.range.start}>
                <td className="px-4 py-3 text-slate-900 font-medium">{m.label}</td>
                <td className="px-2 py-3 text-center text-slate-700">{m.present}</td>
                <td className="px-2 py-3 text-center text-slate-700">{m.half}</td>
                <td className="px-2 py-3 text-center text-slate-700">{m.absent}</td>
                <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(m.gross)}</td>
                <td className="px-4 py-3 text-right">
                  {m.otPay > 0 ? (
                    <span className="text-violet-700 font-medium">{formatCurrency(m.otPay)}</span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(m.pf)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(m.esi)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(m.pt)}</td>
                <td className="px-4 py-3 text-right">
                  {m.advanceDeduction > 0 ? (
                    <span className="text-rose-600 font-medium">− {formatCurrency(m.advanceDeduction)}</span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-emerald-700 font-semibold">
                  {formatCurrency(m.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  )
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  )
}

function SummaryCard({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-6 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="px-6 py-4 grid grid-cols-3 gap-2">
        {children}
      </div>
    </div>
  )
}

function Stat({ label, value, pillClass }) {
  return (
    <div className={'rounded-md ring-1 ring-inset px-3 py-2 text-center ' + pillClass}>
      <div className="text-[10px] font-medium opacity-80 uppercase tracking-wide">{label}</div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  )
}

function leaveStatusClass(status) {
  if (status === 'approved')        return 'bg-emerald-100 text-emerald-800'
  if (status === 'rejected')        return 'bg-rose-100 text-rose-800'
  if (status === 'pending_boss')    return 'bg-sky-100 text-sky-800'
  return 'bg-amber-100 text-amber-800'
}
