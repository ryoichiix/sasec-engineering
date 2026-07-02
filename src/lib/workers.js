// Worker classification helpers.

import { supabase } from './supabase'

/**
 * Fetch the identity of all staff (supervisors + Director) so we can detect
 * "dual-role" workers — people who have BOTH a profiles login AND a separate
 * worker/payroll row in public.workers. See memory: dual-role-staff.
 *
 * Detection matches on id OR normalized full_name: in production these two
 * identities do NOT share an id (the worker row has its own id), so an id-only
 * check finds nothing — the reliable link is the name. Returns { ids, names }
 * as Sets (plus any query error).
 */
export async function fetchStaffIdentity() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('role', ['supervisor', 'boss'])
  const ids = new Set()
  const names = new Set()
  for (const p of data || []) {
    ids.add(p.id)
    if (p.full_name) names.add(p.full_name.trim().toLowerCase())
  }
  return { ids, names, error: error || null }
}

/**
 * True when a worker row is also a supervisor/Director (dual-role staff).
 * `staff` is the shape returned by fetchStaffIdentity().
 */
export function isDualRoleWorker(worker, staff) {
  if (!worker || !staff) return false
  const name = (worker.full_name || '').trim().toLowerCase()
  return staff.ids?.has(worker.id) || (!!name && staff.names?.has(name))
}

/**
 * Directors (role='boss') live in the profiles table, not in public.workers.
 * They only surface in worker-facing lists when they've been given a worker
 * row whose designation is "Director" / "Boss". Treat those as directors so
 * they always show On Duty and never enter the team pool.
 */
export function isDirectorByDesignation(name) {
  if (!name) return false
  const n = String(name).toLowerCase()
  return n.includes('director') || n.includes('boss')
}

/** Resolve a worker's designation name from the FK join or the denormalised column. */
export function workerDesignationName(worker) {
  return worker?.designations?.name || worker?.designation_name || ''
}

/** True when a worker should be treated as a director. */
export function isDirector(worker) {
  return isDirectorByDesignation(workerDesignationName(worker))
}
