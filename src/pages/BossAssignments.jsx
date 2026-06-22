import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import {
  fetchPresentWorkers,
  fetchAssignmentsForDate,
} from '../lib/assignments'
import { todayLocal, formatDate } from '../lib/dates'

export default function BossAssignments() {
  const [date, setDate] = useState(todayLocal())
  const [workers, setWorkers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [liveStatus, setLiveStatus] = useState('connecting')

  const inflightRef = useRef(false)

  const loadData = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const [wk, asn, sup] = await Promise.all([
        fetchPresentWorkers(date),
        fetchAssignmentsForDate(date),
        supabase
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'supervisor')
          .order('full_name'),
      ])
      if (wk.error || asn.error || sup.error) {
        setError((wk.error || asn.error || sup.error).message)
      } else {
        setError(null)
        setWorkers(wk.data || [])
        setAssignments(asn.data || [])
        setSupervisors(sup.data || [])
      }
      setLoading(false)
    } finally {
      inflightRef.current = false
    }
  }, [date])

  useEffect(() => { loadData() }, [loadData])

  // Realtime — same channels as the supervisor picker
  useEffect(() => {
    const channel = supabase
      .channel(`boss-assignments-${date}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_assignments',
          filter: `assignment_date=eq.${date}`,
        },
        () => { loadData() }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance',
          filter: `attendance_date=eq.${date}`,
        },
        () => { loadData() }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveStatus('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLiveStatus('error')
        else if (status === 'CLOSED') setLiveStatus('closed')
      })
    return () => { supabase.removeChannel(channel) }
  }, [date, loadData])

  const groups = useMemo(() => {
    const supById = new Map()
    for (const s of supervisors) {
      supById.set(s.id, { supervisor: s, workers: [], projectName: null, projectLocation: null })
    }
    // Map worker_id → assignment row so we can fetch task_assigned per worker.
    const asnByWorker = new Map()
    for (const a of assignments) asnByWorker.set(a.worker_id || a.worker_table_id, a)

    const unassigned = []
    for (const w of workers) {
      const asn = asnByWorker.get(w.id)
      const supId = asn?.supervisor_id
      if (supId && supById.has(supId)) {
        const g = supById.get(supId)
        // Project info comes from any row owned by this supervisor (they're synced).
        if (!g.projectName)     g.projectName     = asn.project_name
        if (!g.projectLocation) g.projectLocation = asn.project_location
        g.workers.push({ ...w, task_assigned: asn.task_assigned })
      } else {
        unassigned.push(w)
      }
    }
    const list = Array.from(supById.values())
      .filter((g) => g.workers.length > 0) // only show supervisors who picked at least one
      .sort((a, b) =>
        (a.supervisor.full_name || '').localeCompare(b.supervisor.full_name || '')
      )
    return { list, unassigned }
  }, [workers, assignments, supervisors])

  const totalAssigned = assignments.length
  const liveColor =
    liveStatus === 'live' ? 'bg-emerald-500'
    : liveStatus === 'error' ? 'bg-rose-500'
    : 'bg-amber-500'

  return (
    <DashboardShell title="Daily assignments" accent="bg-amber-500">
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6 flex flex-col sm:flex-row sm:items-end gap-4 flex-wrap">
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
        <p className="text-sm text-slate-500 pb-2">{formatDate(date)}</p>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`inline-block h-2 w-2 rounded-full ${liveColor}`} />
            {liveStatus === 'live' ? 'Live updates' : liveStatus === 'error' ? 'Live error' : 'Connecting…'}
          </div>
          <button
            onClick={loadData}
            className="text-sm text-slate-600 border border-slate-300 px-3 py-2 rounded-md hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {/* Top summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Tile label="Present today"   value={workers.length}        pillClass="bg-slate-100 text-slate-800 ring-slate-200" />
        <Tile label="Assigned"        value={totalAssigned}         pillClass="bg-emerald-50 text-emerald-800 ring-emerald-200" />
        <Tile label="Unassigned"      value={groups.unassigned.length} pillClass="bg-amber-50 text-amber-800 ring-amber-200" />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {groups.list.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
              No supervisor has picked their team yet today.
            </div>
          ) : (
            groups.list.map((g) => (
              <div key={g.supervisor.id} className="bg-white border border-slate-200 rounded-lg">
                <div className="px-6 py-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {g.supervisor.full_name || 'Unnamed supervisor'}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {g.workers.length} worker{g.workers.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {(g.projectName || g.projectLocation) ? (
                    <p className="text-xs text-slate-600 mt-1.5">
                      {g.projectName && (
                        <span className="font-medium text-slate-800">{g.projectName}</span>
                      )}
                      {g.projectName && g.projectLocation && ' · '}
                      {g.projectLocation && <span className="text-slate-500">{g.projectLocation}</span>}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 italic mt-1.5">No project info set</p>
                  )}
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.workers.map((w) => (
                    <li key={w.id} className="px-6 py-3 text-sm text-slate-800 flex items-center justify-between gap-3">
                      <span className="truncate">{w.full_name || 'Unnamed worker'}</span>
                      {w.task_assigned && (
                        <span className="text-xs text-slate-500 flex-shrink-0">
                          {w.task_assigned}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          {groups.unassigned.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-amber-50">
                <h3 className="text-sm font-semibold text-amber-900">
                  Unassigned — present but not on any team
                </h3>
                <span className="text-xs text-amber-700">
                  {groups.unassigned.length} worker{groups.unassigned.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {groups.unassigned.map((w) => (
                  <li key={w.id} className="px-6 py-3 text-sm text-slate-800">
                    {w.full_name || 'Unnamed worker'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  )
}

function Tile({ label, value, pillClass }) {
  return (
    <div className={'rounded-lg ring-1 ring-inset px-4 py-3 ' + pillClass}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  )
}
