import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/payroll'

const MONTHLY_WORKING_DAYS = 26

function effectiveDailyRate(wage, wageType) {
  if (wageType === 'monthly_fixed') return Number(wage) / MONTHLY_WORKING_DAYS
  return Number(wage)
}

const WAGE_TYPES = [
  { value: 'daily_rate', label: 'Daily Rate' },
  { value: 'monthly_fixed', label: 'Monthly Fixed' },
]

function WageTypeToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-medium">
      {WAGE_TYPES.map((t) => {
        const active = value === t.value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`px-2 py-1.5 transition whitespace-nowrap ${
              active ? 'bg-navy text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {t.value === 'daily_rate' ? 'Daily' : 'Monthly'}
          </button>
        )
      })}
    </div>
  )
}

export default function BossWorkers() {
  const [workers, setWorkers] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [designations, setDesignations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState({})
  // Local draft for wage input (so user can type freely before blur-save)
  const [wageInputs, setWageInputs] = useState({})

  useEffect(() => {
    let isMounted = true
    Promise.all([
      supabase
        .from('workers')
        .select('id, full_name, supervisor_id, designation_id, individual_wage, wage_type')
        .order('full_name'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'supervisor')
        .order('full_name'),
      supabase
        .from('designations')
        .select('id, name, daily_wage, wage_type')
        .order('name'),
    ]).then(([wk, sup, des]) => {
      if (!isMounted) return
      if (wk.error || sup.error || des.error) {
        setError((wk.error || sup.error || des.error).message)
      } else {
        setWorkers(wk.data || [])
        setSupervisors(sup.data || [])
        setDesignations(des.data || [])
        // Seed wage input drafts from DB values
        const inputs = {}
        for (const w of wk.data || []) {
          inputs[w.id] = String(Number(w.individual_wage) || 0)
        }
        setWageInputs(inputs)
      }
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [])

  const designationsById = useMemo(() => {
    const m = {}
    for (const d of designations) m[d.id] = d
    return m
  }, [designations])

  const flashSaved = (workerId) => {
    setSavedAt((prev) => ({ ...prev, [workerId]: Date.now() }))
    setTimeout(() => {
      setSavedAt((prev) => {
        if (!prev[workerId]) return prev
        const next = { ...prev }
        delete next[workerId]
        return next
      })
    }, 2500)
  }

  // --- Save helpers ---

  const saveField = async (workerId, fields) => {
    const { error: err } = await supabase
      .from('workers')
      .update(fields)
      .eq('id', workerId)
    if (err) setError(err.message)
    else { setError(null); flashSaved(workerId) }
  }

  const assignSupervisor = async (workerId, supervisorId) => {
    const value = supervisorId || null
    setWorkers((prev) =>
      prev.map((w) => (w.id === workerId ? { ...w, supervisor_id: value } : w))
    )
    await saveField(workerId, { supervisor_id: value })
  }

  // When designation changes: auto-fill individual_wage + wage_type from designation defaults
  const assignDesignation = async (workerId, designationId) => {
    const value = designationId || null
    const desig = value ? designationsById[value] : null
    const autoWage = desig ? Number(desig.daily_wage) || 0 : 0
    const autoType = desig ? (desig.wage_type || 'daily_rate') : 'daily_rate'

    setWorkers((prev) =>
      prev.map((w) =>
        w.id === workerId
          ? { ...w, designation_id: value, individual_wage: autoWage, wage_type: autoType }
          : w
      )
    )
    setWageInputs((prev) => ({ ...prev, [workerId]: String(autoWage) }))
    await saveField(workerId, {
      designation_id: value,
      individual_wage: autoWage,
      wage_type: autoType,
    })
  }

  const assignWageType = async (workerId, wageType) => {
    setWorkers((prev) =>
      prev.map((w) => (w.id === workerId ? { ...w, wage_type: wageType } : w))
    )
    await saveField(workerId, { wage_type: wageType })
  }

  const saveWage = async (workerId) => {
    const raw = wageInputs[workerId] ?? '0'
    const parsed = Math.max(0, parseFloat(raw) || 0)
    // Normalise input to the parsed value
    setWageInputs((prev) => ({ ...prev, [workerId]: String(parsed) }))
    setWorkers((prev) =>
      prev.map((w) => (w.id === workerId ? { ...w, individual_wage: parsed } : w))
    )
    await saveField(workerId, { individual_wage: parsed })
  }

  return (
    <DashboardShell title="Workers">
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {designations.length === 0 && !loading && (
        <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          No designations exist yet. Create some on the{' '}
          <a href="/boss/designations" className="font-medium underline">
            Designations
          </a>{' '}
          page before assigning roles to workers.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Supervisor</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Wage type</th>
              <th className="px-4 py-3">Individual wage</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">Loading…</td>
              </tr>
            ) : workers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">No workers yet.</td>
              </tr>
            ) : (
              workers.map((w) => {
                const wageType = w.wage_type || 'daily_rate'
                const wageDraft = wageInputs[w.id] ?? '0'
                const unitLabel = wageType === 'monthly_fixed' ? '/ month' : '/ day'
                const equivDaily =
                  wageType === 'monthly_fixed'
                    ? effectiveDailyRate(w.individual_wage, 'monthly_fixed')
                    : null

                return (
                  <tr key={w.id} className="hover:bg-slate-50 transition-colors">
                    {/* Worker name — links to full profile */}
                    <td className="px-4 py-3 font-medium text-slate-800">
                      <Link
                        to={`/boss/workers/${w.id}`}
                        className="text-slate-900 hover:text-brand hover:underline"
                      >
                        {w.full_name || 'Unnamed'}
                      </Link>
                    </td>

                    {/* Supervisor */}
                    <td className="px-4 py-3">
                      <select
                        value={w.supervisor_id ?? ''}
                        onChange={(e) => assignSupervisor(w.id, e.target.value)}
                        className="px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                      >
                        <option value="">— Unassigned —</option>
                        {supervisors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name || s.id}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Designation */}
                    <td className="px-4 py-3">
                      <select
                        value={w.designation_id ?? ''}
                        onChange={(e) => assignDesignation(w.id, e.target.value)}
                        disabled={designations.length === 0}
                        className="px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60"
                      >
                        <option value="">— None —</option>
                        {designations.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </td>

                    {/* Wage type toggle */}
                    <td className="px-4 py-3">
                      <WageTypeToggle
                        value={wageType}
                        onChange={(t) => assignWageType(w.id, t)}
                      />
                    </td>

                    {/* Individual wage input */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 text-xs">₹</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={wageDraft}
                            onChange={(e) =>
                              setWageInputs((prev) => ({ ...prev, [w.id]: e.target.value }))
                            }
                            onBlur={() => saveWage(w.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                            className="w-24 px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                          />
                          <span className="text-xs text-slate-500">{unitLabel}</span>
                        </div>
                        {equivDaily !== null && (
                          <span className="text-xs text-slate-400 pl-4">
                            ≈ {formatCurrency(equivDaily)}/day equiv.
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Save indicator */}
                    <td className="px-4 py-3 text-emerald-600 text-sm font-medium">
                      {savedAt[w.id] ? '✓' : ''}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Selecting a designation auto-fills the wage from its default. You can override it per worker — payroll always uses the individual amount above.
      </p>
    </DashboardShell>
  )
}
