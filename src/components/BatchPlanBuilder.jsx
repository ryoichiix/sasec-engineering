import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { fetchAllWorkers, fetchPresentWorkerIds } from '../lib/assignments'
import { isDirector } from '../lib/workers'
import { fetchBatchesForSupervisorDate } from '../lib/batches'
import { fetchVehicles } from '../lib/vehicles'
import { notifyUser } from '../lib/notifications'
import BatchTeamList from './BatchTeamList'
import CollaboratorsCard from './CollaboratorsCard'
import { formatDate } from '../lib/dates'
import { PROJECT_OPTIONS, LOCATION_OPTIONS, TASK_CHIPS, OT_TIMES } from '../lib/plan-options'

const emptyBatch = () => ({ id: crypto.randomUUID(), name: '', workers: [], location: '', tasks: [] })

/**
 * Batch Mode: split today's team into multiple groups, each with its own full
 * work plan (project, timing, tasks, equipment, OT). Saves to
 * today_team_batches + batch_worker_assignments and notifies Director / Site
 * Incharge. Self-contained — loads its own present-worker pool, fleet, and the
 * read-only summary of already-submitted batches for the date.
 *
 * Props: { date, supervisorId, supervisorName }
 */
export default function BatchPlanBuilder({ date, supervisorId, supervisorName }) {
  const [batches, setBatches] = useState([emptyBatch()])
  const [pickingForBatch, setPickingForBatch] = useState(null) // batch index
  const [savingBatches, setSavingBatches] = useState(false)
  const [batchSuccess, setBatchSuccess] = useState(null)
  const [error, setError] = useState(null)
  const [savedBatches, setSavedBatches] = useState([]) // already-submitted batches for this date
  const [vehicles, setVehicles] = useState([])         // fleet, for equipment dropdowns

  // Present-worker pool. poolLoaded gates the picker so cards never render
  // before names are available (avoids blank cards).
  const [pool, setPool] = useState([])
  const [poolLoaded, setPoolLoaded] = useState(false)

  // ── Load present workers for the date ──────────────────────
  // The parent remounts this component with key={date}, so poolLoaded starts
  // false on every date change — no synchronous reset needed in the effect.
  useEffect(() => {
    let active = true
    Promise.all([fetchAllWorkers(), fetchPresentWorkerIds(date)]).then(([{ data }, { data: presentIds }]) => {
      if (!active) return
      const present = new Set(presentIds || [])
      // Fix 4: gate the batch pool to workers marked present (attendance) for the date.
      setPool((data || []).filter((w) => !isDirector(w) && present.has(w.id)))
      setPoolLoaded(true)
    })
    return () => { active = false }
  }, [date])

  // ── Saved batches (read-only summary) ──────────────────────
  useEffect(() => {
    let active = true
    ;(async () => {
      if (!supervisorId) return
      const { data } = await fetchBatchesForSupervisorDate(supervisorId, date)
      if (active) setSavedBatches(data || [])
    })()
    return () => { active = false }
  }, [supervisorId, date])

  // ── Fleet for equipment dropdowns (loaded once) ────────────
  useEffect(() => {
    let active = true
    ;(async () => {
      const data = await fetchVehicles()
      if (active) setVehicles(data || [])
    })()
    return () => { active = false }
  }, [])

  // ── Batch actions ──────────────────────────────────────────
  const addBatch = () => setBatches((prev) => [...prev, emptyBatch()])
  const removeBatch = (idx) => setBatches((prev) => prev.filter((_, i) => i !== idx))
  const updateBatch = (idx, field, value) =>
    setBatches((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)))
  const removeWorkerFromBatch = (batchIdx, workerId) =>
    setBatches((prev) =>
      prev.map((b, i) =>
        i === batchIdx ? { ...b, workers: b.workers.filter((w) => w.id !== workerId) } : b
      )
    )

  const saveAllBatches = async () => {
    const filled = batches.filter((b) => b.workers.length > 0)
    if (filled.length === 0) {
      setError('Add at least one worker to a batch before saving.')
      return
    }
    setSavingBatches(true)
    setError(null)
    setBatchSuccess(null)

    let saved = 0
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      if (batch.workers.length === 0) continue

      const projectDescription = batch.project_description === '__custom__'
        ? (batch.custom_project?.trim() || null)
        : (batch.project_description || null)
      const projectLocation = batch.project_location === '__custom__'
        ? (batch.custom_location?.trim() || null)
        : (batch.project_location || null)
      const batchTasks = batch.tasks || []

      // 1. Save the batch record (full work plan in metadata jsonb)
      const { data: batchRecord, error: bErr } = await supabase
        .from('today_team_batches')
        .insert({
          supervisor_id: supervisorId,
          date,
          batch_name: batch.name?.trim() || `Batch ${i + 1}`,
          batch_number: i + 1,
          project_description: projectDescription,
          project_location: projectLocation,
          tasks: batchTasks,
          worker_ids: batch.workers.map((w) => w.id),
          metadata: {
            project_description: projectDescription,
            project_location: projectLocation,
            timing_from: batch.timing_from || null,
            timing_to: batch.timing_to || null,
            crane: batch.crane || null,
            hydra: batch.hydra || null,
            trawler: batch.trawler || null,
            cherry_picker: batch.cherry_picker || null,
            ot_planned: !!batch.ot_planned,
            ot_from: batch.ot_planned ? (batch.ot_from || null) : null,
            ot_to: batch.ot_planned ? (batch.ot_to || null) : null,
          },
        })
        .select()
        .single()

      if (bErr) {
        setError(`Couldn't save "${batch.name || `Batch ${i + 1}`}": ${bErr.message}`)
        setSavingBatches(false)
        return
      }

      // 2. Save per-worker assignments for this batch
      const { error: aErr } = await supabase.from('batch_worker_assignments').insert(
        batch.workers.map((w) => ({
          batch_id: batchRecord.id,
          worker_id: w.id,
          task: batchTasks.join(', ') || null,
        }))
      )

      if (aErr) {
        setError(`Saved batch "${batchRecord.batch_name}" but worker assignments failed: ${aErr.message}`)
        setSavingBatches(false)
        return
      }

      saved++
    }

    // ── Notify Director(s) + Site Incharge(s) that batches were submitted ──
    // Best-effort: a notification failure must never block/undo a successful save.
    try {
      const [{ data: directors }, { data: siteIncharges }] = await Promise.all([
        supabase.from('profiles').select('id').eq('role', 'boss'),
        supabase.from('profiles').select('id').eq('field_manager', true),
      ])
      const recipientIds = [...new Set([
        ...(directors || []).map((d) => d.id),
        ...(siteIncharges || []).map((s) => s.id),
      ])].filter((id) => id && id !== supervisorId)

      const message = `${supervisorName || 'A supervisor'} created ${saved} batch${saved === 1 ? '' : 'es'} for ${formatDate(date)}.`
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

    setSavingBatches(false)
    setBatchSuccess(`${saved} batch${saved === 1 ? '' : 'es'} saved successfully for ${formatDate(date)}.`)
    // Reset to a single empty batch so the supervisor can start fresh
    setBatches([emptyBatch()])
    // Refresh the read-only summary of what's been submitted
    const { data: refreshed } = await fetchBatchesForSupervisorDate(supervisorId, date)
    setSavedBatches(refreshed || [])
  }

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-2 rounded-md bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}
      {batchSuccess && (
        <div className="mb-4 px-4 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {batchSuccess}
        </div>
      )}

      {/* ── Already submitted (read-only) ─────────────── */}
      {savedBatches.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
          <div className="px-5 pt-4 pb-1 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">
              ✓ Submitted for {formatDate(date)}
            </p>
            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
              Read-only
            </span>
          </div>
          <BatchTeamList batches={savedBatches} />
        </div>
      )}

      {/* ── Batch list ──────────────────────────────── */}
      {batches.map((batch, batchIdx) => (
        <div
          key={batch.id}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden"
        >
          {/* Batch header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#C0272D] text-white flex items-center justify-center text-sm font-bold">
                {batchIdx + 1}
              </div>
              <input
                type="text"
                value={batch.name}
                onChange={(e) => updateBatch(batchIdx, 'name', e.target.value)}
                placeholder={`Batch ${batchIdx + 1} — e.g. BF#3 Team`}
                className="text-sm font-semibold text-gray-900 outline-none border-b border-dashed border-gray-300 focus:border-[#C0272D] bg-transparent pb-0.5"
              />
            </div>
            {batches.length > 1 && (
              <button
                onClick={() => removeBatch(batchIdx)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>

          {/* Workers in this batch */}
          <div className="px-5 py-4 border-b border-gray-50">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Workers ({batch.workers.length})
            </p>
            {batch.workers.length > 0 ? (
              <div className="space-y-2 mb-3">
                {batch.workers.map((worker) => (
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
                      onClick={() => removeWorkerFromBatch(batchIdx, worker.id)}
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

            {/* Add workers from pool */}
            <button
              onClick={() => setPickingForBatch(batchIdx)}
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
                value={batch.project_description || ''}
                onChange={(e) => updateBatch(batchIdx, 'project_description', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
              >
                <option value="">Select project...</option>
                {PROJECT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                <option value="__custom__">Other (type below)</option>
              </select>
              {batch.project_description === '__custom__' && (
                <input
                  type="text"
                  placeholder="Enter project name..."
                  value={batch.custom_project || ''}
                  onChange={(e) => updateBatch(batchIdx, 'custom_project', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              )}
            </div>

            {/* Location */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">Location</label>
              <select
                value={batch.project_location || ''}
                onChange={(e) => updateBatch(batchIdx, 'project_location', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
              >
                <option value="">Select location...</option>
                {LOCATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="__custom__">Other (type below)</option>
              </select>
              {batch.project_location === '__custom__' && (
                <input
                  type="text"
                  placeholder="Enter location..."
                  value={batch.custom_location || ''}
                  onChange={(e) => updateBatch(batchIdx, 'custom_location', e.target.value)}
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
                  value={batch.timing_from || '09:00'}
                  onChange={(e) => updateBatch(batchIdx, 'timing_from', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">Work To</label>
                <input
                  type="time"
                  value={batch.timing_to || '18:00'}
                  onChange={(e) => updateBatch(batchIdx, 'timing_to', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
              </div>
            </div>

            {/* Tasks — full chip list */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 block">Tasks *</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {TASK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      const tasks = (batch.tasks || []).includes(chip)
                        ? (batch.tasks || []).filter((t) => t !== chip)
                        : [...(batch.tasks || []), chip]
                      updateBatch(batchIdx, 'tasks', tasks)
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      (batch.tasks || []).includes(chip)
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
                  value={batch.custom_task_input || ''}
                  onChange={(e) => updateBatch(batchIdx, 'custom_task_input', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && batch.custom_task_input?.trim()) {
                      e.preventDefault()
                      updateBatch(batchIdx, 'tasks', [...(batch.tasks || []), batch.custom_task_input.trim()])
                      updateBatch(batchIdx, 'custom_task_input', '')
                    }
                  }}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (batch.custom_task_input?.trim()) {
                      updateBatch(batchIdx, 'tasks', [...(batch.tasks || []), batch.custom_task_input.trim()])
                      updateBatch(batchIdx, 'custom_task_input', '')
                    }
                  }}
                  className="px-3 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200"
                >
                  Add
                </button>
              </div>
              {(batch.tasks || []).some((t) => !TASK_CHIPS.includes(t)) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(batch.tasks || []).filter((t) => !TASK_CHIPS.includes(t)).map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 text-xs bg-[#0F172A] text-white px-2.5 py-1 rounded-full"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => updateBatch(batchIdx, 'tasks', (batch.tasks || []).filter((x) => x !== t))}
                        className="text-white/70 hover:text-white"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Equipment */}
            <div className="mb-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 block">Equipment</label>
              <div className="space-y-2">
                {[
                  { key: 'crane', label: 'Crane', types: ['CRANE', 'BOOM LIFT'] },
                  { key: 'hydra', label: 'Hydra', types: ['HYDRA'] },
                  { key: 'trawler', label: 'Trawler', types: ['LORRY'] },
                  { key: 'cherry_picker', label: 'Cherry Picker', types: ['CAMPER', 'KIA', 'MARUTI', 'MAHINDRA', 'CRETA', 'EICHER', 'INDICA', 'ALTO', 'BUSS'] },
                ].map((equip) => (
                  <div key={equip.key} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 flex-shrink-0">{equip.label}</span>
                    <select
                      value={batch[equip.key] || ''}
                      onChange={(e) => updateBatch(batchIdx, equip.key, e.target.value)}
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
                ))}
              </div>
            </div>

            {/* OT Toggle */}
            <div className="mb-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Overtime Planned?</label>
                <button
                  type="button"
                  onClick={() => updateBatch(batchIdx, 'ot_planned', !batch.ot_planned)}
                  className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                    batch.ot_planned ? 'bg-amber-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    batch.ot_planned ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {batch.ot_planned && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-700 mb-2">⚠️ OT requires prior Director approval</p>
                  {['OT From', 'OT To'].map((label, i) => {
                    const key = i === 0 ? 'ot_from' : 'ot_to'
                    return (
                      <div key={key} className="mb-2">
                        <p className="text-xs text-amber-600 mb-1">{label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {OT_TIMES.map((time) => (
                            <button
                              key={time}
                              type="button"
                              onClick={() => updateBatch(batchIdx, key, time === batch[key] ? '' : time)}
                              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                                batch[key] === time
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
        </div>
      ))}

      {/* Add batch button */}
      <button
        onClick={addBatch}
        className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm font-semibold text-gray-400 hover:border-[#C0272D] hover:text-[#C0272D] transition-colors mb-4"
      >
        + Add another batch
      </button>

      {/* Collaboration — applies to the whole day, not per-batch */}
      <CollaboratorsCard userId={supervisorId} userName={supervisorName} date={date} />

      {/* Save all batches */}
      <button
        onClick={saveAllBatches}
        disabled={savingBatches}
        className="w-full bg-[#C0272D] hover:bg-red-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
      >
        {savingBatches ? 'Saving…' : 'Save All Batches'}
      </button>

      {/* ── Worker picker for a batch ─────────────────── */}
      {pickingForBatch !== null && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setPickingForBatch(null)} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '20px 20px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                Add workers to Batch {pickingForBatch + 1}
              </h3>
              <button onClick={() => setPickingForBatch(null)} className="text-gray-400">
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
                  const alreadyInBatch = batches[pickingForBatch]?.workers.some(
                    (w) => w.id === worker.id
                  )
                  const inOtherBatch = batches.some(
                    (b, i) => i !== pickingForBatch && b.workers.some((w) => w.id === worker.id)
                  )
                  return (
                    <button
                      key={worker.id}
                      type="button"
                      onClick={() => {
                        console.log('[batch picker] tapped:', { id: worker.id, full_name: worker.full_name, alreadyInBatch, inOtherBatch })
                        if (inOtherBatch) return
                        if (alreadyInBatch) {
                          removeWorkerFromBatch(pickingForBatch, worker.id)
                        } else {
                          updateBatch(pickingForBatch, 'workers', [
                            ...batches[pickingForBatch].workers,
                            worker,
                          ])
                        }
                      }}
                      disabled={inOtherBatch}
                      className={`appearance-none w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        alreadyInBatch
                          ? 'bg-[#0F172A] border-[#0F172A]'
                          : inOtherBatch
                          ? 'bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed'
                          : 'bg-white border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          alreadyInBatch ? 'bg-white text-[#0F172A]' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {displayName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            alreadyInBatch ? 'text-white' : 'text-gray-900'
                          }`}
                        >
                          {displayName}
                        </p>
                        <p className={`text-xs ${alreadyInBatch ? 'text-gray-300' : 'text-gray-400'}`}>
                          {worker.designation_name} {inOtherBatch ? '· In another batch' : ''}
                        </p>
                      </div>
                      {alreadyInBatch && <span className="text-white text-sm">✓</span>}
                    </button>
                  )
                })
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setPickingForBatch(null)}
                className="w-full bg-[#0F172A] text-white font-semibold py-3 rounded-xl"
              >
                Done — {batches[pickingForBatch]?.workers.length || 0} workers selected
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
