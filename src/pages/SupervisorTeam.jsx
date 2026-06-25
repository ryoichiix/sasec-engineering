import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/auth-context'
import {
  fetchPresentWorkers,
  fetchAssignmentsForDate,
  fetchSupervisorNames,
  claimWorker,
  releaseWorker,
  updateAssignmentTask,
} from '../lib/assignments'
import { isDirector } from '../lib/workers'
import { todayLocal, formatDate } from '../lib/dates'

export default function SupervisorTeam() {
  const { user } = useAuth()
  const myId = user?.id
  const [date, setDate] = useState(todayLocal())
  const [filterDesignation, setFilterDesignation] = useState('')

  const [workers, setWorkers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [supervisorNames, setSupervisorNames] = useState({})
  const [designations, setDesignations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [flashMsg, setFlashMsg] = useState(null)
  const [pending, setPending] = useState({}) // worker_id -> bool
  const [liveStatus, setLiveStatus] = useState('connecting')

  // Per-worker task — { [assignmentId]: { value, saving, saved } }
  const [taskEdits, setTaskEdits] = useState({})

  // Used to suppress overlapping reloads from rapid realtime bursts
  const inflightRef = useRef(false)

  // ── Loader (called on mount, date change, and every realtime event) ──
  const loadData = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const [presentRes, assignRes, desRes] = await Promise.all([
        fetchPresentWorkers(date),
        fetchAssignmentsForDate(date),
        supabase.from('designations').select('id, name').order('name'),
      ])
      if (presentRes.error || assignRes.error || desRes.error) {
        setError((presentRes.error || assignRes.error || desRes.error).message)
      } else {
        setError(null)
        setWorkers(presentRes.data || [])
        setAssignments(assignRes.data || [])
        setDesignations(desRes.data || [])

        // Fetch names of every supervisor who owns at least one row
        const supIds = Array.from(
          new Set((assignRes.data || []).map((a) => a.supervisor_id))
        )
        if (supIds.length > 0) {
          const { data: names } = await fetchSupervisorNames(supIds)
          if (names) setSupervisorNames(names)
        }
      }
      setLoading(false)
    } finally {
      inflightRef.current = false
    }
  }, [date])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Realtime subscription ──────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`team-picker-${date}-${myId}`)
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
  }, [date, myId, loadData])

  // ── Derived buckets ────────────────────────────────────────
  const assignmentByWorker = useMemo(() => {
    const m = new Map()
    // Use worker_id as the key (it's the constrained column); fall back to worker_table_id
    for (const a of assignments) m.set(a.worker_id || a.worker_table_id, a)
    return m
  }, [assignments])

  const designationsById = useMemo(() => {
    const m = {}
    for (const d of designations) m[d.id] = d
    return m
  }, [designations])

  const myTeam = useMemo(
    () => workers.filter((w) => assignmentByWorker.get(w.id)?.supervisor_id === myId),
    [workers, assignmentByWorker, myId]
  )

  const availablePool = useMemo(() => {
    // Directors never enter the worker pool.
    const free = workers.filter(
      (w) => !assignmentByWorker.has(w.id) && !isDirector(w)
    )
    if (!filterDesignation) return free
    return free.filter((w) => w.designation_id === filterDesignation)
  }, [workers, assignmentByWorker, filterDesignation])

  const otherTeams = useMemo(() => {
    const bySup = new Map()
    for (const w of workers) {
      const asn = assignmentByWorker.get(w.id)
      if (asn && asn.supervisor_id !== myId) {
        if (!bySup.has(asn.supervisor_id)) {
          bySup.set(asn.supervisor_id, {
            workers: [],
            projectName:     asn.project_name,
            projectLocation: asn.project_location,
          })
        }
        bySup.get(asn.supervisor_id).workers.push({ ...w, task_assigned: asn.task_assigned })
      }
    }
    return Array.from(bySup.entries())
      .map(([supId, info]) => ({
        supervisorId:    supId,
        supervisorName:  supervisorNames[supId] || 'Supervisor',
        projectName:     info.projectName,
        projectLocation: info.projectLocation,
        workers:         [...info.workers].sort((a, b) =>
          (a.full_name || '').localeCompare(b.full_name || '')
        ),
      }))
      .sort((a, b) => a.supervisorName.localeCompare(b.supervisorName))
  }, [workers, assignmentByWorker, myId, supervisorNames])

  // ── Actions ────────────────────────────────────────────────
  const claim = async (worker) => {
    if (!myId) return
    setPending((p) => ({ ...p, [worker.id]: true }))
    setFlashMsg(null)
    setError(null)
    const { error: err } = await claimWorker(worker.id, myId, date)
    setPending((p) => { const n = { ...p }; delete n[worker.id]; return n })
    if (err) {
      if (err.code === '23505') {
        setFlashMsg(`${worker.full_name || 'That worker'} was just picked by another supervisor.`)
      } else {
        setError(err.message)
      }
      loadData()
      return
    }
    // Optimistic refresh — realtime will also fire, but this feels snappier
    loadData()
  }

  const release = async (worker) => {
    if (!myId) return
    setPending((p) => ({ ...p, [worker.id]: true }))
    setFlashMsg(null)
    setError(null)
    const { error: err } = await releaseWorker(worker.id, date)
    setPending((p) => { const n = { ...p }; delete n[worker.id]; return n })
    if (err) {
      setError(err.message)
      return
    }
    loadData()
  }

  // Save per-worker task on blur.
  const saveWorkerTask = async (assignmentId) => {
    const edit = taskEdits[assignmentId]
    if (!edit) return
    setTaskEdits((p) => ({ ...p, [assignmentId]: { ...edit, saving: true, saved: false } }))
    const { error: err } = await updateAssignmentTask(assignmentId, edit.value)
    setTaskEdits((p) => ({
      ...p,
      [assignmentId]: { ...p[assignmentId], saving: false, saved: !err, error: err?.message },
    }))
    if (!err) loadData()
  }

  const liveColor =
    liveStatus === 'live' ? 'bg-emerald-500'
    : liveStatus === 'error' ? 'bg-rose-500'
    : 'bg-amber-500'

  return (
    <DashboardShell title="Today's team" accent="bg-sky-500">
      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6 flex flex-col sm:flex-row sm:items-end gap-4 flex-wrap">
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
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Filter pool by designation
          </label>
          <select
            value={filterDesignation}
            onChange={(e) => setFilterDesignation(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">All designations</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`inline-block h-2 w-2 rounded-full ${liveColor}`} />
            {liveStatus === 'live' ? 'Live updates'
             : liveStatus === 'error' ? 'Live error — using manual refresh'
             : 'Connecting…'}
          </div>
          <button
            onClick={loadData}
            className="text-sm text-slate-600 border border-slate-300 px-3 py-2 rounded-md hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {flashMsg && (
        <div className="mb-4 px-4 py-2 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
          {flashMsg}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-2 rounded-md bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-8">
          {/* ── My team ─────────────────────────────────── */}
          <Section
            title={`My team — ${formatDate(date)}`}
            count={myTeam.length}
            countLabel="picked"
            variant="white"
          >
            {myTeam.length === 0 ? (
              <Empty>You haven't picked any workers yet. Add from the pool below.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {myTeam.map((w) => {
                  const asn = assignmentByWorker.get(w.id)
                  const edit = taskEdits[asn?.id]
                  const taskValue = edit?.value ?? asn?.task_assigned ?? ''
                  return (
                    <li
                      key={w.id}
                      className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#0F172A] truncate">
                          {w.full_name || 'Unnamed worker'}
                        </p>
                        {w.designation_id && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {designationsById[w.designation_id]?.name}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                        <input
                          type="text"
                          value={taskValue}
                          onChange={(e) =>
                            setTaskEdits((p) => ({
                              ...p,
                              [asn.id]: { value: e.target.value, saved: false },
                            }))
                          }
                          onBlur={() => {
                            // Only persist if changed
                            if (taskValue !== (asn?.task_assigned ?? '')) {
                              saveWorkerTask(asn.id)
                            }
                          }}
                          placeholder="Task (e.g. Welding work)"
                          className="flex-1 sm:w-56 px-2.5 py-1.5 border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#C0272D] focus:border-[#C0272D]"
                        />
                        <span className="w-4 text-xs text-[#C0272D]">
                          {edit?.saving ? '…' : edit?.saved ? '✓' : ''}
                        </span>
                        <button
                          onClick={() => release(w)}
                          disabled={!!pending[w.id]}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          {pending[w.id] ? '…' : 'Remove'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          {/* ── Available pool ──────────────────────────── */}
          <Section
            title="Available pool"
            count={availablePool.length}
            countLabel={filterDesignation ? 'matching' : 'available'}
            extraInfo={
              filterDesignation
                ? `${workers.filter(w => !assignmentByWorker.has(w.id)).length} total free`
                : null
            }
            variant="brand"
          >
            {availablePool.length === 0 ? (
              <Empty>
                {filterDesignation
                  ? 'No free workers match that designation.'
                  : 'No workers available — they\'re either not marked Present today or already on a team.'}
              </Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {availablePool.map((w) => (
                  <li
                    key={w.id}
                    className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#0F172A] truncate">
                        {w.full_name || 'Unnamed worker'}
                      </p>
                      {w.designation_id && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {designationsById[w.designation_id]?.name}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => claim(w)}
                      disabled={!!pending[w.id]}
                      className="text-xs font-semibold px-3.5 py-1.5 rounded-md bg-[#C0272D] hover:bg-[#A01E23] text-white disabled:opacity-60 transition shadow-sm"
                    >
                      {pending[w.id] ? 'Adding…' : 'Add to my team'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Other supervisors' teams ────────────────── */}
          <Section
            title="Other supervisors' teams"
            count={otherTeams.length}
            countLabel={`supervisor${otherTeams.length === 1 ? '' : 's'}`}
            variant="slate"
            readOnly
          >
            {otherTeams.length === 0 ? (
              <Empty>No other supervisor has picked workers yet today.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {otherTeams.map((g) => (
                  <li key={g.supervisorId} className="px-6 py-3.5">
                    <p className="text-sm font-semibold text-[#0F172A] mb-0.5">
                      {g.supervisorName}{' '}
                      <span className="text-xs font-normal text-slate-400">
                        ({g.workers.length} worker{g.workers.length === 1 ? '' : 's'})
                      </span>
                    </p>
                    {(g.projectName || g.projectLocation) && (
                      <p className="text-xs text-slate-500 mb-1.5">
                        {g.projectName && <span className="font-medium text-slate-700">{g.projectName}</span>}
                        {g.projectName && g.projectLocation && ' · '}
                        {g.projectLocation && <span>{g.projectLocation}</span>}
                      </p>
                    )}
                    <ul className="text-sm text-slate-600 space-y-0.5">
                      {g.workers.map((w) => (
                        <li key={w.id} className="flex items-center gap-2">
                          <span>{w.full_name || 'Unnamed'}</span>
                          {w.task_assigned && (
                            <span className="text-xs text-slate-500">— {w.task_assigned}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </DashboardShell>
  )
}

// ── Tiny UI helpers ─────────────────────────────────────────

const SECTION_STYLES = {
  white: {
    header: 'bg-white border-b border-slate-100',
    title:  'text-[#0F172A]',
    count:  'bg-[#C0272D] text-white',
    meta:   'text-slate-400',
  },
  brand: {
    header: 'bg-[#FFF1F1] border-l-[3px] border-[#C0272D]',
    title:  'text-[#C0272D]',
    count:  'bg-[#C0272D] text-white',
    meta:   'text-[#C0272D]/70',
  },
  slate: {
    header: 'bg-[#F1F5F9]',
    title:  'text-[#334155]',
    count:  'bg-[#0F172A] text-white',
    meta:   'text-slate-400',
  },
}

function Section({ title, count, countLabel, extraInfo, variant = 'white', readOnly, children }) {
  const s = SECTION_STYLES[variant]
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
      <div className={`px-6 py-4 flex items-center justify-between ${s.header}`}>
        <div className="flex items-center gap-2">
          <h3 className={`text-base font-bold tracking-tight ${s.title}`}>{title}</h3>
          {readOnly && (
            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#E2E8F0] text-[#64748B]">
              Read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {extraInfo && (
            <span className={`text-xs ${s.meta}`}>{extraInfo}</span>
          )}
          <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-full text-xs font-bold ${s.count}`}>
            {count}
          </span>
          {countLabel && (
            <span className={`text-xs ${s.meta}`}>{countLabel}</span>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="px-6 py-8 text-sm text-[#94A3B8]">{children}</div>
  )
}
