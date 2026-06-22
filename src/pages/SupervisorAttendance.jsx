import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import AttendanceModeBanner from '../components/AttendanceModeBanner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/auth-context'
import { STATUS_LIST } from '../lib/attendance'
import { todayLocal, formatDate } from '../lib/dates'

export default function SupervisorAttendance() {
  const { user } = useAuth()
  const [date, setDate] = useState(todayLocal())
  const [workers, setWorkers] = useState([])
  const [workersLoading, setWorkersLoading] = useState(true)
  const [workersError, setWorkersError] = useState(null)

  // Map of worker_id -> { status, ot_hours, saving, savingOt, savedAt, otSavedAt, error }
  const [rows, setRows] = useState({})

  // Load ALL workers — any supervisor can mark any worker's attendance.
  // The supervisor_id on each attendance row serves as the audit trail.
  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    supabase
      .from('workers')
      .select('id, full_name')
      .order('full_name')
      .then(({ data, error }) => {
        if (!isMounted) return
        if (error) {
          setWorkersError(error.message)
          setWorkers([])
        } else {
          setWorkersError(null)
          setWorkers(data || [])
        }
        setWorkersLoading(false)
      })
    return () => { isMounted = false }
  }, [user?.id])

  // Load attendance + ot_hours for the selected date
  useEffect(() => {
    if (!user?.id || workers.length === 0) return
    let isMounted = true
    supabase
      .from('attendance')
      .select('worker_id, worker_table_id, status, ot_hours, ot_status')
      .eq('attendance_date', date)
      .in('worker_table_id', workers.map((w) => w.id))
      .then(({ data, error }) => {
        if (!isMounted) return
        if (error) {
          console.error('Failed to load attendance', error)
          return
        }
        const next = {}
        for (const r of data || []) {
          const key = r.worker_id || r.worker_table_id
          if (!key) continue
          next[key] = {
            status: r.status,
            ot_hours: Number(r.ot_hours) || 0,
            ot_status: r.ot_status,
          }
        }
        setRows(next)
      })
    return () => { isMounted = false }
  }, [user?.id, date, workers])

  const markedCount = useMemo(
    () => workers.filter((w) => rows[w.id]?.status).length,
    [workers, rows]
  )

  // Mark attendance status (clears OT if marking absent)
  const mark = async (workerId, status) => {
    if (!user?.id) return
    const currentOt = status === 'absent' ? 0 : (rows[workerId]?.ot_hours ?? 0)

    setRows((prev) => ({
      ...prev,
      [workerId]: {
        ...(prev[workerId] || {}),
        status,
        ot_hours: currentOt,
        saving: true,
        error: null,
      },
    }))

    const { error } = await supabase.from('attendance').upsert(
      {
        worker_id:       workerId,   // matches the unique constraint (worker_id, attendance_date)
        worker_table_id: workerId,   // FK to workers table
        supervisor_id:   user.id,
        attendance_date: date,
        status,
        ot_hours: currentOt,
      },
      { onConflict: 'worker_id,attendance_date' }
    )

    setRows((prev) => {
      const next = { ...prev }
      const row = { ...(next[workerId] || {}) }
      row.saving = false
      if (error) {
        row.error = error.message
      } else {
        row.error = null
        row.status = status
        row.ot_hours = currentOt
        if (currentOt === 0) row.ot_status = null
        row.savedAt = Date.now()
      }
      next[workerId] = row
      return next
    })
  }

  // Update OT hours locally (before blur-save)
  const setOtLocal = (workerId, value) => {
    setRows((prev) => ({
      ...prev,
      [workerId]: {
        ...(prev[workerId] || {}),
        ot_hours: value === '' ? '' : Math.max(0, Number(value) || 0),
        otSavedAt: null,
      },
    }))
  }

  // Save OT hours on blur
  const saveOt = async (workerId) => {
    if (!user?.id) return
    const entry = rows[workerId] || {}
    if (!entry.status || entry.status === 'absent') return
    const ot_hours = Math.max(0, Number(entry.ot_hours) || 0)

    setRows((prev) => ({
      ...prev,
      [workerId]: { ...(prev[workerId] || {}), ot_hours, savingOt: true },
    }))

    const { data, error } = await supabase.from('attendance').upsert(
      {
        worker_id:       workerId,   // matches the unique constraint (worker_id, attendance_date)
        worker_table_id: workerId,   // FK to workers table
        supervisor_id:   user.id,
        attendance_date: date,
        status: entry.status,
        ot_hours,
      },
      { onConflict: 'worker_id,attendance_date' }
    ).select('ot_status').single()

    setRows((prev) => {
      const next = { ...prev }
      const row = { ...(next[workerId] || {}) }
      row.savingOt = false
      if (error) {
        row.error = error.message
      } else {
        row.error = null
        row.ot_hours = ot_hours
        row.ot_status = data?.ot_status ?? row.ot_status
        row.otSavedAt = Date.now()
      }
      next[workerId] = row
      return next
    })
  }

  return (
    <DashboardShell title="Mark Attendance" accent="bg-sky-500">
      <AttendanceModeBanner supervisorOverride />
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="text-sm text-slate-600">
            {markedCount} / {workers.length} marked
            <span className="text-slate-400"> · {formatDate(date)}</span>
          </div>
        </div>

        {workersLoading ? (
          <div className="px-6 py-10 text-sm text-slate-500">Loading workers…</div>
        ) : workersError ? (
          <div className="px-6 py-10 text-sm text-rose-600">{workersError}</div>
        ) : workers.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            No workers found. Ask your Director to add workers to the system.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {workers.map((w) => {
              const entry = rows[w.id] || {}
              const canHaveOt =
                entry.status === 'present' || entry.status === 'half_day'

              return (
                <li
                  key={w.id}
                  className="px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap"
                >
                  {/* Worker name + error */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {w.full_name || 'Unnamed worker'}
                    </p>
                    {entry.error && (
                      <p className="text-xs text-rose-600 mt-0.5">
                        {entry.error}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Status buttons */}
                    <div className="flex items-center gap-1.5">
                      {STATUS_LIST.map((s) => {
                        const selected = entry.status === s.value
                        return (
                          <button
                            key={s.value}
                            onClick={() => mark(w.id, s.value)}
                            disabled={entry.saving}
                            className={
                              'px-3 py-1 text-xs font-medium rounded-md border transition disabled:opacity-60 ' +
                              (selected
                                ? `${s.pill} border-transparent`
                                : 'border-slate-300 text-slate-700 hover:bg-slate-100')
                            }
                          >
                            {s.label}
                          </button>
                        )
                      })}
                      <span className="w-4 text-xs text-emerald-600 ml-1">
                        {entry.saving ? '…' : entry.savedAt ? '✓' : ''}
                      </span>
                    </div>

                    {/* OT hours input — only for present / half-day */}
                    {canHaveOt && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 font-medium">OT</span>
                        <input
                          type="number"
                          min={0}
                          max={24}
                          step={0.5}
                          value={entry.ot_hours ?? 0}
                          onChange={(e) => setOtLocal(w.id, e.target.value)}
                          onFocus={(e) => {
                            if (Number(e.target.value) === 0) {
                              setOtLocal(w.id, '')
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '') {
                              setOtLocal(w.id, 0)
                            }
                            saveOt(w.id)
                          }}
                          disabled={entry.savingOt}
                          placeholder="0"
                          className="w-16 px-2 py-1 border border-slate-300 rounded-md text-xs text-right focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                        />
                        <span className="text-xs text-slate-500">hrs</span>
                        <span className="w-4 text-xs text-amber-600">
                          {entry.savingOt
                            ? '…'
                            : entry.otSavedAt && (entry.ot_hours ?? 0) > 0
                              ? '✓'
                              : ''}
                        </span>
                        {(entry.ot_status === 'pending' || entry.ot_status === 'pending_field_manager') && (
                          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            FM review pending
                          </span>
                        )}
                        {entry.ot_status === 'pending_boss' && (
                          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                            Director approval pending
                          </span>
                        )}
                        {entry.ot_status === 'approved' && (
                          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            OT Approved ✓
                          </span>
                        )}
                        {entry.ot_status === 'rejected' && (
                          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                            Rejected — hours reset
                          </span>
                        )}
                      </div>
                    )}

                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DashboardShell>
  )
}
