import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../../components/DashboardShell'
import CollaboratorsCard from '../../components/CollaboratorsCard'
import BatchPlanBuilder from '../../components/BatchPlanBuilder'
import { useAuth } from '../../contexts/auth-context'
import { supabase } from '../../lib/supabase'
import {
  fetchAllWorkers,
  fetchAssignmentsForDate,
  claimWorker,
  releaseWorker,
  updateAssignmentTask,
} from '../../lib/assignments'
import { fetchSiteReport, saveSiteReport } from '../../lib/work-plans'
import { fetchVehicles } from '../../lib/vehicles'
import { isDirector } from '../../lib/workers'
import { todayLocal, formatDate } from '../../lib/dates'
import { PROJECT_OPTIONS, LOCATION_OPTIONS, TASK_CHIPS, OT_TIMES } from '../../lib/plan-options'

export default function TodaysPlan() {
  const { user, profile } = useAuth()
  const [date, setDate] = useState(todayLocal())
  const [batchMode, setBatchMode] = useState(false)
  const [collabPartner, setCollabPartner] = useState(null) // { name, report } | null

  // Detect an ACCEPTED collaboration for this date and load the partner's saved
  // plan. Lifted to the parent so the banner can render above the Batch toggle
  // and the partner's plan can pre-fill the single-plan form below. Reading the
  // partner's work_plans row requires migration 47-collab-work-plan-read.sql.
  useEffect(() => {
    const myId = user?.id
    if (!myId) return
    let active = true
    ;(async () => {
      const { data: collabs } = await supabase
        .from('work_plan_collaborations')
        .select('initiator_id, collaborator_id, status')
        .or(`initiator_id.eq.${myId},collaborator_id.eq.${myId}`)
        .eq('date', date)
        .eq('status', 'accepted')
      if (!active) return
      const collab = collabs?.[0]
      if (!collab) { setCollabPartner(null); return }
      const partnerId = collab.initiator_id === myId ? collab.collaborator_id : collab.initiator_id
      const [{ data: prof }, { data: report }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', partnerId).maybeSingle(),
        fetchSiteReport(partnerId, date),
      ])
      if (!active) return
      setCollabPartner({ name: prof?.full_name || 'Supervisor', report: report || null })
    })()
    return () => { active = false }
  }, [user?.id, date])

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

        {/* Collaboration banner */}
        {collabPartner && (
          <div className="bg-purple-50 rounded-2xl border border-purple-200 px-5 py-4 mb-4 flex items-center gap-3">
            <span className="text-2xl">🤝</span>
            <div>
              <p className="font-semibold text-purple-900 text-sm">
                Collaborating with {collabPartner.name}
              </p>
              <p className="text-xs text-purple-600 mt-0.5">
                Their plan details have been pre-filled below. You can edit if needed.
              </p>
            </div>
          </div>
        )}

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
          <SinglePlan key={date} date={date} user={user} profile={profile} collabPartner={collabPartner} />
        )}
      </div>
    </DashboardShell>
  )
}

