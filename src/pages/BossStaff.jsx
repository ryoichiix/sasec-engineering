import { useEffect, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'

export default function BossStaff() {
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState({}) // id -> bool
  const [savedAt, setSavedAt] = useState({}) // id -> timestamp

  useEffect(() => {
    let isMounted = true
    supabase
      .from('profiles')
      .select('id, full_name, is_field_manager, created_at')
      .eq('role', 'supervisor')
      .order('full_name')
      .then(({ data, error: err }) => {
        if (!isMounted) return
        if (err) setError(err.message)
        else setSupervisors(data || [])
        setLoading(false)
      })
    return () => { isMounted = false }
  }, [])

  const toggleFM = async (supervisor) => {
    const next = !supervisor.is_field_manager
    setSaving((p) => ({ ...p, [supervisor.id]: true }))
    setSupervisors((prev) =>
      prev.map((s) =>
        s.id === supervisor.id ? { ...s, is_field_manager: next } : s
      )
    )

    const { error: err } = await supabase
      .from('profiles')
      .update({ is_field_manager: next })
      .eq('id', supervisor.id)

    if (err) {
      setError(err.message)
      // Roll back optimistic update
      setSupervisors((prev) =>
        prev.map((s) =>
          s.id === supervisor.id ? { ...s, is_field_manager: !next } : s
        )
      )
    } else {
      setSavedAt((p) => ({ ...p, [supervisor.id]: Date.now() }))
      setTimeout(() => {
        setSavedAt((p) => { const n = { ...p }; delete n[supervisor.id]; return n })
      }, 2500)
    }

    setSaving((p) => { const n = { ...p }; delete n[supervisor.id]; return n })
  }

  const fmCount = supervisors.filter((s) => s.is_field_manager).length

  return (
    <DashboardShell title="Staff management">
      <div className="mb-6 bg-violet-50 border border-violet-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⭐</span>
          <div>
            <p className="text-sm font-semibold text-violet-900">Site Incharge role</p>
            <p className="text-sm text-violet-700 mt-0.5">
              A Site Incharge is a supervisor who reviews leave requests before they reach you.
              They can approve (sending to you for final sign-off) or reject outright.
              You currently have <span className="font-semibold">{fmCount}</span> Site Incharge{fmCount === 1 ? '' : 's'} assigned.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-3">Supervisor</th>
              <th className="px-6 py-3">Site Incharge</th>
              <th className="px-6 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-6 py-6 text-slate-500">Loading…</td>
              </tr>
            ) : supervisors.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-6 text-slate-500">
                  No supervisors yet. Create supervisor accounts from Sign Up.
                </td>
              </tr>
            ) : (
              supervisors.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-900">
                      {s.full_name || 'Unnamed supervisor'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{s.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-6 py-4">
                    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                      <button
                        role="switch"
                        aria-checked={s.is_field_manager}
                        disabled={saving[s.id]}
                        onClick={() => toggleFM(s)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 ${
                          s.is_field_manager ? 'bg-violet-600' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            s.is_field_manager ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      {s.is_field_manager ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 bg-violet-100 ring-1 ring-inset ring-violet-200 px-2 py-0.5 rounded-full">
                          ⭐ Site Incharge
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Regular supervisor</span>
                      )}
                    </label>
                  </td>
                  <td className="px-6 py-4 text-emerald-600 text-sm font-medium">
                    {saving[s.id] ? '…' : savedAt[s.id] ? '✓' : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  )
}
