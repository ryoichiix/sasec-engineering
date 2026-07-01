import { supabase } from './supabase'

const sinceDateStr = (daysBack) => {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  return since.toISOString().slice(0, 10)
}

// NOTE: workers have `designation_id` + a joined `designations(name)` — there is
// no plain `designation` column, so we embed the join (selecting a non-existent
// column would make PostgREST reject the whole request).
const BATCH_SELECT = `
  id, supervisor_id, date, batch_name, batch_number, project_description, project_location, tasks, metadata, worker_ids, created_at,
  assignments:batch_worker_assignments(
    id,
    worker:workers(id, full_name, designations(name))
  )
`

/**
 * Boss / Site-Incharge feed: every Batch-Mode team from the last `daysBack`
 * days, each with its worker assignments embedded. Callers bucket these into
 * `${date}|${supervisor_id}` keys to slot under the matching supervisor card.
 */
export function fetchBatchesRange(daysBack = 30) {
  return supabase
    .from('today_team_batches')
    .select(BATCH_SELECT)
    .gte('date', sinceDateStr(daysBack))
    .order('created_at', { ascending: true })
}

/** One supervisor's saved batches for a single date (read-only summary). */
export function fetchBatchesForSupervisorDate(supervisorId, date) {
  return supabase
    .from('today_team_batches')
    .select(BATCH_SELECT)
    .eq('supervisor_id', supervisorId)
    .eq('date', date)
    .order('batch_number', { ascending: true })
}

// ── Sequential wizard: create / update a single batch ────────────────────────
// The batch's full work plan (project, timing, equipment, OT, and — from
// Feature 3 — per-vehicle equipment slots) lives in the `metadata` jsonb column;
// project/location/tasks/worker_ids are also mirrored to top-level columns the
// feeds read. `workers` is an array of { id } (extra fields ignored).

const assignmentRows = (batchId, workers, tasks) =>
  workers.map((w) => ({
    batch_id: batchId,
    worker_id: w.id,
    task: (tasks || []).join(', ') || null,
  }))

/**
 * All batches for a single date across EVERY supervisor — used by the equipment
 * double-booking check (Feature 3). Only the fields the check needs. Visibility
 * depends on today_team_batches RLS: if supervisors can't read peers' rows, the
 * check degrades to same-supervisor detection.
 */
export function fetchBatchesForDate(date) {
  return supabase
    .from('today_team_batches')
    .select('id, supervisor_id, batch_name, batch_number, metadata')
    .eq('date', date)
}

// Two [in, out) ranges overlap iff each starts strictly before the other ends.
// Times are zero-padded "HH:MM" (24h), so lexicographic compare == chronological.
export function timesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA
}

/**
 * Feature 3: detect equipment double-booking. For each vehicle in `equipment`
 * (the batch about to be saved), find any OTHER batch on `date` that books the
 * same vehicle over an overlapping time range. Returns { data: conflicts[],
 * error }; an empty array means clear to save. `excludeBatchId` skips the batch
 * being edited so it never conflicts with itself. `equipment` entries are
 * { vehicle_id, vehicle_name, time_in, time_out }.
 */
export async function checkEquipmentConflicts({ date, equipment, excludeBatchId = null }) {
  const wanted = (equipment || []).filter(
    (e) => e.time_in && e.time_out && (e.vehicle_id || e.vehicle_name)
  )
  if (wanted.length === 0) return { data: [], error: null }

  const { data: batches, error } = await fetchBatchesForDate(date)
  if (error) return { data: [], error }

  const conflicts = []
  for (const b of batches || []) {
    if (excludeBatchId && b.id === excludeBatchId) continue
    for (const other of (b.metadata?.equipment || [])) {
      if (!other.time_in || !other.time_out) continue
      for (const mine of wanted) {
        const sameVehicle = mine.vehicle_id && other.vehicle_id
          ? mine.vehicle_id === other.vehicle_id
          : mine.vehicle_name === other.vehicle_name
        if (!sameVehicle) continue
        if (timesOverlap(mine.time_in, mine.time_out, other.time_in, other.time_out)) {
          conflicts.push({
            vehicle_name: mine.vehicle_name,
            time_in: other.time_in,
            time_out: other.time_out,
            batch_name: b.batch_name,
            supervisor_id: b.supervisor_id,
          })
        }
      }
    }
  }

  // Best-effort: attach supervisor display names for the warning text.
  const supIds = [...new Set(conflicts.map((c) => c.supervisor_id).filter(Boolean))]
  if (supIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', supIds)
    const nameById = new Map((profs || []).map((p) => [p.id, p.full_name]))
    for (const c of conflicts) c.supervisor_name = nameById.get(c.supervisor_id) || null
  }

  return { data: conflicts, error: null }
}

/** Insert one batch + its per-worker assignment rows. Returns { data, error }. */
export async function createBatch({ supervisorId, date, batchNumber, batchName, projectDescription, projectLocation, tasks, workers, metadata }) {
  const { data: record, error } = await supabase
    .from('today_team_batches')
    .insert({
      supervisor_id: supervisorId,
      date,
      batch_name: batchName,
      batch_number: batchNumber,
      project_description: projectDescription,
      project_location: projectLocation,
      tasks: tasks || [],
      worker_ids: workers.map((w) => w.id),
      metadata,
    })
    .select()
    .single()
  if (error) return { error }

  const { error: aErr } = await supabase
    .from('batch_worker_assignments')
    .insert(assignmentRows(record.id, workers, tasks))
  if (aErr) return { data: record, error: aErr }
  return { data: record }
}

/**
 * Update an existing batch in place (Edit flow) and REPLACE its worker
 * assignments (delete-all + reinsert, since the roster may have changed).
 * Requires the supervisor to have update/delete rights on their own batch rows.
 * Returns { data, error }.
 */
export async function updateBatchRecord({ id, batchName, projectDescription, projectLocation, tasks, workers, metadata }) {
  const { error } = await supabase
    .from('today_team_batches')
    .update({
      batch_name: batchName,
      project_description: projectDescription,
      project_location: projectLocation,
      tasks: tasks || [],
      worker_ids: workers.map((w) => w.id),
      metadata,
    })
    .eq('id', id)
  if (error) return { error }

  const { error: delErr } = await supabase
    .from('batch_worker_assignments')
    .delete()
    .eq('batch_id', id)
  if (delErr) return { error: delErr }

  const { error: aErr } = await supabase
    .from('batch_worker_assignments')
    .insert(assignmentRows(id, workers, tasks))
  if (aErr) return { error: aErr }
  return { data: { id } }
}
