import { supabase } from './supabase'

/**
 * Site Incharge pending-review counts across all three queues.
 * These queues are not scoped to a specific FM — any field_manager=true
 * profile can act on any pending row — so this is a flat, app-wide count
 * (same filters as LeaveQueue stage="field_manager", fetchPendingOtForFM,
 * and fetchPendingAdvancesForFM).
 */
export async function fetchPendingApprovalCounts() {
  const [leave, ot, advance, plans] = await Promise.all([
    supabase.from('leave_requests').select('id', { count: 'exact', head: true })
      .eq('status', 'pending_field_manager'),
    supabase.from('attendance').select('id', { count: 'exact', head: true })
      .in('ot_status', ['pending_field_manager', 'pending']),
    supabase.from('weekly_advances').select('id', { count: 'exact', head: true })
      .eq('advance_status', 'pending_site_incharge'),
    // Bug 3a: planned-OT also belongs in the sidebar badge. morning_plan is text
    // (JSON string), so we cannot filter by an `->>'ot_status'` server-side and
    // count JS-side instead. Same parsing pattern as src/lib/plan-ot.js.
    supabase.from('work_plans').select('morning_plan'),
  ])

  const leaveCount    = leave.count || 0
  const otCount       = ot.count || 0
  const advanceCount  = advance.count || 0
  const plannedOtCount = (plans.data || []).filter((p) => {
    if (!p?.morning_plan) return false
    try {
      const parsed = JSON.parse(p.morning_plan)
      return parsed && parsed.ot_status === 'pending_field_manager'
    } catch { return false }
  }).length

  return {
    leave:       leaveCount,
    ot:          otCount,
    advance:     advanceCount,
    plannedOt:   plannedOtCount,
    total:       leaveCount + otCount + advanceCount + plannedOtCount,
  }
}
