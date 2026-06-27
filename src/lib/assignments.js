import { supabase } from './supabase'

/**
 * Workers marked present on `date`, read from the workers table.
 *
 * Reads attendance where EITHER worker_id OR worker_table_id matches a
 * workers.id — handles rows inserted both before and after migration 29.
 */
export async function fetchPresentWorkers(date) {
  // Fetch all worker IDs from the workers table first
  const { data: allWorkers, error: wErr } = await supabase
    .from('workers')
    .select('id')
  if (wErr) return { error: wErr, data: null }
  const workerIds = (allWorkers || []).map((w) => w.id)
  if (workerIds.length === 0) return { error: null, data: [] }

  // Get present attendance rows — try worker_id column (the constrained one)
  const { data: att, error: e1 } = await supabase
    .from('attendance')
    .select('worker_id, worker_table_id')
    .eq('attendance_date', date)
    .eq('status', 'present')
  if (e1) return { error: e1, data: null }

  // Collect unique worker IDs that exist in the workers table
  const presentIds = new Set()
  for (const r of att || []) {
    const id = r.worker_id || r.worker_table_id
    if (id && workerIds.includes(id)) presentIds.add(id)
  }
  if (presentIds.size === 0) return { error: null, data: [] }

  const { data: workers, error: e2 } = await supabase
    .from('workers')
    .select('id, full_name, designation_id, designations(name)')
    .in('id', Array.from(presentIds))
    .order('full_name')
  if (e2) return { error: e2, data: null }
  return { error: null, data: workers || [] }
}

export function fetchAssignmentsForDate(date) {
  return supabase
    .from('daily_assignments')
    .select('id, worker_id, worker_table_id, supervisor_id, assignment_date, project_name, project_location, task_assigned')
    .eq('assignment_date', date)
}

/**
 * Every worker in the table, ordered by name — the unfiltered pool used by the
 * Today's Plan / Batch worker pickers. No attendance/presence gate, so a
 * supervisor can build a team even before attendance is marked. No join to
 * `designations` — reads the denormalised `designation_name` column directly
 * so a relationship/RLS hiccup on the designations table can't blank the pool.
 */
export async function fetchAllWorkers() {
  const { data, error } = await supabase
    .from('workers')
    .select('id, full_name, designation_name, wage_type')
    .order('full_name')
  console.log('[fetchAllWorkers] workers:', data?.length, error)
  return { data, error }
}

/**
 * Boss feed: all assignments from the last `daysBack` days, used to build
 * each supervisor's team per date. Worker name + designation are resolved
 * separately (callers fetch from the workers table by id).
 */
export function fetchAssignmentsRange(daysBack = 30) {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  const sinceStr = since.toISOString().slice(0, 10)
  return supabase
    .from('daily_assignments')
    .select('id, worker_id, worker_table_id, supervisor_id, assignment_date, task_assigned')
    .gte('assignment_date', sinceStr)
}

export function fetchMyAssignmentsForDate(supervisorId, date) {
  return supabase
    .from('daily_assignments')
    .select('id, worker_id, worker_table_id, supervisor_id, assignment_date, project_name, project_location, task_assigned')
    .eq('supervisor_id', supervisorId)
    .eq('assignment_date', date)
}

/**
 * STRICT claim — write BOTH worker_id (satisfies NOT NULL + unique constraint)
 * AND worker_table_id (new FK to workers table) on every insert. Stamps the
 * row with the supervisor's current project info so new teammates inherit
 * the same project_name/project_location.
 */
export function claimWorker(workerId, supervisorId, date, projectInfo = {}) {
  return supabase
    .from('daily_assignments')
    .insert({
      worker_id:       workerId,   // satisfies NOT NULL + unique(worker_id, assignment_date)
      worker_table_id: workerId,   // FK to public.workers
      supervisor_id:   supervisorId,
      assignment_date: date,
      project_name:     projectInfo.projectName     ?? null,
      project_location: projectInfo.projectLocation ?? null,
    })
    .select('id, worker_id, worker_table_id, supervisor_id, assignment_date, project_name, project_location, task_assigned')
    .single()
}

/**
 * Update project_name + project_location on every row for this supervisor
 * on this date — applied whenever the supervisor edits the project card so
 * all teammates stay in sync.
 */
export function updateTeamProject(supervisorId, date, { projectName, projectLocation }) {
  return supabase
    .from('daily_assignments')
    .update({
      project_name:     projectName?.trim() || null,
      project_location: projectLocation?.trim() || null,
    })
    .eq('supervisor_id', supervisorId)
    .eq('assignment_date', date)
}

/** Set the per-worker task on a single assignment row. */
export function updateAssignmentTask(assignmentId, taskAssigned) {
  return supabase
    .from('daily_assignments')
    .update({ task_assigned: taskAssigned?.trim() || null })
    .eq('id', assignmentId)
}

/** Remove a worker from today's team — delete by worker_id (constrained column). */
export function releaseWorker(workerId, date) {
  return supabase
    .from('daily_assignments')
    .delete()
    .eq('worker_id', workerId)
    .eq('assignment_date', date)
}

/**
 * Fetch the names of all supervisors who own at least one assignment today.
 */
export async function fetchSupervisorNames(supervisorIds) {
  if (!supervisorIds || supervisorIds.length === 0) {
    return { data: {}, error: null }
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', supervisorIds)  // supervisors are still in profiles
  if (error) return { data: null, error }
  const map = {}
  for (const p of data || []) map[p.id] = p.full_name
  return { data: map, error: null }
}
