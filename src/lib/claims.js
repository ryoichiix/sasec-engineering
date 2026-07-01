// Worker-picker "already claimed" logic — pure, no I/O, so it's unit-testable and
// shared by BOTH the single-mode (Today's Plan) and batch-mode pickers.
//
// A worker can be claimed for a date through EITHER surface:
//   • single mode  -> a daily_assignments row               ({ worker_id / worker_table_id, supervisor_id })
//   • batch mode   -> a today_team_batches row's worker_ids  ({ supervisor_id, worker_ids: [] })
// Both must be merged so a picker greys out cross-supervisor claims regardless of
// which mode created them (the double-booking gap this fixes: batch claims were
// never consulted by either picker).

/**
 * Merge single-mode assignment rows and batch rows into one
 * Map<worker_id, Set<supervisor_id>> — who holds each worker on the date.
 * daily_assignments rows may carry the id on `worker_id` or (post-migration 29)
 * `worker_table_id`; either identifies the workers-table row.
 */
export function buildClaimedMap(assignments = [], batches = []) {
  const map = new Map()
  const add = (workerId, supId) => {
    if (!workerId || !supId) return
    if (!map.has(workerId)) map.set(workerId, new Set())
    map.get(workerId).add(supId)
  }
  for (const a of assignments || []) add(a.worker_id || a.worker_table_id, a.supervisor_id)
  for (const b of batches || []) for (const wid of (b.worker_ids || [])) add(wid, b.supervisor_id)
  return map
}

/**
 * Worker ids a picker must grey out: claimed by at least one supervisor who is
 * NEITHER the viewer NOR one of their accepted collaborators. Self is excluded
 * so a supervisor can still see/toggle their own picks; accepted partners are
 * excluded so a shared collaboration pool is never mistaken for an external
 * claim. A worker co-held by both a partner and an external supervisor is still
 * external (double-booking risk wins).
 */
export function buildExternalClaimIds(claimedMap, { selfId, partnerIds = [] } = {}) {
  const partners = new Set(partnerIds)
  const external = new Set()
  for (const [workerId, owners] of claimedMap || new Map()) {
    for (const sup of owners) {
      if (sup !== selfId && !partners.has(sup)) { external.add(workerId); break }
    }
  }
  return external
}

/**
 * Worker ids held ONLY by an accepted collaborator (not the viewer, no external
 * co-holder) — the shared pool. The single-mode picker shows these as
 * already-in-the-shared-team rather than greying them or offering a fresh claim
 * that would collide with the unique(worker_id, assignment_date) constraint.
 */
export function buildPartnerHeldIds(claimedMap, { selfId, partnerIds = [] } = {}) {
  const partners = new Set(partnerIds)
  const held = new Set()
  for (const [workerId, owners] of claimedMap || new Map()) {
    if (owners.has(selfId)) continue
    let hasPartner = false
    let hasExternal = false
    for (const sup of owners) {
      if (partners.has(sup)) hasPartner = true
      else if (sup !== selfId) hasExternal = true
    }
    if (hasPartner && !hasExternal) held.add(workerId)
  }
  return held
}
