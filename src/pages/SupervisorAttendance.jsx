import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import AttendanceModeBanner from '../components/AttendanceModeBanner'
import SupervisorTeamAttendance from '../components/SupervisorTeamAttendance'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/auth-context'
import { STATUS_LIST } from '../lib/attendance'
import { isDirector, workerDesignationName, fetchStaffIdentity, isDualRoleWorker } from '../lib/workers'
import { todayLocal, formatDate } from '../lib/dates'

export default function SupervisorAttendance() {
  const { user, profile } = useAuth()
  const isFM = profile?.field_manager === true

  const [tab, setTab] = useState('workers') // 'workers' | 'supervisors'

  const [date, setDate] = useState(todayLocal())
  const [workers, setWorkers] = useState([])
  const [workersLoading, setWorkersLoading] = useState(true)
  const [workersError, setWorkersError] = useState(null)

  // Search + filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterWageType, setFilterWageType] = useState('')
  const [filterDesignation, setFilterDesignation] = useState('')

  // Map of worker_id -> { status, ot_hours, marked_by_name, saving, savingOt, savedAt, otSavedAt, error }
  const [rows, setRows] = useState({})

  // Dual-role detection: workers who are also supervisors/Director. Only a Site
  // Incharge may mark/give-advance to them; a regular supervisor sees them
  // locked. (See memory: dual-role-staff.)
  const [staff, setStaff] = useState({ ids: new Set(), names: new Set() })
  useEffect(() => {
    let isMounted = true
    fetchStaffIdentity().then((s) => { if (isMounted) setStaff(s) })
    return () => { isMounted = false }
  }, [])

  // Load every worker from public.workers. Some workers are also supervisors
  // (dual-role: a supervisor login PLUS a worker/payroll record) — those are
  // legitimate workers and must remain markable here, so we do NOT filter them
  // out. Supervisor-vs-supervisor marking is a separate concern handled by the
  // Site Incharge "Supervisors" tab below.
  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    supabase
      .from('workers')
      .select('id, full_name, wage_type, designation_id, designation_name, supervisor_id, designations(name)')
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

  // Load attendance + ot_hours + marked_by for the selected date
  useEffect(() => {
    if (!user?.id || workers.length === 0) return
    let isMounted = true
    ;(async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('worker_id, worker_table_id, status, ot_hours, ot_status, marked_by')
        .eq('attendance_date', date)
        .in('worker_table_id', workers.map((w) => w.id))
      if (!isMounted) return
      if (error) {
        console.error('Failed to load attendance', error)
        return
      }
      // Resolve marker names for display.
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
        const key = r.worker_id || r.worker_table_id
        if (!key) continue
        next[key] = {
          status: r.status,
          ot_hours: Number(r.ot_hours) || 0,
          ot_status: r.ot_status,
          marked_by: r.marked_by,
          marked_by_name: r.marked_by ? (names[r.marked_by] || null) : null,
        }
      }
      setRows(next)
    })()
    return () => { isMounted = false }
  }, [user?.id, date, workers])

  // A regular supervisor (not Site Incharge) cannot mark dual-role staff, so
  // they are excluded from both the "marked" numerator and the denominator.
  const markedCount = useMemo(
    () => workers.filter((w) => (isFM || !isDualRoleWorker(w, staff)) && rows[w.id]?.status).length,
    [workers, rows, staff, isFM]
  )
  const markableTotal = useMemo(
    () => workers.filter((w) => isFM || !isDualRoleWorker(w, staff)).length,
    [workers, staff, isFM]
  )

  const designations = useMemo(
    () =>
      [...new Set(workers.map(workerDesignationName).filter(Boolean))].sort(),
    [workers]
  )

  const filteredWorkers = useMemo(
    () =>
      workers.filter((w) => {
        if (
          searchQuery &&
          !w.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
        )
          return false
        if (filterWageType && w.wage_type !== filterWageType) return false
        if (filterDesignation && workerDesignationName(w) !== filterDesignation)
          return false
        return true
      }),
    [workers, searchQuery, filterWageType, filterDesignation]
  )

  // Group regular workers first, dual-role staff (supervisors) at the bottom
  // under a subtle divider — for every viewer.
  const regularWorkers = useMemo(
    () => filteredWorkers.filter((w) => !isDualRoleWorker(w, staff)),
    [filteredWorkers, staff]
  )
  const dualWorkers = useMemo(
    () => filteredWorkers.filter((w) => isDualRoleWorker(w, staff)),
    [filteredWorkers, staff]
  )

  // Mark attendance status (clears OT if marking absent)
  const mark = async (worker, status) => {
    if (!user?.id) return
    // Regular supervisors cannot mark dual-role staff — Site Incharge only.
    if (!isFM && isDualRoleWorker(worker, staff)) return
    const workerId = worker.id
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

    // supervisor_id = worker's assigned supervisor (falls back to marker if unassigned).
    // marked_by     = the supervisor doing the marking (audit trail).
    const assignedSupervisorId = worker.supervisor_id || user.id

    const { error } = await supabase.from('attendance').upsert(
      {
        worker_id:       workerId,
        worker_table_id: workerId,
        supervisor_id:   assignedSupervisorId,
        marked_by:       user.id,
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
        row.marked_by = user.id
        row.marked_by_name = profile?.full_name || null
        row.savedAt = Date.now()
      }
      next[workerId] = row
      return next
    })
  }

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

  const saveOt = async (worker) => {
    if (!user?.id) return
    if (!isFM && isDualRoleWorker(worker, staff)) return
    const workerId = worker.id
    const entry = rows[workerId] || {}
    if (!entry.status || entry.status === 'absent') return
    const ot_hours = Math.max(0, Number(entry.ot_hours) || 0)

    setRows((prev) => ({
      ...prev,
      [workerId]: { ...(prev[workerId] || {}), ot_hours, savingOt: true },
    }))

    const assignedSupervisorId = worker.supervisor_id || user.id

    const { data, error } = await supabase.from('attendance').upsert(
      {
        worker_id:       workerId,
        worker_table_id: workerId,
        supervisor_id:   assignedSupervisorId,
        marked_by:       user.id,
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
        row.marked_by = user.id
        row.marked_by_name = profile?.full_name || null
        row.otSavedAt = Date.now()
      }
      next[workerId] = row
      return next
    })
  }

  // Single worker row. Dual-role staff get a muted "Supervisor" badge; when the
  // viewer is a regular supervisor they are locked ("Site Incharge only").
  const renderWorkerRow = (w) => {
    const entry = rows[w.id] || {}
    const director = isDirector(w)
    const dualRole = isDualRoleWorker(w, staff)
    const restricted = dualRole && !isFM
    const canHaveOt = entry.status === 'present' || entry.status === 'half_day'
    const showMarkedBy =
      entry.status && entry.marked_by && entry.marked_by !== user.id && entry.marked_by_name

    return (
      <li
        key={w.id}
        className="px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
            <span className="truncate">{w.full_name || 'Unnamed worker'}</span>
            {dualRole && (
              <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
                Supervisor
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

        <div className="flex items-center gap-3 flex-wrap">
          {director ? (
            <span className="px-3 py-1 text-xs font-bold rounded-md bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200">
              OD
            </span>
          ) : restricted ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-slate-50 text-slate-400 ring-1 ring-inset ring-slate-200">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Site Incharge only
            </span>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                {STATUS_LIST.map((s) => {
                  const selected = entry.status === s.value
                  return (
                    <button
                      key={s.value}
                      onClick={() => mark(w, s.value)}
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
                      saveOt(w)
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
            </>
          )}
        </div>
      </li>
    )
  }

  return (
    <DashboardShell title="Mark Attendance" accent="bg-sky-500">
      <AttendanceModeBanner supervisorOverride />

      {isFM && (
        <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          <button
            onClick={() => setTab('workers')}
            className={
              'px-4 py-1.5 rounded-md font-medium transition ' +
              (tab === 'workers'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100')
            }
          >
            Workers
          </button>
          <button
            onClick={() => setTab('supervisors')}
            className={
              'px-4 py-1.5 rounded-md font-medium transition ' +
              (tab === 'supervisors'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100')
            }
          >
            Supervisors
          </button>
        </div>
      )}

      {isFM && tab === 'supervisors' ? (
        <SupervisorTeamAttendance />
      ) : (
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
            {markedCount} / {markableTotal} marked
            <span className="text-slate-400"> · {formatDate(date)}</span>
          </div>
        </div>

        {!workersLoading && !workersError && workers.length > 0 && (
          <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-md px-3 py-2 flex-1 min-w-48">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search worker name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 text-sm outline-none text-slate-700 placeholder-slate-300 bg-transparent"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-slate-300 hover:text-slate-500 text-xs">✕</button>
              )}
            </div>

            <select
              value={filterWageType}
              onChange={(e) => setFilterWageType(e.target.value)}
              className="bg-white border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-600 outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">All wage types</option>
              <option value="daily_rate">Daily wage</option>
              <option value="monthly_fixed">Monthly wage</option>
            </select>

            <select
              value={filterDesignation}
              onChange={(e) => setFilterDesignation(e.target.value)}
              className="bg-white border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-600 outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">All designations</option>
              {designations.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            {(searchQuery || filterWageType || filterDesignation) && (
              <button
                onClick={() => { setSearchQuery(''); setFilterWageType(''); setFilterDesignation('') }}
                className="text-xs text-slate-400 hover:text-slate-600 px-2"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {workersLoading ? (
          <div className="px-6 py-10 text-sm text-slate-500">Loading workers…</div>
        ) : workersError ? (
          <div className="px-6 py-10 text-sm text-rose-600">{workersError}</div>
        ) : workers.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            No workers found. Ask your Director to add workers to the system.
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            No workers match the current search or filters.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {regularWorkers.map(renderWorkerRow)}
            {dualWorkers.length > 0 && (
              <li className="px-6 py-2 bg-slate-50 border-t border-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Also supervisors{!isFM ? ' · Site Incharge marks these' : ''}
                </p>
              </li>
            )}
            {dualWorkers.map(renderWorkerRow)}
          </ul>
        )}
      </div>
      )}
    </DashboardShell>
  )
}
