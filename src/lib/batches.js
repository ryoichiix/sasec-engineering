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
  id, supervisor_id, date, batch_name, batch_number, project_location, tasks, worker_ids, created_at,
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
