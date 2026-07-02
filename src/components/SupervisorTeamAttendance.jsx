import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/auth-context'
import { notifyUser } from '../lib/notifications'
import { todayLocal, formatDate } from '../lib/dates'

// Site Incharge marks daily attendance for OTHER supervisors.
// Reads/writes public.supervisor_attendance (migration 53).
// When status = 'absent', notifies every Director (role='boss') via the
// notify_user RPC — one notification per director.

const SUP_STATUS = [
  { value: 'present', label: 'Present', pill: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  { value: 'absent',  label: 'Absent',  pill: 'bg-rose-100 text-rose-800 ring-rose-200'          },
  { value: 'leave',   label: 'Leave',   pill: 'bg-amber-100 text-amber-800 ring-amber-200'       },
  { value: 'on_duty', label: 'OD',      pill: 'bg-sky-100 text-sky-800 ring-sky-200'             },
]

export default function SupervisorTeamAttendance() {
  const { user, profile } = useAuth()
  const [date, setDate] = useState(todayLocal())
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // subject supervisor_id -> { status, marked_by, marked_by_name, saving, savedAt, error }
  const [rows, setRows] = useState({})

  // Load every supervisor except the current Site Incharge themselves.
  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    supabase
      .from('profiles')
      .select('id, full_name, field_manager')
      .eq('role', 'supervisor')
      .neq('id', user.id)
      .order('full_name')
      .then(({ data, error }) => {
        if (!isMounted) return
        if (error) {
          setError(error.message)
          setSupervisors([])
        } else {
          setError(null)
          setSupervisors(data || [])
        }
        setLoading(false)
      })
    return () => { isMounted = false }
  }, [user?.id])

  // Load rows for the selected date + resolve marker names.
  useEffect(() => {
    if (!user?.id || supervisors.length === 0) return
    let isMounted = true
    ;(async () => {
      const { data, error } = await supabase
        .from('supervisor_attendance')
        .select('supervisor_id, status, marked_by')
        .eq('attendance_date', date)
        .in('supervisor_id', supervisors.map((s) => s.id))
      if (!isMounted) return
      if (error) {
        console.error('Failed to load supervisor attendance', error)
        return
      }
      const markerIds = Array.from(new Set((data || []).map((r) => r.marked_by).filter(Boolean)))
      let names = {}
      if (markerIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', markerIds)
        for (const p of profs || []) names[p.id] = p.full_name
      }
      if (!isMounted) return
      const next = {}
      for (const r of data || []) {
        next[r.supervisor_id] = {
          status: r.status,
          marked_by: r.marked_by,
          marked_by_name: r.marked_by ? (names[r.marked_by] || null) : null,
        }
      }
      setRows(next)
    })()
    return () => { isMounted = false }
  }, [user?.id, date, supervisors])

  const markedCount = useMemo(
    () => supervisors.filter((s) => rows[s.id]?.status).length,
    [supervisors, rows]
  )

  const mark = async (supervisor, status) => {
    if (!user?.id) return
    const supId = supervisor.id
    const prevStatus = rows[supId]?.status

    setRows((prev) => ({
      ...prev,
      [supId]: { ...(prev[supId] || {}), status, saving: true, error: null },
    }))

    const { error } = await supabase.from('supervisor_attendance').upsert(
      {
        supervisor_id:   supId,
        marked_by:       user.id,
        attendance_date: date,
        status,
      },
      { onConflict: 'supervisor_id,attendance_date' }
    )

    setRows((prev) => {
      const next = { ...prev }
      const row = { ...(next[supId] || {}) }
      row.saving = false
      if (error) {
        row.error = error.message
      } else {
        row.error = null
        row.status = status
        row.marked_by = user.id
        row.marked_by_name = profile?.full_name || null
        row.savedAt = Date.now()
      }
      next[supId] = row
      return next
    })

    // Fix 3: notify every Director when a supervisor is marked Absent.
    // Fire only on transitions into 'absent' (not on repeated clicks of Absent).
    if (!error && status === 'absent' && prevStatus !== 'absent') {
      const { data: bosses } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'boss')
      const supName = supervisor.full_name || 'A supervisor'
      const pretty  = formatDate(date)
      await Promise.all(
        (bosses || []).map((b) =>
          notifyUser({
            userId:        b.id,
            title:         '❗ Supervisor absent',
            message:       `${supName} was marked absent for ${pretty}.`,
            type:          'supervisor_absent',
            referenceType: 'supervisor_attendance',
          })
        )
      )
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
          <input
            type="date"
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="text-sm text-slate-600">
          {markedCount} / {supervisors.length} marked
          <span className="text-slate-400"> · {formatDate(date)}</span>
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-sm text-slate-500">Loading supervisors…</div>
      ) : error ? (
        <div className="px-6 py-10 text-sm text-rose-600">{error}</div>
      ) : supervisors.length === 0 ? (
        <div className="px-6 py-10 text-sm text-slate-500">No other supervisors to mark.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {supervisors.map((s) => {
            const entry = rows[s.id] || {}
            const showMarkedBy =
              entry.status && entry.marked_by && entry.marked_by !== user.id && entry.marked_by_name
            return (
              <li
                key={s.id}
                className="px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {s.full_name || 'Unnamed supervisor'}
                    {s.field_manager && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                        Site Incharge
                      </span>
                    )}
                  </p>
                  {showMarkedBy && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Marked by: {entry.marked_by_name}
                    </p>
                  )}
                  {entry.error && (
                    <p className="text-xs text-rose-600 mt-0.5">{entry.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {SUP_STATUS.map((opt) => {
                    const selected = entry.status === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => mark(s, opt.value)}
                        disabled={entry.saving}
                        className={
                          'px-3 py-1 text-xs font-medium rounded-md border transition disabled:opacity-60 ' +
                          (selected
                            ? `${opt.pill} border-transparent`
                            : 'border-slate-300 text-slate-700 hover:bg-slate-100')
                        }
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                  <span className="w-4 text-xs text-emerald-600 ml-1">
                    {entry.saving ? '…' : entry.savedAt ? '✓' : ''}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
