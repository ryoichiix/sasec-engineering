import { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { fetchAllWorkers, fetchPresentWorkerIds, fetchClaimedWorkerMap } from '../lib/assignments'
import { isDirector } from '../lib/workers'
import { fetchBatchesForSupervisorDate, createBatch, updateBatchRecord, checkEquipmentConflicts } from '../lib/batches'
import { fetchAcceptedCollaboratorIds } from '../lib/collaborations'
import { buildExternalClaimIds } from '../lib/claims'
import { fetchVehicles } from '../lib/vehicles'
import { notifyUser } from '../lib/notifications'
import CollaboratorsCard from './CollaboratorsCard'
import { formatDate } from '../lib/dates'
import { PROJECT_OPTIONS, LOCATION_OPTIONS, TASK_CHIPS, generateOtTimes, defaultWorkTimes } from '../lib/plan-options'

// Equipment categories → the vehicle_type keywords that populate each dropdown.
const EQUIPMENT_TYPES = [
  { key: 'crane', label: 'Crane', types: ['CRANE', 'BOOM LIFT'] },
  { key: 'hydra', label: 'Hydra', types: ['HYDRA'] },
  { key: 'trawler', label: 'Trawler', types: ['LORRY'] },
  { key: 'cherry_picker', label: 'Cherry Picker', types: ['CAMPER', 'KIA', 'MARUTI', 'MAHINDRA', 'CRETA', 'EICHER', 'INDICA', 'ALTO', 'BUSS'] },
]

// Feature 1: seed each new batch's timing from the selected date's day-of-week
// default (Sun → 08:00–13:00, else 08:00–17:00). Still overridable per batch.
const emptyBatch = (date) => {
  const { from, to } = defaultWorkTimes(date)
  return {
    id: crypto.randomUUID(),
    name: '',
    workers: [],
    tasks: [],
    project_description: '', custom_project: '',
    project_location: '', custom_location: '',
    timing_from: from, timing_to: to,
    custom_task_input: '',
    crane: '', hydra: '', trawler: '', cherry_picker: '',
    ot_planned: false, ot_from: '', ot_to: '',
  }
}

// Rehydrate a persisted batch (from fetchBatchesForSupervisorDate) back into the
// editable form shape when the supervisor taps "Edit" on a collapsed card. The
// full plan lives in metadata; workers come from the embedded assignments join.
function batchToForm(dbBatch, date) {
  const meta = dbBatch.metadata || {}
  const dflt = defaultWorkTimes(date)
  const eqByCat = {}
  for (const e of (meta.equipment || [])) if (e?.category) eqByCat[e.category] = e
  const projDesc = dbBatch.project_description ?? meta.project_description ?? ''
  const projLoc = dbBatch.project_location ?? meta.project_location ?? ''
  const workers = (dbBatch.assignments || [])
    .filter((a) => a.worker?.id)
    .map((a) => ({
      id: a.worker.id,
      full_name: a.worker.full_name,
      designation_name: a.worker.designations?.name,
    }))
  return {
    id: dbBatch.id,
    name: dbBatch.batch_name || '',
    workers,
    tasks: dbBatch.tasks || [],
    project_description: PROJECT_OPTIONS.includes(projDesc) ? projDesc : (projDesc ? '__custom__' : ''),
    custom_project: PROJECT_OPTIONS.includes(projDesc) ? '' : (projDesc || ''),
    project_location: LOCATION_OPTIONS.includes(projLoc) ? projLoc : (projLoc ? '__custom__' : ''),
    custom_location: LOCATION_OPTIONS.includes(projLoc) ? '' : (projLoc || ''),
    timing_from: meta.timing_from || dflt.from,
    timing_to: meta.timing_to || dflt.to,
    custom_task_input: '',
    crane: meta.crane || '',
    hydra: meta.hydra || '',
    trawler: meta.trawler || '',
    cherry_picker: meta.cherry_picker || '',
    crane_time_in: eqByCat.crane?.time_in || '',
    crane_time_out: eqByCat.crane?.time_out || '',
    hydra_time_in: eqByCat.hydra?.time_in || '',
    hydra_time_out: eqByCat.hydra?.time_out || '',
    trawler_time_in: eqByCat.trawler?.time_in || '',
    trawler_time_out: eqByCat.trawler?.time_out || '',
    cherry_picker_time_in: eqByCat.cherry_picker?.time_in || '',
    cherry_picker_time_out: eqByCat.cherry_picker?.time_out || '',
    ot_planned: !!meta.ot_planned,
    ot_from: meta.ot_from || '',
    ot_to: meta.ot_to || '',
  }
}

/**
 * Batch Mode — SEQUENTIAL WIZARD (Feature 2). The supervisor fills one batch at
 * a time; "Save & Add Next Batch" persists it to today_team_batches +
 * batch_worker_assignments immediately and collapses it into a compact summary
 * card above, then presents a fresh empty form. "Finish" saves the in-progress
 * batch (if it has workers), fires a single "batch teams submitted" notification
 * to Directors / Site Incharges, and closes the wizard. Each collapsed card has
 * an "Edit" button that re-opens that batch in the form and re-saves in place.
 *
 * Fix A (batch mode): when an accepted collaboration exists for the date, both
 * supervisors share ONE canonical batch set owned by `canonicalOwnerId` (the
 * collab INITIATOR). All reads AND writes here go through that id, so either
 * side can add/edit and the other sees it. Solo, canonicalOwnerId falls back to
 * this supervisor's own id and everything behaves as before.
 *
 * Props: { date, supervisorId, supervisorName, canonicalOwnerId }
 *   - supervisorId       — the CURRENT user (for claim filtering, notifications)
 *   - canonicalOwnerId   — the batches' owner (initiator when collaborating)
 * The "Collaborating with …" banner is rendered by TodaysPlan.jsx at the parent
 * level, so BatchPlanBuilder doesn't need collabPartner itself — its own accepted
 * collaborators are fetched below via fetchAcceptedCollaboratorIds().
 */
export default function BatchPlanBuilder({
  date,
  supervisorId,
  supervisorName,
  canonicalOwnerId,
}) {
  const dfltTimes = defaultWorkTimes(date)
  // Fix A: reads/writes target the canonical owner (initiator when collaborating,
  // else this supervisor). Notifications, worker-claim filtering, and the
  // collaborators picker still key off the CURRENT user (supervisorId).
  const ownerId = canonicalOwnerId || supervisorId

  // savedBatches — this supervisor's persisted batches for the date, shown as
  // collapsed editable cards. currentBatch — the form being filled (null when
  // the wizard is idle after Finish). editingId — the DB id when the current
  // form is an in-place edit of an existing batch (else null → insert).
  const [savedBatches, setSavedBatches] = useState([])
  const [currentBatch, setCurrentBatch] = useState(() => emptyBatch(date))
  const [editingId, setEditingId] = useState(null)

  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [conflicts, setConflicts] = useState([]) // Feature 3: equipment double-booking warnings

  // Present-worker pool. poolLoaded gates the picker so cards never render
  // before names are available (avoids blank cards).
  const [pool, setPool] = useState([])
  const [poolLoaded, setPoolLoaded] = useState(false)
  const [vehicles, setVehicles] = useState([])

  // Claimed-worker filtering. claimedMap: worker_id -> Set<supervisor_id> holding
  // that worker for the date, folded from daily_assignments AND every
  // supervisor's today_team_batches. partnerIds: this supervisor's accepted
  // collaborators (their shared pool must NOT be treated as an external claim).
  const [claimedMap, setClaimedMap] = useState(() => new Map())
  const [partnerIds, setPartnerIds] = useState([])

  // ── Load present workers for the date ──────────────────────
  useEffect(() => {
    let active = true
    Promise.all([fetchAllWorkers(), fetchPresentWorkerIds(date)]).then(([{ data }, { data: presentIds }]) => {
      if (!active) return
      const present = new Set(presentIds || [])
      setPool((data || []).filter((w) => !isDirector(w) && present.has(w.id)))
      setPoolLoaded(true)
    })
    return () => { active = false }
  }, [date])

  // ── Fleet for equipment dropdowns (loaded once) ────────────
  useEffect(() => {
    let active = true
    ;(async () => {
      const data = await fetchVehicles()
      if (active) setVehicles(data || [])
    })()
    return () => { active = false }
  }, [])

  // ── Saved batches for the date (collapsed cards) ───────────
  // Fix A: read the CANONICAL owner's batches (initiator when collaborating).
  // A collaborator's own supervisor_id yields none because writes are reassigned
  // to the initiator below, matching how single-mode reads the initiator's row.
  const refreshSaved = useCallback(async () => {
    if (!ownerId) return
    const { data } = await fetchBatchesForSupervisorDate(ownerId, date)
    setSavedBatches(data || [])
    return data || []
  }, [ownerId, date])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!ownerId) return
      const { data } = await fetchBatchesForSupervisorDate(ownerId, date)
      if (active) setSavedBatches(data || [])
    })()
    return () => { active = false }
  }, [ownerId, date])

  // ── Claimed workers across ALL supervisors (single + batch surfaces) ───────
  // Re-fetched after every save so a freshly-claimed worker greys out for peers
  // immediately without a manual refresh.
  const refreshClaimed = useCallback(async () => {
    const { data } = await fetchClaimedWorkerMap(date)
    setClaimedMap(data || new Map())
  }, [date])

  useEffect(() => {
    let active = true
    ;(async () => {
      const [{ data: claims }, { data: partners }] = await Promise.all([
        fetchClaimedWorkerMap(date),
        fetchAcceptedCollaboratorIds(supervisorId, date),
      ])
      if (!active) return
      setClaimedMap(claims || new Map())
      setPartnerIds(partners || [])
    })()
    return () => { active = false }
  }, [supervisorId, date])

  // Fix A: live two-way sync of the canonical batch set. Subscribe to inserts /
  // updates / deletes on today_team_batches for THIS owner and re-pull the
  // collapsed cards so either supervisor sees the other's add/edit/save without
  // a manual refresh. Same channel-per-owner pattern as single-mode's work_plans
  // subscription (Fix A). Also watch batch_worker_assignments so a roster-only
  // change (updateBatchRecord re-inserts assignment rows) triggers a refresh
  // even when the parent today_team_batches row's own columns didn't change.
  // Requires today_team_batches + batch_worker_assignments in the realtime
  // publication and matching collaborator RLS (migration 52-collab-batch-rw.sql).
  useEffect(() => {
    if (!ownerId) return
    const channel = supabase
      .channel(`batch-plan-sync-${date}-${ownerId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'today_team_batches', filter: `supervisor_id=eq.${ownerId}` },
        () => { refreshSaved(); refreshClaimed() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'batch_worker_assignments' },
        () => { refreshSaved(); refreshClaimed() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [date, ownerId, refreshSaved, refreshClaimed])

  // Worker ids locked by OTHER saved batches (a worker can only be in one batch
  // per day). The batch currently being edited is excluded so its own roster
  // stays selectable.
  const lockedWorkerIds = useMemo(() => {
    const s = new Set()
    for (const b of savedBatches) {
      if (b.id === editingId) continue
      for (const wid of (b.worker_ids || [])) s.add(wid)
    }
    return s
  }, [savedBatches, editingId])

  // Worker ids claimed by ANOTHER supervisor (single mode or their own batches),
  // excluding this supervisor and their accepted collaborators. Greyed out in the
  // picker alongside lockedWorkerIds to prevent cross-supervisor double-booking.
  const externalClaimIds = useMemo(
    () => buildExternalClaimIds(claimedMap, { selfId: supervisorId, partnerIds }),
    [claimedMap, supervisorId, partnerIds]
  )

  const nextBatchNumber = () =>
    Math.max(0, ...savedBatches.map((b) => b.batch_number || 0)) + 1

  // ── Current-form field helpers ─────────────────────────────
  const updateField = (field, value) => setCurrentBatch((prev) => ({ ...prev, [field]: value }))
  const removeWorker = (workerId) =>
    setCurrentBatch((prev) => ({ ...prev, workers: prev.workers.filter((w) => w.id !== workerId) }))
  const toggleWorker = (worker) =>
    setCurrentBatch((prev) => prev.workers.some((w) => w.id === worker.id)
      ? { ...prev, workers: prev.workers.filter((w) => w.id !== worker.id) }
      : { ...prev, workers: [...prev.workers, worker] })
  const toggleTask = (chip) =>
    setCurrentBatch((prev) => ({
      ...prev,
      tasks: (prev.tasks || []).includes(chip)
        ? prev.tasks.filter((t) => t !== chip)
        : [...(prev.tasks || []), chip],
    }))
  const addCustomTask = () => {
    const t = currentBatch.custom_task_input?.trim()
    if (!t) return
    setCurrentBatch((prev) => ({
      ...prev,
      tasks: prev.tasks.includes(t) ? prev.tasks : [...prev.tasks, t],
      custom_task_input: '',
    }))
  }

  // ── Persist the current batch (insert, or update in place when editing) ────

  // Feature 3: structured equipment entries for the selected vehicles, each with
  // its own time_in/time_out (defaulting to the batch's work timing). Resolves
  // vehicle_id from the fleet so overlap checks match on identity. Stored inside
  // metadata.equipment ALONGSIDE the legacy crane/hydra/... string fields the
  // work feeds still read.
  const buildEquipment = (b) =>
    EQUIPMENT_TYPES
      .map(({ key }) => {
        const name = b[key]
        if (!name) return null
        const vehicle = vehicles.find((v) => `${v.vehicle_type} — ${v.vehicle_no}` === name)
        return {
          category: key,
          vehicle_id: vehicle?.id || null,
          vehicle_name: name,
          time_in: b[`${key}_time_in`] || b.timing_from || null,
          time_out: b[`${key}_time_out`] || b.timing_to || null,
        }
      })
      .filter(Boolean)

  const buildPayload = (b, equipment) => {
    const projectDescription = b.project_description === '__custom__'
      ? (b.custom_project?.trim() || null)
      : (b.project_description || null)
    const projectLocation = b.project_location === '__custom__'
      ? (b.custom_location?.trim() || null)
      : (b.project_location || null)
    const tasks = b.tasks || []
    const metadata = {
      project_description: projectDescription,
      project_location: projectLocation,
      timing_from: b.timing_from || null,
      timing_to: b.timing_to || null,
      crane: b.crane || null,
      hydra: b.hydra || null,
      trawler: b.trawler || null,
      cherry_picker: b.cherry_picker || null,
      equipment,
      ot_planned: !!b.ot_planned,
      ot_from: b.ot_planned ? (b.ot_from || null) : null,
      ot_to: b.ot_planned ? (b.ot_to || null) : null,
    }
    return { projectDescription, projectLocation, tasks, metadata }
  }

  // Returns true on success (state updated on failure).
  const persistCurrent = async () => {
    const b = currentBatch
    if (!b || b.workers.length === 0) {
      setError('Add at least one worker to this batch before saving.')
      return false
    }
    setError(null)

    // Feature 3: block on equipment double-booking against other batches for the date.
    const equipment = buildEquipment(b)
    const { data: found } = await checkEquipmentConflicts({ date, equipment, excludeBatchId: editingId })
    if (found && found.length > 0) {
      setConflicts(found)
      setError('Equipment double-booking — resolve the conflict(s) below before saving.')
      return false
    }
    setConflicts([])

    const { projectDescription, projectLocation, tasks, metadata } = buildPayload(b, equipment)
    const number = editingId
      ? (savedBatches.find((x) => x.id === editingId)?.batch_number || nextBatchNumber())
      : nextBatchNumber()
    const batchName = b.name?.trim() || `Batch ${number}`
    // Fix A: NEW batches created by either collaborator carry the initiator's
    // supervisor_id so both see the same canonical row. In-place updates are
    // keyed by batch id and don't change ownership.
    const res = editingId
      ? await updateBatchRecord({ id: editingId, batchName, projectDescription, projectLocation, tasks, workers: b.workers, metadata })
      : await createBatch({ supervisorId: ownerId, date, batchNumber: number, batchName, projectDescription, projectLocation, tasks, workers: b.workers, metadata })
    if (res.error) {
      setError(`Couldn't save "${batchName}": ${res.error.message}`)
      return false
    }
    return true
  }

  // ── Notify Director(s) + Site Incharge(s) — once, on Finish ────────────────
  // Best-effort: a notification failure must never block/undo a successful save.
  const notifyBatchesSubmitted = async (count) => {
    if (!count) return
    try {
      const [{ data: directors }, { data: siteIncharges }] = await Promise.all([
        supabase.from('profiles').select('id').eq('role', 'boss'),
        supabase.from('profiles').select('id').eq('field_manager', true),
      ])
      const recipientIds = [...new Set([
        ...(directors || []).map((d) => d.id),
        ...(siteIncharges || []).map((s) => s.id),
      ])].filter((id) => id && id !== supervisorId)
      const message = `${supervisorName || 'A supervisor'} submitted ${count} batch${count === 1 ? '' : 'es'} for ${formatDate(date)}.`
      for (const recipientId of recipientIds) {
        await notifyUser({
          userId: recipientId,
          type: 'batch_teams_submitted',
          title: 'Batch teams submitted',
          message,
        })
      }
    } catch {
      // Swallow — the batches are already saved; notifications are advisory.
    }
  }

  // ── Wizard actions ─────────────────────────────────────────
  const handleSaveAndNext = async () => {
    setSaving(true)
    const ok = await persistCurrent()
    if (ok) {
      await refreshSaved()
      await refreshClaimed()
      setCurrentBatch(emptyBatch(date))
      setEditingId(null)
      setSuccess('Batch saved. Fill the next one below, or tap Finish.')
    }
    setSaving(false)
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    const ok = await persistCurrent()
    if (ok) {
      await refreshSaved()
      await refreshClaimed()
      setCurrentBatch(null)
      setEditingId(null)
      setSuccess('Batch updated.')
    }
    setSaving(false)
  }

  const handleFinish = async () => {
    setSaving(true)
    setError(null)
    // Save the in-progress batch only if it has workers; an empty form just closes.
    if (currentBatch && currentBatch.workers.length > 0) {
      const ok = await persistCurrent()
      if (!ok) { setSaving(false); return }
    }
    const list = await refreshSaved()
    await refreshClaimed()
    if (!list || list.length === 0) {
      setError('Add at least one worker to a batch before finishing.')
      setSaving(false)
      return
    }
    await notifyBatchesSubmitted(list.length)
    setCurrentBatch(null)
    setEditingId(null)
    setSuccess(`${list.length} batch${list.length === 1 ? '' : 'es'} submitted for ${formatDate(date)}.`)
    setSaving(false)
  }

  const handleEdit = (dbBatch) => {
    setCurrentBatch(batchToForm(dbBatch, date))
    setEditingId(dbBatch.id)
    setSuccess(null)
    setError(null)
    setConflicts([])
  }

  const handleCancelEdit = () => {
    setCurrentBatch(null)
    setEditingId(null)
    setError(null)
    setConflicts([])
  }

  const handleAddAnother = () => {
    setCurrentBatch(emptyBatch(date))
    setEditingId(null)
    setSuccess(null)
    setError(null)
    setConflicts([])
  }

  // ── Derived ────────────────────────────────────────────────
  const visibleSaved = savedBatches.filter((b) => b.id !== editingId)
  const formNumber = editingId
    ? (savedBatches.find((b) => b.id === editingId)?.batch_number || nextBatchNumber())
    : nextBatchNumber()
  const customTasks = (currentBatch?.tasks || []).filter((t) => !TASK_CHIPS.includes(t))
  const otTimeOptions = generateOtTimes(currentBatch?.timing_to || dfltTimes.to)

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-2 rounded-md bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {success}
        </div>
      )}

      {/* ── Saved batches — collapsed editable summary cards ─────────── */}
      {visibleSaved.length > 0 && (
        <div className="space-y-3 mb-4">
          {visibleSaved.map((b) => {
            const workerCount = b.assignments?.length || b.worker_ids?.length || 0
            const projPreview = b.project_description || b.metadata?.project_description || ''
            return (
              <div
                key={b.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-full bg-[#C0272D] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {b.batch_number}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{b.batch_name}</p>
                    {b.project_location && (
                      <span className="text-xs text-gray-400 flex-shrink-0">· {b.project_location}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {workerCount} worker{workerCount === 1 ? '' : 's'}
                    {projPreview ? ` · ${projPreview}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleEdit(b)}
                  className="text-xs font-semibold text-[#C0272D] hover:text-red-800 flex-shrink-0"
                >
                  Edit
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Current batch form, or idle "add" button after Finish ─────── */}
      {currentBatch ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
          {/* Batch header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#C0272D] text-white flex items-center justify-center text-sm font-bold">
                {formNumber}
              </div>
              <input
                type="text"
                value={currentBatch.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder={`Batch ${formNumber} — e.g. BF#3 Team`}
                className="text-sm font-semibold text-gray-900 outline-none border-b border-dashed border-gray-300 focus:border-[#C0272D] bg-transparent pb-0.5"
              />
            </div>
            {editingId && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Editing
              </span>
            )}
          </div>

          {/* Workers in this batch */}
          <div className="px-5 py-4 border-b border-gray-50">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Workers ({currentBatch.workers.length})
            </p>
            {currentBatch.workers.length > 0 ? (
              <div className="space-y-2 mb-3">
                {currentBatch.workers.map((worker) => (
                  <div key={worker.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
                      {(worker.full_name || '?').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {worker.full_name || 'Unnamed worker'}
                      </p>
                      <p className="text-xs text-gray-400">{worker.designation_name}</p>
                    </div>
                    <button
                      onClick={() => removeWorker(worker.id)}
                      className="text-gray-300 hover:text-red-500 text-sm flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3">No workers added yet</p>
            )}

            <button
              onClick={() => setShowPicker(true)}
              className="text-xs font-semibold text-[#C0272D] hover:text-red-800"
            >
              + Add workers from pool
            </button>
          </div>

          {/* Full work plan for this batch */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Work Plan
            </p>

            {/* Project Description */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">Project Description</label>
              <select
                value={currentBatch.project_description || ''}
                onChange={(e) => updateField('project_description', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
              >
                <option value="">Select project...</option>
                {PROJECT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                <option value="__custom__">Other (type below)</option>
              </select>
              {currentBatch.project_description === '__custom__' && (
                <input
                  type="text"
                  placeholder="Enter project name..."
                  value={currentBatch.custom_project || ''}
                  onChange={(e) => updateField('custom_project', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              )}
            </div>

            {/* Location */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">Location</label>
              <select
                value={currentBatch.project_location || ''}
                onChange={(e) => updateField('project_location', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
              >
                <option value="">Select location...</option>
                {LOCATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="__custom__">Other (type below)</option>
              </select>
              {currentBatch.project_location === '__custom__' && (
                <input
                  type="text"
                  placeholder="Enter location..."
                  value={currentBatch.custom_location || ''}
                  onChange={(e) => updateField('custom_location', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              )}
            </div>

            {/* Work Timing */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">Work From</label>
                <input
                  type="time"
                  value={currentBatch.timing_from || dfltTimes.from}
                  onChange={(e) => updateField('timing_from', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">Work To</label>
                <input
                  type="time"
                  value={currentBatch.timing_to || dfltTimes.to}
                  onChange={(e) => updateField('timing_to', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              </div>
            </div>

            {/* Tasks */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 block">Tasks *</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {TASK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => toggleTask(chip)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      (currentBatch.tasks || []).includes(chip)
                        ? 'bg-[#0F172A] text-white border-[#0F172A]'
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              {/* Manual task input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add custom task..."
                  value={currentBatch.custom_task_input || ''}
                  onChange={(e) => updateField('custom_task_input', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addCustomTask() }
                  }}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
                <button
                  type="button"
                  onClick={addCustomTask}
                  className="px-3 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200"
                >
                  Add
                </button>
              </div>
              {customTasks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {customTasks.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 text-xs bg-[#0F172A] text-white px-2.5 py-1 rounded-full"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => updateField('tasks', currentBatch.tasks.filter((x) => x !== t))}
                        className="text-white/70 hover:text-white"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Equipment — each selected vehicle carries its own time-in / time-out */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 block">Equipment</label>
              <div className="space-y-2.5">
                {EQUIPMENT_TYPES.map((equip) => {
                  const selected = !!currentBatch[equip.key]
                  return (
                    <div key={equip.key}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-24 flex-shrink-0">{equip.label}</span>
                        <select
                          value={currentBatch[equip.key] || ''}
                          onChange={(e) => { updateField(equip.key, e.target.value); setConflicts([]) }}
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
                        >
                          <option value="">Not required</option>
                          {vehicles
                            .filter((v) => equip.types.some((t) => v.vehicle_type?.toUpperCase().includes(t)))
                            .map((v) => (
                              <option key={v.id} value={`${v.vehicle_type} — ${v.vehicle_no}`}>
                                {v.vehicle_type} — {v.vehicle_no}{v.driver_name ? ` (${v.driver_name})` : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                      {selected && (
                        <div className="flex items-center gap-2 mt-1.5 pl-[104px]">
                          <span className="text-[11px] text-gray-400 flex-shrink-0">In</span>
                          <input
                            type="time"
                            value={currentBatch[`${equip.key}_time_in`] || currentBatch.timing_from || ''}
                            onChange={(e) => { updateField(`${equip.key}_time_in`, e.target.value); setConflicts([]) }}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
                          />
                          <span className="text-[11px] text-gray-400 flex-shrink-0">Out</span>
                          <input
                            type="time"
                            value={currentBatch[`${equip.key}_time_out`] || currentBatch.timing_to || ''}
                            onChange={(e) => { updateField(`${equip.key}_time_out`, e.target.value); setConflicts([]) }}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {conflicts.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  {conflicts.map((c, i) => (
                    <p key={i} className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                      ⚠️ {c.vehicle_name} is already booked {c.time_in}–{c.time_out} by {c.supervisor_name || c.batch_name} — times overlap.
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* OT Toggle */}
            <div className="mb-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Overtime Planned?</label>
                <button
                  type="button"
                  onClick={() => updateField('ot_planned', !currentBatch.ot_planned)}
                  className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                    currentBatch.ot_planned ? 'bg-amber-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    currentBatch.ot_planned ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {currentBatch.ot_planned && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-700 mb-2">⚠️ OT requires prior Director approval</p>
                  {['OT From', 'OT To'].map((label, i) => {
                    const key = i === 0 ? 'ot_from' : 'ot_to'
                    return (
                      <div key={key} className="mb-2">
                        <p className="text-xs text-amber-600 mb-1">{label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {otTimeOptions.map((time) => (
                            <button
                              key={time}
                              type="button"
                              onClick={() => updateField(key, time === currentBatch[key] ? '' : time)}
                              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                                currentBatch[key] === time
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-100'
                              }`}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Fix 4: "Working with another supervisor" now sits directly above the
              action buttons, within the batch form (previously below Finish).
              Fix 3: keyed to the current batch + autoExpand=false so it starts
              collapsed (OFF) for each new batch instead of carrying over the
              previous batch's expanded collaboration state. The underlying
              day-level links are preserved — this only resets the UI default. */}
          <div className="px-5 py-4 border-t border-gray-50">
            <CollaboratorsCard
              key={currentBatch.id}
              embedded
              autoExpand={false}
              userId={supervisorId}
              userName={supervisorName}
              date={date}
            />
          </div>

          {/* Wizard actions */}
          <div className="px-5 py-4 border-t border-gray-50 flex gap-2">
            {editingId ? (
              <>
                <button
                  onClick={handleCancelEdit}
                  disabled={saving}
                  className="flex-1 border border-gray-200 text-gray-600 font-semibold py-3 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex-1 bg-[#C0272D] hover:bg-red-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSaveAndNext}
                  disabled={saving}
                  className="flex-1 bg-[#0F172A] hover:bg-gray-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save & Add Next Batch'}
                </button>
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  className="flex-1 bg-[#C0272D] hover:bg-red-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
                >
                  Finish
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={handleAddAnother}
          className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm font-semibold text-gray-400 hover:border-[#C0272D] hover:text-[#C0272D] transition-colors mb-4"
        >
          + Add another batch
        </button>
      )}

      {/* ── Worker picker for the current batch ─────────────── */}
      {showPicker && currentBatch && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowPicker(false)} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '20px 20px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                Add workers to Batch {formNumber}
              </h3>
              <button onClick={() => setShowPicker(false)} className="text-gray-400">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {!poolLoaded ? (
                <p className="text-sm text-gray-400 py-6 text-center">Loading workers…</p>
              ) : pool.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  No workers found.
                </p>
              ) : (
                pool.map((worker) => {
                  const displayName = worker.full_name || 'Unnamed worker'
                  const inCurrent = currentBatch.workers.some((w) => w.id === worker.id)
                  const inOtherBatch = lockedWorkerIds.has(worker.id)
                  // Claimed by another supervisor (single mode OR their own batch),
                  // excluding this supervisor and accepted collaborators → greyed +
                  // unselectable. inCurrent picks stay removable even if a peer
                  // claims them mid-edit.
                  const isExternal = externalClaimIds.has(worker.id)
                  const blocked = inOtherBatch || isExternal
                  return (
                    <button
                      key={worker.id}
                      type="button"
                      onClick={() => { if (inCurrent || !blocked) toggleWorker(worker) }}
                      disabled={!inCurrent && blocked}
                      className={`appearance-none w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        inCurrent
                          ? 'bg-[#0F172A] border-[#0F172A]'
                          : blocked
                          ? 'bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed'
                          : 'bg-white border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          inCurrent ? 'bg-white text-[#0F172A]' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {displayName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            inCurrent ? 'text-white' : 'text-gray-900'
                          }`}
                        >
                          {displayName}
                        </p>
                        <p className={`text-xs ${inCurrent ? 'text-gray-300' : 'text-gray-400'}`}>
                          {worker.designation_name} {!inCurrent && inOtherBatch ? '· In another batch' : !inCurrent && isExternal ? '· On another team' : ''}
                        </p>
                      </div>
                      {inCurrent && <span className="text-white text-sm">✓</span>}
                    </button>
                  )
                })
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowPicker(false)}
                className="w-full bg-[#0F172A] text-white font-semibold py-3 rounded-xl"
              >
                Done — {currentBatch.workers.length} worker{currentBatch.workers.length === 1 ? '' : 's'} selected
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
