import { supabase } from './supabase'

/**
 * Site Incharge pending-review counts across all three queues.
 * These queues are not scoped to a specific FM — any field_manager=true
 * profile can act on any pending row — so this is a flat, app-wide count
 * (same filters as LeaveQueue stage="field_manager", fetchPendingOtForFM,
 * and fetchPendingAdvancesForFM).
 */
export async function fetchPendingApprovalCounts() {
  const [leave, ot, advance] = await Promise.all([
    supabase.from('leave_requests').select('id', { count: 'exact', head: true })
      .eq('status', 'pending_field_manager'),
    supabase.from('attendance').select('id', { count: 'exact', head: true })
      .in('ot_status', ['pending_field_manager', 'pending']),
    supabase.from('weekly_advances').select('id', { count: 'exact', head: true })
      .eq('advance_status', 'pending_site_incharge'),
  ])

  const leaveCount    = leave.count || 0
  const otCount       = ot.count || 0
  const advanceCount  = advance.count || 0

  return {
    leave:    leaveCount,
    ot:       otCount,
    advance:  advanceCount,
    total:    leaveCount + otCount + advanceCount,
  }
}
