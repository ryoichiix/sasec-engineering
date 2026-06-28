import { supabase } from './supabase'
import { notifyUser } from './notifications'
import { formatDate } from './dates'

/**
 * Planned-OT approval chain — the OT a supervisor schedules in their morning
 * work plan (work_plans.morning_plan), NOT the actual worked OT logged per
 * worker in `attendance` (that separate chain lives in lib/ot.js + feeds
 * payroll and is untouched here).
 *
 * Status lives inside the morning_plan JSON as `ot_status`:
 *   'pending_field_manager' → Site Incharge decides
 *   'pending_boss'          → Director decides
 *   'approved'              → OT plan confirmed
 *   'rejected'              → OT plan declined
 *
 * morning_plan is a TEXT column holding a JSON string (work_plans has no jsonb
 * column), so we cannot use Postgres `->>`: rows are parsed/filtered in JS, and
 * every write READS → MERGES → WRITES so the rest of the plan JSON is preserved.
 */

const DAYS_BACK = 30

const otRange = (r) => [r.ot_from, r.ot_to].filter(Boolean).join(' – ')

/** Fetch planned-OT rows whose ot_status is in `statuses`, with supervisor names. */
async function fetchPlannedOt(statuses, daysBack = DAYS_BACK) {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('work_plans')
    .select('id, supervisor_id, plan_date, morning_plan')
    .gte('plan_date', sinceStr)
    .order('plan_date', { ascending: false })
  if (error) return { error, data: null }

  const rows = []
  const supIds = new Set()
  for (const row of data || []) {
    if (!row.morning_plan) continue
    let report
    try { report = JSON.parse(row.morning_plan) } catch { continue }
    if (!report || typeof report !== 'object') continue
    if (!report.overtime) continue
    if (!statuses.includes(report.ot_status)) continue
    rows.push({
      id: row.id,
      supervisor_id: row.supervisor_id,
      plan_date: row.plan_date,
      ot_from: report.ot_from || '',
      ot_to: report.ot_to || '',
      project_description: report.project_description || '',
      project_location: report.project_location || '',
      ot_status: report.ot_status,
    })
    if (row.supervisor_id) supIds.add(row.supervisor_id)
  }

  let nameById = {}
  if (supIds.size) {
    const { data: profs } = await supabase
      .from('profiles').select('id, full_name').in('id', Array.from(supIds))
    for (const p of profs || []) nameById[p.id] = p.full_name
  }
  for (const r of rows) r.supervisor_name = nameById[r.supervisor_id] || 'Supervisor'
  return { error: null, data: rows }
}

/**
 * Flip ot_status on a supervisor's plan via the SECURITY DEFINER RPC. Approvers
 * (Site Incharge / Director) don't own the row, so RLS blocks a direct client
 * update; the RPC authorizes the caller and MERGES only ot_status server-side,
 * leaving the rest of the plan JSON untouched. Requires migration 50.
 */
async function updatePlannedOtStatus(planId, nextStatus) {
  const { error } = await supabase.rpc('set_planned_ot_status', {
    p_plan_id: planId,
    p_status: nextStatus,
  })
  return { error: error || null }
}

/** Notifications are best-effort: a failure here must never block the decision. */
async function safeNotify(fn) {
  try { await fn() } catch (e) { console.error('Planned-OT notification failed:', e) }
}

// ── Site Incharge (Field Manager) stage ─────────────────────────────

/** OT plans waiting for Site Incharge review. */
export function fetchPendingPlannedOtForFM() {
  return fetchPlannedOt(['pending_field_manager'])
}

/** Site Incharge approves → escalates to the Director, who is notified. */
export async function fmApprovePlannedOt(row) {
  const { error } = await updatePlannedOtStatus(row.id, 'pending_boss')
  if (error) return { error }
  await safeNotify(async () => {
    const { data: bosses } = await supabase.from('profiles').select('id').eq('role', 'boss')
    const range = otRange(row)
    const dateLabel = formatDate(row.plan_date)
    await Promise.all((bosses || []).map((b) => notifyUser({
      userId: b.id,
      type: 'ot_approval',
      title: 'OT approval needed',
      message: `${row.supervisor_name} planned overtime${range ? ` (${range})` : ''} for ${dateLabel} — approved by the Site Incharge, awaiting your approval.`,
      referenceId: row.id,
      referenceType: 'work_plan_ot',
    })))
  })
  return { error: null }
}

/** Site Incharge rejects → supervisor notified. */
export async function fmRejectPlannedOt(row) {
  const { error } = await updatePlannedOtStatus(row.id, 'rejected')
  if (error) return { error }
  await safeNotify(() => notifyUser({
    userId: row.supervisor_id,
    type: 'ot_rejected',
    title: 'OT not approved',
    message: `Your planned overtime for ${formatDate(row.plan_date)} was not approved by the Site Incharge.`,
    referenceId: row.id,
    referenceType: 'work_plan_ot',
  }))
  return { error: null }
}

// ── Director (Boss) stage ───────────────────────────────────────────

/** OT plans waiting for Director approval. */
export function fetchPendingPlannedOtForBoss() {
  return fetchPlannedOt(['pending_boss'])
}

/** Director approves → original supervisor notified. */
export async function bossApprovePlannedOt(row) {
  const { error } = await updatePlannedOtStatus(row.id, 'approved')
  if (error) return { error }
  const range = otRange(row)
  await safeNotify(() => notifyUser({
    userId: row.supervisor_id,
    type: 'ot_approved',
    title: 'OT approved',
    message: `Your planned overtime${range ? ` (${range})` : ''} for ${formatDate(row.plan_date)} has been approved by the Director.`,
    referenceId: row.id,
    referenceType: 'work_plan_ot',
  }))
  return { error: null }
}

/** Director rejects → original supervisor notified. */
export async function bossRejectPlannedOt(row) {
  const { error } = await updatePlannedOtStatus(row.id, 'rejected')
  if (error) return { error }
  await safeNotify(() => notifyUser({
    userId: row.supervisor_id,
    type: 'ot_rejected',
    title: 'OT not approved',
    message: `Your planned overtime for ${formatDate(row.plan_date)} was not approved by the Director.`,
    referenceId: row.id,
    referenceType: 'work_plan_ot',
  }))
  return { error: null }
}
