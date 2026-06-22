import { supabase } from './supabase'

/**
 * OT status flow:
 *   'pending_field_manager' → FM decides
 *   'pending_boss'          → Boss decides
 *   'approved'              → OT confirmed, included in payroll
 *   'rejected'              → OT zeroed, supervisor notified
 */

// ── Shared helper: fetch attendance OT rows + worker/supervisor names ─

async function fetchOtRows(statusFilter) {
  const { data: att, error } = await supabase
    .from('attendance')
    .select('id, worker_id, worker_table_id, supervisor_id, attendance_date, status, ot_hours, ot_status')
    .in('ot_status', statusFilter)
    .order('attendance_date', { ascending: false })
  if (error) return { error, data: null }

  const workerIds     = new Set()
  const supervisorIds = new Set()
  for (const r of att || []) {
    const wid = r.worker_table_id || r.worker_id
    if (wid) workerIds.add(wid)
    if (r.supervisor_id) supervisorIds.add(r.supervisor_id)
  }

  let nameById = {}
  const [wRes, sRes] = await Promise.all([
    workerIds.size > 0
      ? supabase.from('workers').select('id, full_name').in('id', Array.from(workerIds))
      : Promise.resolve({ data: [], error: null }),
    supervisorIds.size > 0
      ? supabase.from('profiles').select('id, full_name').in('id', Array.from(supervisorIds))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (wRes.error) return { error: wRes.error, data: null }
  for (const p of [...(wRes.data || []), ...(sRes.data || [])]) nameById[p.id] = p.full_name

  return {
    error: null,
    data: (att || []).map((r) => ({
      ...r,
      worker_name:     nameById[r.worker_table_id || r.worker_id] || 'Unnamed worker',
      supervisor_name: nameById[r.supervisor_id] || 'Supervisor',
    })),
  }
}

// ── Field Manager stage ────────────────────────────────────────────

/** Fetch OT requests waiting for Field Manager review. */
export function fetchPendingOtForFM() {
  // Include legacy 'pending' value so old rows still surface
  return fetchOtRows(['pending_field_manager', 'pending'])
}

/** FM approves → escalates to Boss. Notification fired by DB trigger. */
export function approveFMOt(attendanceId, fmId) {
  return supabase
    .from('attendance')
    .update({
      ot_status:        'pending_boss',
      ot_fm_decided_by: fmId,
      ot_fm_decided_at: new Date().toISOString(),
    })
    .eq('id', attendanceId)
}

/** FM rejects → trigger zeroes ot_hours. Notification fired by DB trigger. */
export function rejectFMOt(attendanceId, fmId) {
  return supabase
    .from('attendance')
    .update({
      ot_status:        'rejected',
      ot_fm_decided_by: fmId,
      ot_fm_decided_at: new Date().toISOString(),
    })
    .eq('id', attendanceId)
}

// ── Boss stage ──────────────────────────────────────────────────────

/** Fetch OT requests waiting for Boss approval. */
export function fetchPendingOtRequests() {
  return fetchOtRows(['pending_boss'])
}

/** Boss approves OT. Notification fired by DB trigger. */
export function approveOt(attendanceId, bossId) {
  return supabase
    .from('attendance')
    .update({
      ot_status:     'approved',
      ot_decided_at: new Date().toISOString(),
      ot_decided_by: bossId,
    })
    .eq('id', attendanceId)
}

/** Boss rejects OT. Trigger zeros ot_hours. Notification fired by DB trigger. */
export function rejectOt(attendanceId, bossId) {
  return supabase
    .from('attendance')
    .update({
      ot_status:     'rejected',
      ot_decided_at: new Date().toISOString(),
      ot_decided_by: bossId,
    })
    .eq('id', attendanceId)
}

/** Bulk Boss approve. */
export function approveOtBulk(attendanceIds, bossId) {
  if (!attendanceIds || attendanceIds.length === 0) {
    return Promise.resolve({ data: [], error: null })
  }
  return supabase
    .from('attendance')
    .update({
      ot_status:     'approved',
      ot_decided_at: new Date().toISOString(),
      ot_decided_by: bossId,
    })
    .in('id', attendanceIds)
}
