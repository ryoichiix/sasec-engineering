import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../../components/DashboardShell'
import DailySiteReport from '../../components/DailySiteReport'
import CollaboratorsCard from '../../components/CollaboratorsCard'
import BatchPlanBuilder from '../../components/BatchPlanBuilder'
import { useAuth } from '../../contexts/auth-context'
import { supabase } from '../../lib/supabase'
import {
  fetchPresentWorkers,
  fetchAssignmentsForDate,
  claimWorker,
  releaseWorker,
  updateAssignmentTask,
} from '../../lib/assignments'
import { isDirector } from '../../lib/workers'
import { todayLocal, formatDate } from '../../lib/dates'

export default function TodaysPlan() {
  const { user, profile } = useAuth()
  const [date, setDate] = useState(todayLocal())
  const [batchMode, setBatchMode] = useState(false)

  return (
    <DashboardShell title="Today's plan">
      <div className="max-w-2xl mx-auto">
        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Today's Plan</h1>
          <p className="text-sm text-gray-400 mt-1">{formatDate(date)}</p>
        </div>

        {/* Date picker */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input
            type="date"
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm text-gray-700 outline-none bg-transparent"
          />
        </div>

        {/* Batch mode toggle */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 mb-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900 text-sm">Batch Mode</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Split into multiple groups for different locations
            </p>
          </div>
          <button
            onClick={() => setBatchMode((v) => !v)}
            aria-pressed={batchMode}
            aria-label="Toggle batch mode"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              batchMode ? 'bg-[#C0272D]' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                batchMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {batchMode ? (
          <BatchPlanBuilder
            key={date}
            date={date}
            supervisorId={user?.id}
            supervisorName={profile?.full_name}
          />
        ) : (
          <SinglePlan date={date} user={user} profile={profile} />
        )}
      </div>
    </DashboardShell>
  )
}

// ── Single-team mode: pick team + fill work plan + tag collaborators ──────────
function SinglePlan({ date, user, profile }) {
  const myId = user?.id

  const [workers, setWorkers] = useState([])      // present workers for the date
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [flashMsg, setFlashMsg] = useState(null)
  const [pending, setPending] = useState({})      // worker_id -> bool (claim/release in-flight)
  const [taskEdits, setTaskEdits] = useState({})  // assignmentId -> { value, saving, saved }

  const [showWorkerPicker, setShowWorkerPicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterDesignation, setFilterDesignation] = useState('')

  const inflightRef = useRef(false)

  const loadData = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const [presentRes, assignRes] = await Promise.all([
        fetchPresentWorkers(date),
        fetchAssignmentsForDate(date),
      ])
      if (presentRes.error || assignRes.error) {
        setError((presentRes.error || assignRes.error).message)
      } else {
        setError(null)
        setWorkers(presentRes.data || [])
        setAssignments(assignRes.data || [])
      }
      setLoading(false)
    } finally {
      inflightRef.current = false
    }
  }, [date])

  useEffect(() => { loadData() }, [loadData])

  // Realtime — refresh when assignments or attendance change for this date.
  useEffect(() => {
    if (!myId) return
    const channel = supabase
      .channel(`todays-plan-${date}-${myId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'daily_assignments', filter: `assignment_date=eq.${date}` },
        () => { loadData() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attendance', filter: `attendance_date=eq.${date}` },
        () => { loadData() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [date, myId, loadData])

  // ── Derived ────────────────────────────────────────────────
  const assignmentByWorker = useMemo(() => {
    const m = new Map()
    for (const a of assignments) m.set(a.worker_id || a.worker_table_id, a)
    return m
  }, [assignments])

  const myTeam = useMemo(
    () => workers
      .filter((w) => assignmentByWorker.get(w.id)?.supervisor_id === myId)
      .map((w) => ({ ...w, assignment: assignmentByWorker.get(w.id) })),
    [workers, assignmentByWorker, myId]
  )

  const designations = useMemo(
    () => [...new Set(workers.map((w) => w.designations?.name).filter(Boolean))].sort(),
    [workers]
  )

  // Picker list: every present non-director worker, minus those on another
  // supervisor's team (shown disabled). Mine appear selected.
  const pickerList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return workers
      .filter((w) => !isDirector(w))
      .filter((w) => !q || (w.full_name || '').toLowerCase().includes(q))
      .filter((w) => !filterDesignation || w.designations?.name === filterDesignation)
  }, [workers, searchQuery, filterDesignation])

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
    }
    loadData()
  }

  const release = async (worker) => {
    if (!myId) return
    setPending((p) => ({ ...p, [worker.id]: true }))
    setFlashMsg(null)
    setError(null)
    const { error: err } = await releaseWorker(worker.id, date)
    setPending((p) => { const n = { ...p }; delete n[worker.id]; return n })
    if (err) { setError(err.message); return }
    loadData()
  }

  const saveWorkerTask = async (assignmentId, value) => {
    setTaskEdits((p) => ({ ...p, [assignmentId]: { value, saving: true, saved: false } }))
    const { error: err } = await updateAssignmentTask(assignmentId, value)
    setTaskEdits((p) => ({
      ...p,
      [assignmentId]: { value, saving: false, saved: !err, error: err?.message },
    }))
    if (!err) loadData()
  }

  return (
    <div className="space-y-4">
      {flashMsg && (
        <div className="px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          {flashMsg}
        </div>
      )}
      {error && (
        <div className="px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* TEAM SECTION */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">Team</p>
            <p className="text-xs text-gray-400 mt-0.5">{myTeam.length} worker{myTeam.length === 1 ? '' : 's'} selected</p>
          </div>
          <button
            onClick={() => setShowWorkerPicker(true)}
            className="px-4 py-2 bg-[#0F172A] text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors"
          >
            + Add workers
          </button>
        </div>

        {myTeam.length > 0 ? (
          <div className="px-5 py-3 space-y-2">
            {myTeam.map((worker) => {
              const asn = worker.assignment
              const edit = taskEdits[asn?.id]
              const taskValue = edit?.value ?? asn?.task_assigned ?? ''
              return (
                <div key={worker.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {(worker.full_name || '?').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{worker.full_name || 'Unnamed worker'}</p>
                    <p className="text-xs text-gray-400">{worker.designations?.name}</p>
                  </div>
                  <input
                    type="text"
                    placeholder="Task (optional)"
                    value={taskValue}
                    onChange={(e) =>
                      setTaskEdits((p) => ({ ...p, [asn.id]: { value: e.target.value, saved: false } }))
                    }
                    onBlur={() => {
                      if (asn && taskValue !== (asn.task_assigned ?? '')) saveWorkerTask(asn.id, taskValue)
                    }}
                    className="w-32 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#C0272D]"
                  />
                  <span className="w-3 text-xs text-[#C0272D]">{edit?.saving ? '…' : edit?.saved ? '✓' : ''}</span>
                  <button
                    onClick={() => release(worker)}
                    disabled={!!pending[worker.id]}
                    className="text-gray-300 hover:text-red-500 flex-shrink-0 disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-6 text-center">
            <p className="text-sm text-gray-400">
              {loading ? 'Loading…' : 'No workers added yet'}
            </p>
          </div>
        )}
      </div>

      {/* WORK PLAN FORM (project / permit / timing / OT / equipment / tasks) */}
      <DailySiteReport
        key={date}
        date={date}
        supervisorId={myId}
        permitHolderDefault={profile?.full_name}
        team={myTeam}
        teamLoading={loading}
      />

      {/* COLLABORATION */}
      <CollaboratorsCard
        key={date}
        userId={myId}
        userName={profile?.full_name}
        date={date}
      />

      {/* WORKER PICKER BOTTOM SHEET */}
      {showWorkerPicker && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="flex-1 bg-black/40" onClick={() => setShowWorkerPicker(false)} />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl"
            style={{ maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Add workers</h3>
                <button onClick={() => setShowWorkerPicker(false)} className="text-gray-400 text-xl">✕</button>
              </div>
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C0272D] mb-2"
              />
              <div className="flex gap-2 overflow-x-auto pb-1">
                <select
                  value={filterDesignation}
                  onChange={(e) => setFilterDesignation(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 outline-none flex-shrink-0"
                >
                  <option value="">All designations</option>
                  {designations.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {(searchQuery || filterDesignation) && (
                  <button
                    onClick={() => { setSearchQuery(''); setFilterDesignation('') }}
                    className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0 px-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Worker list */}
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {loading ? (
                <p className="text-center text-sm text-gray-400 py-8">Loading workers…</p>
              ) : pickerList.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">
                  {workers.length === 0
                    ? `No present workers for ${formatDate(date)} — mark attendance first.`
                    : 'No workers found.'}
                </p>
              ) : (
                pickerList.map((worker) => {
                  const displayName = worker.full_name || 'Unnamed worker'
                  const asn = assignmentByWorker.get(worker.id)
                  const isMine = asn?.supervisor_id === myId
                  const isOther = asn && !isMine
                  const busy = !!pending[worker.id]
                  return (
                    <div
                      key={worker.id}
                      onClick={() => {
                        if (isOther || busy) return
                        if (isMine) release(worker)
                        else claim(worker)
                      }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isMine
                          ? 'bg-[#0F172A] border-[#0F172A] cursor-pointer'
                          : isOther
                          ? 'bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed'
                          : 'bg-white border-gray-100 hover:border-gray-300 cursor-pointer'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        isMine ? 'bg-white text-[#0F172A]' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {displayName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${isMine ? 'text-white' : 'text-gray-900'}`}>
                          {displayName}
                        </p>
                        <p className={`text-xs truncate ${isMine ? 'text-gray-300' : 'text-gray-400'}`}>
                          {worker.designations?.name}{isOther ? ' · On another team' : ''}
                        </p>
                      </div>
                      {busy
                        ? <span className={`text-xs flex-shrink-0 ${isMine ? 'text-white' : 'text-gray-400'}`}>…</span>
                        : isMine && <span className="text-white text-base flex-shrink-0">✓</span>}
                    </div>
                  )
                })
              )}
            </div>

            {/* Done button */}
            <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={() => setShowWorkerPicker(false)}
                className="w-full bg-[#0F172A] text-white font-semibold py-3 rounded-xl text-sm"
              >
                Done — {myTeam.length} worker{myTeam.length === 1 ? '' : 's'} selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
