// Worker classification helpers.

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
