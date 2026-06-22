import { supabase } from './supabase'

export function fetchWorkPlan(supervisorId, planDate) {
  return supabase
    .from('work_plans')
    .select(
      'id, plan_date, morning_plan, evening_update, morning_posted_at, evening_posted_at'
    )
    .eq('supervisor_id', supervisorId)
    .eq('plan_date', planDate)
    .maybeSingle()
}

/**
 * Upsert a single field (morning_plan or evening_update) on the supervisor's
 * row for the given date. Only the specified field is written; the other
 * field is left untouched by the UPDATE path.
 */
export function upsertWorkPlanField(supervisorId, planDate, field, value) {
  return supabase
    .from('work_plans')
    .upsert(
      {
        supervisor_id: supervisorId,
        plan_date: planDate,
        [field]: value,
      },
      { onConflict: 'supervisor_id,plan_date' }
    )
    .select(
      'id, plan_date, morning_plan, evening_update, morning_posted_at, evening_posted_at'
    )
    .single()
}

// ============================================================
// Structured daily site report
//
// The work_plans table has no jsonb column, so the structured site
// report (project, permit, timing, equipment, task list) is stored as
// a JSON string in the existing `morning_plan` text column — the most
// appropriate column, and one nothing else in the UI renders. One row
// per (supervisor, date) via the existing unique constraint.
// ============================================================

/** Read + parse the saved site report for a date. Returns { data: object|null, error }. */
export async function fetchSiteReport(supervisorId, planDate) {
  const { data, error } = await supabase
    .from('work_plans')
    .select('id, plan_date, morning_plan')
    .eq('supervisor_id', supervisorId)
    .eq('plan_date', planDate)
    .maybeSingle()
  if (error) return { data: null, error }
  let report = null
  if (data?.morning_plan) {
    try { report = JSON.parse(data.morning_plan) } catch { report = null }
  }
  return { data: report, error: null }
}

/**
 * Boss feed: parsed structured site reports for the last `daysBack` days.
 * Returns { data: [{ supervisor_id, plan_date, report }], error }, skipping
 * rows whose morning_plan isn't valid JSON (legacy plain-text plans).
 */
export async function fetchSiteReportsRange(daysBack = 30) {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  const sinceStr = since.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('work_plans')
    .select('id, supervisor_id, plan_date, morning_plan')
    .gte('plan_date', sinceStr)
    .order('plan_date', { ascending: false })
  if (error) return { data: null, error }
  const out = []
  for (const row of data || []) {
    if (!row.morning_plan) continue
    let report
    try { report = JSON.parse(row.morning_plan) } catch { continue }
    if (report && typeof report === 'object') {
      out.push({ supervisor_id: row.supervisor_id, plan_date: row.plan_date, report })
    }
  }
  return { data: out, error: null }
}

/** Upsert the structured site report as JSON in morning_plan for (supervisor, date). */
export function saveSiteReport(supervisorId, planDate, report) {
  return supabase
    .from('work_plans')
    .upsert(
      {
        supervisor_id: supervisorId,
        plan_date: planDate,
        morning_plan: JSON.stringify(report),
      },
      { onConflict: 'supervisor_id,plan_date' }
    )
    .select('id, plan_date, morning_plan')
    .single()
}

/**
 * Boss feed: every supervisor's posts from the last `daysBack` days.
 */
export function fetchWorkPlansRange(daysBack = 30) {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  const sinceStr = since.toISOString().slice(0, 10)
  return supabase
    .from('work_plans')
    .select(
      'id, supervisor_id, plan_date, morning_plan, evening_update, morning_posted_at, evening_posted_at'
    )
    .gte('plan_date', sinceStr)
    .order('plan_date', { ascending: false })
}
