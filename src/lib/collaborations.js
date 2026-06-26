import { supabase } from './supabase'

const sinceDateStr = (daysBack) => {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  return since.toISOString().slice(0, 10)
}

/**
 * All supervisors except the given user. Site Incharges are supervisors with
 * is_field_manager=true, so they're intentionally included here.
 */
export function fetchOtherSupervisors(userId) {
  return supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'supervisor')
    .neq('id', userId)
    .order('full_name')
}

/** Collaboration links THIS user initiated for a date (used to prefill the picker). */
export function fetchCollaborationsForDate(userId, date) {
  return supabase
    .from('work_plan_collaborations')
    .select('id, collaborator_id, status')
    .eq('initiator_id', userId)
    .eq('date', date)
}

/**
 * Sync this user's collaboration tags for a date to exactly `collaboratorIds`:
 * insert newly-added links (status 'pending') and delete removed ones, so
 * re-saving the same picker never duplicates rows. Returns { added, error }
 * where `added` is the list of newly-inserted rows ({ id, collaborator_id })
 * to notify — the row `id` lets the notification reference the exact link so
 * the collaborator can Accept / Decline it.
 */
export async function saveCollaborations(initiatorId, date, collaboratorIds) {
  const { data: existing, error: fetchErr } = await supabase
    .from('work_plan_collaborations')
    .select('id, collaborator_id')
    .eq('initiator_id', initiatorId)
    .eq('date', date)
  if (fetchErr) return { added: [], error: fetchErr }

  const existingIds = (existing || []).map((r) => r.collaborator_id)
  const addedIds = collaboratorIds.filter((id) => !existingIds.includes(id))
  const removed = (existing || []).filter((r) => !collaboratorIds.includes(r.collaborator_id))

  if (removed.length) {
    const { error } = await supabase
      .from('work_plan_collaborations')
      .delete()
      .in('id', removed.map((r) => r.id))
    if (error) return { added: [], error }
  }

  let added = []
  if (addedIds.length) {
    const { data: inserted, error } = await supabase
      .from('work_plan_collaborations')
      .insert(addedIds.map((collaboratorId) => ({
        initiator_id: initiatorId,
        collaborator_id: collaboratorId,
        date,
        status: 'pending',
      })))
      .select('id, collaborator_id')
    if (error) return { added: [], error }
    added = inserted || []
  }
  return { added, error: null }
}

/** Every collaboration link in the last `daysBack` days (for the work feeds). */
export function fetchCollaborationsRange(daysBack = 30) {
  return supabase
    .from('work_plan_collaborations')
    .select('id, initiator_id, collaborator_id, date, status')
    .gte('date', sinceDateStr(daysBack))
}

/**
 * Build a `${date}|${supervisorId}` -> [{ name, status }] map from collaboration
 * rows. Each link surfaces under BOTH supervisors, naming the other party.
 * `namesById` maps profile id -> display name.
 */
export function buildCollabMap(rows, namesById) {
  const map = {}
  const add = (date, supId, partnerId, status) => {
    const key = `${date}|${supId}`
    if (!map[key]) map[key] = []
    map[key].push({ name: namesById[partnerId] || 'Supervisor', status })
  }
  for (const r of rows || []) {
    add(r.date, r.initiator_id, r.collaborator_id, r.status)
    add(r.date, r.collaborator_id, r.initiator_id, r.status)
  }
  return map
}
