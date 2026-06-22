import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/payroll'

const WAGE_TYPES = [
  { value: 'daily_rate',    label: 'Daily Rate',     sublabel: '/ day'   },
  { value: 'monthly_fixed', label: 'Monthly Fixed',  sublabel: '/ month' },
]

function wageLabel(wageType) {
  return WAGE_TYPES.find((t) => t.value === wageType) ?? WAGE_TYPES[0]
}

export default function BossDesignations() {
  const [designations, setDesignations] = useState([])
  const [workerDesigIds, setWorkerDesigIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState({})

  // Local edits per row: { name?, wage?, wageType? }
  const [draft, setDraft] = useState({})

  // New-designation form
  const [newName, setNewName] = useState('')
  const [newWage, setNewWage] = useState('')
  const [newWageType, setNewWageType] = useState('daily_rate')
  const [creating, setCreating] = useState(false)

  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let isMounted = true
    Promise.all([
      supabase
        .from('designations')
        .select('id, name, daily_wage, wage_type')
        .order('name'),
      supabase
        .from('workers')
        .select('designation_id')
        .not('designation_id', 'is', null),
    ]).then(([des, wk]) => {
      if (!isMounted) return
      if (des.error || wk.error) {
        setError((des.error || wk.error).message)
      } else {
        setDesignations(des.data || [])
        setWorkerDesigIds((wk.data || []).map((r) => r.designation_id))
      }
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [refreshTick])

  const counts = useMemo(() => {
    const m = {}
    for (const id of workerDesigIds) m[id] = (m[id] || 0) + 1
    return m
  }, [workerDesigIds])

  const flashSaved = (id) =>
    setSavedAt((prev) => ({ ...prev, [id]: Date.now() }))

  const patchDraft = (id, patch) =>
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))

  // ── Add new designation ──────────────────────────────────
  const addDesignation = async (e) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) { setError('Name is required.'); return }
    const wage = newWage === '' ? 0 : Number(newWage)
    if (Number.isNaN(wage) || wage < 0) {
      setError('Wage must be a non-negative number.')
      return
    }
    setCreating(true)
    setError(null)
    const { error: err } = await supabase
      .from('designations')
      .insert({ name: trimmed, daily_wage: wage, wage_type: newWageType })
    setCreating(false)
    if (err) { setError(err.message); return }
    setNewName('')
    setNewWage('')
    setNewWageType('daily_rate')
    setRefreshTick((t) => t + 1)
  }

  // ── Save existing row ────────────────────────────────────
  const saveRow = async (row) => {
    const d = draft[row.id] || {}
    const name = (d.name ?? row.name).trim()
    const wageRaw = d.wage ?? String(row.daily_wage)
    const wage = wageRaw === '' ? 0 : Number(wageRaw)
    const wageType = d.wageType ?? row.wage_type ?? 'daily_rate'

    if (!name) { setError('Name is required.'); return }
    if (Number.isNaN(wage) || wage < 0) {
      setError('Wage must be a non-negative number.')
      return
    }
    setError(null)

    // Optimistic update
    setDesignations((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, name, daily_wage: wage, wage_type: wageType } : r
      )
    )
    setDraft((prev) => { const n = { ...prev }; delete n[row.id]; return n })

    const { error: err } = await supabase
      .from('designations')
      .update({ name, daily_wage: wage, wage_type: wageType })
      .eq('id', row.id)
    if (err) { setError(err.message); setRefreshTick((t) => t + 1); return }
    flashSaved(row.id)
  }

  // ── Delete row ───────────────────────────────────────────
  const removeRow = async (row) => {
    if (!window.confirm(`Delete designation "${row.name}"?`)) return
    setError(null)
    const { error: err } = await supabase
      .from('designations')
      .delete()
      .eq('id', row.id)
    if (err) {
      const assigned = counts[row.id] || 0
      setError(
        assigned > 0
          ? `Cannot delete — ${assigned} worker${assigned === 1 ? '' : 's'} still assigned to "${row.name}". Reassign them on the Workers page first.`
          : err.message
      )
      return
    }
    setRefreshTick((t) => t + 1)
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <DashboardShell title="Designations">
      {/* Add form */}
      <form
        onSubmit={addDesignation}
        className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6"
      >
        <p className="text-sm font-semibold text-slate-800 mb-4">Add designation</p>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
          {/* Name */}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Fitter, Rigger, Safety Officer"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {/* Wage type */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Wage type</label>
            <WageTypeToggle
              value={newWageType}
              onChange={setNewWageType}
            />
          </div>

          {/* Wage amount */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              {wageLabel(newWageType).label} amount
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-sm">₹</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={newWage}
                onChange={(e) => setNewWage(e.target.value)}
                placeholder="0"
                className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <span className="text-xs text-slate-400">{wageLabel(newWageType).sublabel}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition self-end"
          >
            {creating ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>

      {error && (
        <p className="mb-4 text-sm text-brand bg-brand-light border border-brand/20 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 w-64">Name</th>
                <th className="px-5 py-3">Wage type</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3 text-center w-20">Workers</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-slate-500">Loading…</td>
                </tr>
              ) : designations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-slate-500">
                    No designations yet. Add one above.
                  </td>
                </tr>
              ) : (
                designations.map((row) => {
                  const d = draft[row.id] || {}
                  const nameVal   = d.name     ?? row.name
                  const wageVal   = d.wage     != null ? d.wage : String(Number(row.daily_wage) || 0)
                  const wageType  = d.wageType ?? row.wage_type ?? 'daily_rate'
                  const wt        = wageLabel(wageType)
                  const dirty =
                    (d.name != null && d.name.trim() !== row.name) ||
                    (d.wage != null && Number(d.wage || 0) !== Number(row.daily_wage)) ||
                    (d.wageType != null && d.wageType !== row.wage_type)
                  const assigned = counts[row.id] || 0

                  return (
                    <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Name */}
                      <td className="px-5 py-3">
                        <input
                          type="text"
                          value={nameVal}
                          onChange={(e) => patchDraft(row.id, { name: e.target.value })}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </td>

                      {/* Wage type toggle */}
                      <td className="px-5 py-3">
                        <WageTypeToggle
                          value={wageType}
                          onChange={(v) => patchDraft(row.id, { wageType: v })}
                          compact
                        />
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 text-sm">₹</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="1"
                            value={wageVal}
                            onChange={(e) => patchDraft(row.id, { wage: e.target.value })}
                            className="w-28 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                          />
                          <span className="text-xs text-slate-400 whitespace-nowrap">
                            {wt.sublabel}
                            {wageType === 'monthly_fixed' && Number(wageVal) > 0 && (
                              <span className="ml-1 text-slate-300">
                                ({formatCurrency(Number(wageVal) / 26)}/day equiv.)
                              </span>
                            )}
                          </span>
                        </div>
                      </td>

                      {/* Workers count */}
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold ${assigned > 0 ? 'bg-brand-light text-brand' : 'text-slate-400'}`}>
                          {assigned}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {savedAt[row.id] && !dirty && (
                            <span className="text-xs text-emerald-600">Saved ✓</span>
                          )}
                          <button
                            onClick={() => saveRow(row)}
                            disabled={!dirty}
                            className="px-3 py-1 text-xs font-medium rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-40 text-white transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => removeRow(row)}
                            className="px-3 py-1 text-xs font-medium rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 transition"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && designations.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
            {designations.length} designation{designations.length !== 1 ? 's' : ''} ·{' '}
            Monthly-fixed wages are prorated by days present (÷ 26 working days)
          </div>
        )}
      </div>
    </DashboardShell>
  )
}

// ── Wage type segmented toggle ─────────────────────────────

function WageTypeToggle({ value, onChange, compact = false }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-medium">
      {WAGE_TYPES.map((t) => {
        const active = value === t.value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`px-2.5 py-1.5 transition whitespace-nowrap ${
              active
                ? 'bg-navy text-white'
                : 'bg-white text-slate-500 hover:bg-slate-50'
            } ${compact ? '' : 'px-3 py-2'}`}
          >
            {compact ? (t.value === 'daily_rate' ? 'Daily' : 'Monthly') : t.label}
          </button>
        )
      })}
    </div>
  )
}
