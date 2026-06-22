import { supabase } from './supabase'

// ============================================================
// Weekly advances
//
// Advances are entered by the supervisor while marking attendance:
// one amount per worker per pay-week (Monday-anchored `week_start`).
// Each row also carries a `payment_mode` of 'cash' or 'bank_transfer'.
// Payroll reads these rows and deducts any whose week_start falls
// inside the selected pay period.
// ============================================================

// Advances strictly greater than this need site-incharge → boss approval.
// Mirrors public.advance_auto_threshold() in supabase/37-advance-approval-flow.sql.
export const ADVANCE_AUTO_THRESHOLD = 1000

export const PAYMENT_MODES = [
  { value: 'cash',          label: 'Cash'          },
  { value: 'bank_transfer', label: 'Bank Transfer' },
]

export function paymentModeLabel(mode) {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label
    ?? (mode === 'bank_transfer' ? 'Bank Transfer' : 'Cash')
}

/** Advances for a given week + set of workers (Supervisor attendance view). */
export async function fetchWeeklyAdvancesForWeek(weekStart, workerIds) {
  if (!workerIds || workerIds.length === 0) {
    return { data: [], error: null }
  }
  return supabase
    .from('weekly_advances')
    .select('worker_table_id, amount, payment_mode, advance_status')
    .eq('week_start', weekStart)
    .in('worker_table_id', workerIds)
}

/** Create or update the advance for a worker in a given week. */
export async function upsertWeeklyAdvance({
  workerId,
  weekStart,
  amount,
  paymentMode = 'cash',
  supervisorId,
}) {
  return supabase
    .from('weekly_advances')
    .upsert(
      {
        worker_id:      workerId,   // matches the unique constraint (worker_id, week_start)
        worker_table_id: workerId,  // FK to workers table
        week_start:    weekStart,
        amount:        Number(amount) || 0,
        payment_mode:  paymentMode,
        supervisor_id: supervisorId,
      },
      { onConflict: 'worker_id,week_start' }
    )
    .select()
    .single()
}

// ── Payroll helpers ────────────────────────────────────────────────────────

/**
 * Returns advances for every worker whose week_start falls within
 * [start, end] (inclusive). Used by BossPayroll for per-worker totals
 * and the Cash vs Bank Transfer summary.
 */
export async function fetchWeeklyAdvancesInPeriod(start, end) {
  return supabase
    .from('weekly_advances')
    .select('worker_table_id, amount, week_start, payment_mode, advance_status')
    .gte('week_start', start)
    .lte('week_start', end)
}

/**
 * Returns a single worker's advances whose week_start falls within
 * [start, end]. Used by WorkerPayroll.
 */
export async function fetchMyWeeklyAdvancesInPeriod(workerId, start, end) {
  return supabase
    .from('weekly_advances')
    .select('amount, week_start, payment_mode')
    .eq('worker_table_id', workerId)
    .gte('week_start', start)
    .lte('week_start', end)
}

/**
 * Worker-profile view: every advance ever for a worker, newest first.
 */
export async function fetchAllAdvancesForWorker(workerId) {
  return supabase
    .from('weekly_advances')
    .select('id, worker_table_id, amount, week_start, payment_mode, supervisor_id, created_at, advance_status')
    .eq('worker_table_id', workerId)
    .order('week_start', { ascending: false })
}

/**
 * Advances created within [startDate, endDate] (inclusive, by created_at),
 * optionally scoped to one supervisor, joined with worker + supervisor
 * display names. Used by the Advances pages.
 */