// ── Single-team mode: one unified form ───────────────────────────────────────
// Team → Project Details → Tasks → Equipment → OT → Collaboration → Save.
function SinglePlan({ date, user, profile, collabPartner }) {
  const myId = user?.id

  // ── Team (daily_assignments) ───────────────────────────────
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
      const [workersRes, assignRes] = await Promise.all([
        fetchAllWorkers(),
        fetchAssignmentsForDate(date),
      ])
      if (workersRes.error || assignRes.error) {
        setError((workersRes.error || assignRes.error).message)
      } else {
        setError(null)
        setWorkers(workersRes.data || [])
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

  // ── Work plan form (persisted as JSON in work_plans.morning_plan) ──
  const [projectDescription, setProjectDescription] = useState('')
  const [customProject, setCustomProject] = useState('')
  const [projectLocation, setProjectLocation] = useState('')
  const [customLocation, setCustomLocation] = useState('')
  const [permitHolder, setPermitHolder] = useState(profile?.full_name || '')
  const [workFrom, setWorkFrom] = useState('09:00')
  const [workTo, setWorkTo] = useState('18:00')
  const [tasks, setTasks] = useState([])
  const [customTaskInput, setCustomTaskInput] = useState('')
  const [crane, setCrane] = useState('')
  const [hydra, setHydra] = useState('')
  const [cherryPicker, setCherryPicker] = useState('')
  const [trawler, setTrawler] = useState('')
  const [trawlerNotRequired, setTrawlerNotRequired] = useState(false)
  const [overtime, setOvertime] = useState(false)
  const [otFrom, setOtFrom] = useState('')
  const [otTo, setOtTo] = useState('')

  const [vehicles, setVehicles] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState(null)

  // Fleet for equipment dropdowns (once).
  useEffect(() => {
    let active = true
    fetchVehicles().then((data) => { if (active) setVehicles(data || []) })
    return () => { active = false }
  }, [])

  // Prefill the form: the user's OWN saved plan wins; otherwise, if there's an
  // accepted collaboration, auto-fill from the partner's plan (Change 2). The
  // parent remounts with key={date}, so prefilledRef resets per date; the guard
  // prevents a late collabPartner prop update from clobbering edits in progress.
  const prefilledRef = useRef(false)
  useEffect(() => {
    if (!myId || prefilledRef.current) return
    let active = true
    // Fill shared plan fields from a parsed work-plan report. `withPermit` is
    // false for partner auto-fill — the permit holder is always the current
    // supervisor, not the partner.
    const apply = (data, { withPermit }) => {
      const proj = data.project_description ?? ''
      if (PROJECT_OPTIONS.includes(proj)) setProjectDescription(proj)
      else if (proj) { setProjectDescription('__custom__'); setCustomProject(proj) }
      const loc = data.project_location ?? ''
      if (LOCATION_OPTIONS.includes(loc)) setProjectLocation(loc)
      else if (loc) { setProjectLocation('__custom__'); setCustomLocation(loc) }
      if (withPermit) setPermitHolder(data.permit_holder ?? profile?.full_name ?? '')
      setWorkFrom(data.work_from ?? '09:00')
      setWorkTo(data.work_to ?? '18:00')
      setOvertime(!!data.overtime)
      setOtFrom(data.ot_from ?? '')
      setOtTo(data.ot_to ?? '')
      setCrane(data.equipment?.crane ?? '')
      setHydra(data.equipment?.hydra ?? '')
      setCherryPicker(data.equipment?.cherry_picker ?? '')
      setTrawler(data.equipment?.trawler ?? '')
      setTrawlerNotRequired(!!data.equipment?.trawler_not_required)
      setTasks(Array.isArray(data.tasks) ? data.tasks : [])
    }
    fetchSiteReport(myId, date).then(({ data: own }) => {
      if (!active) return
      if (own) {
        prefilledRef.current = true
        apply(own, { withPermit: true })
      } else if (collabPartner?.report) {
        // No own plan yet — pre-fill from the collaboration partner's plan.
        prefilledRef.current = true
        apply(collabPartner.report, { withPermit: false })
      }
    })
    return () => { active = false }
  }, [myId, date, profile?.full_name, collabPartner])

  const getVehiclesByType = (keyword) =>
    vehicles.filter((v) => v.vehicle_type?.toLowerCase().includes(keyword.toLowerCase()))

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
    () => [...new Set(workers.map((w) => w.designation_name).filter(Boolean))].sort(),
    [workers]
  )

  const pickerList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return workers
      .filter((w) => !isDirector(w))
      .filter((w) => !q || (w.full_name || '').toLowerCase().includes(q))
      .filter((w) => !filterDesignation || w.designation_name === filterDesignation)
  }, [workers, searchQuery, filterDesignation])

  // ── Team actions ───────────────────────────────────────────
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

  // ── Task helpers ───────────────────────────────────────────
  const toggleTaskChip = (chip) =>
    setTasks((prev) => (prev.includes(chip) ? prev.filter((t) => t !== chip) : [...prev, chip]))
  const addCustomTask = () => {
    const t = customTaskInput.trim()
    if (!t) return
    setTasks((prev) => (prev.includes(t) ? prev : [...prev, t]))
    setCustomTaskInput('')
  }
  const removeTask = (t) => setTasks((prev) => prev.filter((x) => x !== t))

  // ── Save the work plan (team is saved live via claim/release) ──
  const handleSave = async () => {
    setSaved(false)
    setFormError(null)
    const finalProject = projectDescription === '__custom__' ? customProject.trim() : projectDescription
    const finalLocation = projectLocation === '__custom__' ? customLocation.trim() : projectLocation
    if (!finalProject) { setFormError('Please choose a project description.'); return }
    if (tasks.length === 0) { setFormError('Please select at least one task.'); return }

    setSaving(true)
    const report = {
      project_description: finalProject,
      project_location: finalLocation,
      permit_holder: permitHolder.trim(),
      work_from: workFrom,
      work_to: workTo,
      overtime,
      ot_from: overtime ? otFrom : '',
      ot_to: overtime ? otTo : '',
      equipment: {
        crane,
        hydra,
        cherry_picker: cherryPicker,
        trawler: trawlerNotRequired ? '' : trawler,
        trawler_not_required: trawlerNotRequired,
      },
      tasks,
    }
    const { error: err } = await saveSiteReport(myId, date, report)
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const equipmentRows = [
    { label: 'Crane', value: crane, set: setCrane, options: [...getVehiclesByType('CRANE'), ...getVehiclesByType('BOOM LIFT')] },
    { label: 'Hydra', value: hydra, set: setHydra, options: getVehiclesByType('HYDRA') },
    { label: 'Cherry Picker', value: cherryPicker, set: setCherryPicker, options: vehicles.filter((v) => !['HYDRA', 'CRANE', 'LORRY', 'BOOM'].some((k) => v.vehicle_type?.toUpperCase().includes(k))) },
  ]

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

      {/* ── TEAM ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">Team</p>
            <p className="text-xs text-gray-400 mt-0.5">{myTeam.length} worker{myTeam.length === 1 ? '' : 's'} selected</p>
          </div>
          <button
            onClick={() => {
              console.log('[picker] opened — workers:', workers.length, '| pickerList:', pickerList.length)
              setShowWorkerPicker(true)
            }}
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
                <div key={worker.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {(worker.full_name || '?').charAt(0)}
                  </div>

                  {/* Name + designation */}
                  <div className="w-28 flex-shrink-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{worker.full_name || 'Unnamed worker'}</p>
                    <p className="text-xs text-gray-400 truncate">{worker.designation_name}</p>
                  </div>

                  {/* Task input — takes all remaining space */}
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
                    className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#C0272D] bg-gray-50"
                  />

                  {/* Saved indicator */}
                  <span className="w-3 text-xs text-[#C0272D] flex-shrink-0">{edit?.saving ? '…' : edit?.saved ? '✓' : ''}</span>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => release(worker)}
                    disabled={!!pending[worker.id]}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
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

      {/* ── PROJECT DETAILS ──────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">Project Details</p>
        <div className="space-y-3">
          {/* Project description */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Project Description</label>
            <select
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
            >
              <option value="">Select project...</option>
              {PROJECT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              <option value="__custom__">Other...</option>
            </select>
            {projectDescription === '__custom__' && (
              <input
                type="text"
                placeholder="Enter project name..."
                value={customProject}
                onChange={(e) => setCustomProject(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
              />
            )}
          </div>

          {/* Location */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Location</label>
            <select
              value={projectLocation}
              onChange={(e) => setProjectLocation(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
            >
              <option value="">Select location...</option>
              {LOCATION_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              <option value="__custom__">Other...</option>
            </select>
            {projectLocation === '__custom__' && (
              <input
                type="text"
                placeholder="Enter location..."
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
              />
            )}
          </div>

          {/* Permit holder */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Permit Holder</label>
            <input
              type="text"
              value={permitHolder}
              onChange={(e) => setPermitHolder(e.target.value)}
              placeholder="Name of permit holder"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
            />
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">From</label>
              <input
                type="time"
                value={workFrom}
                onChange={(e) => setWorkFrom(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">To</label>
              <input
                type="time"
                value={workTo}
                onChange={(e) => setWorkTo(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── TASKS ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
          Tasks {tasks.length === 0 && <span className="text-red-400 normal-case font-normal">— select at least one</span>}
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {TASK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => toggleTaskChip(chip)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                tasks.includes(chip)
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add custom task..."
            value={customTaskInput}
            onChange={(e) => setCustomTaskInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTask() } }}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
          />
          <button
            onClick={addCustomTask}
            className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200"
          >
            Add
          </button>
        </div>
        {tasks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {tasks.map((t) => (
              <span key={t} className="text-xs bg-[#0F172A] text-white px-2.5 py-1 rounded-full flex items-center gap-1.5">
                {t}
                <button onClick={() => removeTask(t)} className="opacity-60 hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── EQUIPMENT ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Equipment</p>
        <div className="space-y-3">
          {equipmentRows.map((eq) => (
            <div key={eq.label} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0">{eq.label}</span>
              <select
                value={eq.value}
                onChange={(e) => eq.set(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
              >
                <option value="">Not required</option>
                {eq.options.map((v) => (
                  <option key={v.id} value={`${v.vehicle_type} — ${v.vehicle_no}`}>
                    {v.vehicle_type} — {v.vehicle_no}{v.driver_name ? ` (${v.driver_name})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {/* Trawler with "Not required" toggle */}
          <div className="flex items-start gap-3">
            <span className="text-xs text-gray-500 w-24 flex-shrink-0 pt-2">Trawler</span>
            <div className="flex-1">
              {trawlerNotRequired ? (
                <div className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2 text-sm text-gray-400 font-medium">
                  NOT REQUIRED
                </div>
              ) : (
                <select
                  value={trawler}
                  onChange={(e) => setTrawler(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
                >
                  <option value="">Not required</option>
                  {getVehiclesByType('LORRY').map((v) => (
                    <option key={v.id} value={`${v.vehicle_type} — ${v.vehicle_no}`}>
                      {v.vehicle_type} — {v.vehicle_no}{v.driver_name ? ` (${v.driver_name})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-xs text-gray-500 mt-1.5">
                <input
                  type="checkbox"
                  checked={trawlerNotRequired}
                  onChange={(e) => setTrawlerNotRequired(e.target.checked)}
                  className="accent-[#C0272D]"
                />
                Not required
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── OVERTIME ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Overtime Planned?</p>
          <button
            onClick={() => setOvertime((v) => !v)}
            className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${overtime ? 'bg-amber-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${overtime ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
        {overtime && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-xs text-amber-700">⚡ OT requires prior Director approval. Food &amp; consumables must be planned.</p>
            {[{ label: 'OT From', val: otFrom, set: setOtFrom }, { label: 'OT To', val: otTo, set: setOtTo }].map((ot) => (
              <div key={ot.label}>
                <p className="text-xs font-medium text-amber-700 mb-1.5">{ot.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {OT_TIMES.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => ot.set(time === ot.val ? '' : time)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                        ot.val === time ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── COLLABORATION ────────────────────────────────────── */}
      <CollaboratorsCard userId={myId} userName={profile?.full_name} date={date} />

      {/* ── SAVE ─────────────────────────────────────────────── */}
      {formError && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{formError}</div>
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-[#C0272D] hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
      >
        {saving ? 'Saving…' : saved ? '✅ Saved!' : "Save Today's Plan"}
      </button>

      {/* ── WORKER PICKER BOTTOM SHEET ───────────────────────── */}
      {/* Rebuilt with inline styles only — no Tailwind classes on any element
          in this tree — to rule out any utility-class/paint interaction. */}
      {showWorkerPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          {/* Backdrop */}
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowWorkerPicker(false)}
          />

          {/* Sheet */}
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            background: '#ffffff',
            borderRadius: '20px 20px 0 0',
            maxHeight: '75vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
            overflow: 'hidden',
          }}>

            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>Add workers</span>
                <button
                  type="button"
                  onClick={() => setShowWorkerPicker(false)}
                  style={{ background: 'none', border: 'none', fontSize: 20, color: '#9ca3af', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
              {/* Search */}
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px',
                  border: '1px solid #e5e7eb', borderRadius: 12,
                  fontSize: 14, color: '#111827', outline: 'none',
                  boxSizing: 'border-box', marginBottom: 8,
                }}
              />
              {/* Designation filter + Clear */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={filterDesignation}
                  onChange={(e) => setFilterDesignation(e.target.value)}
                  style={{
                    padding: '6px 10px', border: '1px solid #e5e7eb',
                    borderRadius: 8, fontSize: 13, color: '#374151',
                    background: '#fff', outline: 'none', flexShrink: 0,
                  }}
                >
                  <option value="">All designations</option>
                  {designations.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {(searchQuery || filterDesignation) && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setFilterDesignation('') }}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#9ca3af', cursor: 'pointer', flexShrink: 0, padding: '0 8px' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Worker list */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 20px' }}>
              {loading ? (
                <p style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 14 }}>
                  Loading workers…
                </p>
              ) : pickerList.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 14 }}>
                  {workers.length === 0 ? 'No workers found.' : 'No workers match your search.'}
                </p>
              ) : (
                pickerList.map((worker) => {
                  const asn = assignmentByWorker.get(worker.id)
                  const isMine = asn?.supervisor_id === myId
                  const isOther = !!asn && !isMine
                  const busy = !!pending[worker.id]
                  const displayName = String(worker.full_name || worker.name || 'Unknown')
                  return (
                    <button
                      key={worker.id}
                      type="button"
                      disabled={isOther || busy}
                      onClick={() => {
                        console.log('[picker] tapped:', displayName)
                        if (isOther || busy) return
                        if (isMine) release(worker)
                        else claim(worker)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 6,
                        borderRadius: 12,
                        border: isMine ? '1px solid #0f172a' : '1px solid #f3f4f6',
                        background: isMine ? '#0f172a' : isOther ? '#f9fafb' : '#ffffff',
                        cursor: isOther || busy ? 'not-allowed' : 'pointer',
                        opacity: isOther ? 0.5 : 1,
                        textAlign: 'left',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: isMine ? '#ffffff' : '#e5e7eb',
                        color: isMine ? '#0f172a' : '#374151',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 14, flexShrink: 0,
                      }}>
                        {displayName.charAt(0)}
                      </div>

                      {/* Name + designation */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: 14, fontWeight: 600,
                          color: isMine ? '#ffffff' : '#111827',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {displayName}
                        </p>
                        <p style={{
                          margin: 0, fontSize: 12,
                          color: isMine ? '#d1d5db' : '#6b7280',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {(worker.designation_name || worker.designation || '')}{isOther ? ' · On another team' : ''}
                        </p>
                      </div>

                      {/* Status */}
                      {busy
                        ? <span style={{ color: isMine ? '#ffffff' : '#9ca3af', fontSize: 12, flexShrink: 0 }}>…</span>
                        : isMine && <span style={{ color: '#ffffff', fontSize: 16, flexShrink: 0 }}>✓</span>}
                    </button>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f0f0', flexShrink: 0, background: '#ffffff' }}>
              <button
                type="button"
                onClick={() => setShowWorkerPicker(false)}
                style={{
                  width: '100%', padding: '12px',
                  background: '#0f172a', color: '#ffffff',
                  border: 'none', borderRadius: 12,
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
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