export async function fetchAdvancesWithNames({ startDate, endDate, supervisorId } = {}) {
  let query = supabase
    .from('weekly_advances')
    .select('id, worker_id, worker_table_id, supervisor_id, week_start, amount, payment_mode, advance_status, created_at')
    .order('created_at', { ascending: false })
  if (startDate) query = query.gte('created_at', `${startDate}T00:00:00`)
  if (endDate)   query = query.lte('created_at', `${endDate}T23:59:59.999`)
  if (supervisorId) query = query.eq('supervisor_id', supervisorId)

  const { data: rows, error } = await query
  if (error) return { error, data: null }

  const workerIds     = new Set()
  const supervisorIds = new Set()
  for (const r of rows || []) {
    const wid = r.worker_table_id || r.worker_id
    if (wid) workerIds.add(wid)
    if (r.supervisor_id) supervisorIds.add(r.supervisor_id)
  }

  const [wRes, sRes] = await Promise.all([
    workerIds.size > 0
      ? supabase.from('workers').select('id, full_name').in('id', Array.from(workerIds))
      : Promise.resolve({ data: [], error: null }),
    supervisorIds.size > 0
      ? supabase.from('profiles').select('id, full_name').in('id', Array.from(supervisorIds))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (wRes.error) return { error: wRes.error, data: null }

  const nameById = {}
  for (const p of [...(wRes.data || []), ...(sRes.data || [])]) nameById[p.id] = p.full_name

  return {
    error: null,
    data: (rows || []).map((r) => ({
      ...r,
      worker_name:     nameById[r.worker_table_id || r.worker_id] || 'Unnamed worker',
      supervisor_name: nameById[r.supervisor_id] || 'Supervisor',
    })),
  }
}

// ── Advance approval workflow ──────────────────────────────────────────────

/**
 * Shared helper: fetch weekly_advances rows whose status is in `statuses`,
 * joined with worker + supervisor display names.
 */
async function fetchAdvanceRows(statuses) {
  const { data: rows, error } = await supabase
    .from('weekly_advances')
    .select('id, worker_id, worker_table_id, supervisor_id, week_start, amount, payment_mode, advance_status, created_at')
    .in('advance_status', statuses)
    .order('created_at', { ascending: false })
  if (error) return { error, data: null }

  const workerIds     = new Set()
  const supervisorIds = new Set()
  for (const r of rows || []) {
    const wid = r.worker_table_id || r.worker_id
    if (wid) workerIds.add(wid)
    if (r.supervisor_id) supervisorIds.add(r.supervisor_id)
  }

  const [wRes, sRes] = await Promise.all([
    workerIds.size > 0
      ? supabase.from('workers').select('id, full_name').in('id', Array.from(workerIds))
      : Promise.resolve({ data: [], error: null }),
    supervisorIds.size > 0
      ? supabase.from('profiles').select('id, full_name').in('id', Array.from(supervisorIds))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (wRes.error) return { error: wRes.error, data: null }

  const nameById = {}
  for (const p of [...(wRes.data || []), ...(sRes.data || [])]) nameById[p.id] = p.full_name

  return {
    error: null,
    data: (rows || []).map((r) => ({
      ...r,
      worker_name:     nameById[r.worker_table_id || r.worker_id] || 'Unnamed worker',
      supervisor_name: nameById[r.supervisor_id] || 'Supervisor',
    })),
  }
}

/** Site Incharge stage: advance requests awaiting first review. */
export function fetchPendingAdvancesForFM() {
  return fetchAdvanceRows(['pending_site_incharge'])
}

/** Site Incharge approves → escalates to Boss. */
export function approveFMAdvance(advanceId, fmId) {
  return supabase
    .from('weekly_advances')
    .update({
      advance_status: 'pending_boss',
      fm_decided_by:  fmId,
      fm_decided_at:  new Date().toISOString(),
    })
    .eq('id', advanceId)
}

/** Site Incharge rejects → trigger zeroes amount. */
export function rejectFMAdvance(advanceId, fmId) {
  return supabase
    .from('weekly_advances')
    .update({
      advance_status: 'rejected',
      fm_decided_by:  fmId,
      fm_decided_at:  new Date().toISOString(),
    })
    .eq('id', advanceId)
}

/** Boss stage: advance requests awaiting final approval. */
export function fetchPendingAdvanceRequests() {
  return fetchAdvanceRows(['pending_boss'])
}

/** Boss approves the advance. */
export function approveAdvance(advanceId, bossId) {
  return supabase
    .from('weekly_advances')
    .update({
      advance_status: 'approved',
      decided_by:     bossId,
      decided_at:     new Date().toISOString(),
    })
    .eq('id', advanceId)
}

/** Boss rejects the advance — trigger zeroes amount. */
export function rejectAdvance(advanceId, bossId) {
  return supabase
    .from('weekly_advances')
    .update({
      advance_status: 'rejected',
      decided_by:     bossId,
      decided_at:     new Date().toISOString(),
    })
    .eq('id', advanceId)
}
