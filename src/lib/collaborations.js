import { supabase } from './supabase'
import { notifyUser } from './notifications'
import { formatDate } from './dates'

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

/**
 * Respond to a collaboration request from a notification: set the link's status
 * to 'accepted' / 'declined' and — on accept — notify the initiator that the
 * collaborator agreed. Resolves the exact link via the notification's
 * reference_id, falling back to this user's most recent pending request.
 *
 * Returns { error, collab }.
 */
export async function respondToCollaboration({ notification, userId, userName, status }) {
  let collab = null
  if (notification?.reference_id) {
    const { data } = await supabase
      .from('work_plan_collaborations')
      .select('id, initiator_id, date')
      .eq('id', notification.reference_id)
      .maybeSingle()
    collab = data
  }
  if (!collab) {
    const { data } = await supabase
      .from('work_plan_collaborations')
      .select('id, initiator_id, date')
      .eq('collaborator_id', userId)
      .eq('status', 'pending')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
    collab = data
  }
  if (!collab) return { error: null, collab: null }

  const { error } = await supabase
    .from('work_plan_collaborations')
    .update({ status })
    .eq('id', collab.id)
  if (error) return { error, collab: null }

  if (status === 'accepted') {
    await notifyUser({
      userId: collab.initiator_id,
      type: 'collaboration_accepted',
      title: 'Collaboration accepted',
      message: `${userName || 'A supervisor'} accepted your collaboration request for ${formatDate(collab.date)}.`,
    })
  }
  return { error: null, collab }
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

/**
 * From collaboration rows, build the ACCEPTED-pair maps used by the work feeds
 * to merge two supervisors' cards into one. The initiator is the "primary"
 * (their plan drives the merged card); the collaborator is the "secondary"
 * (their separate card is skipped). Keys are `${date}|${supervisorId}`.
 *   primaryByKey[`${date}|${initiatorId}`]    -> collaboratorId (partner to merge in)
 *   secondaryByKey[`${date}|${collaboratorId}`] -> initiatorId (the primary it folds into)
 */
export function buildAcceptedMerges(rows) {
  const primaryByKey = {}
  const secondaryByKey = {}
  for (const r of rows || []) {
    if (r.status !== 'accepted') continue
    primaryByKey[`${r.date}|${r.initiator_id}`] = r.collaborator_id
    secondaryByKey[`${r.date}|${r.collaborator_id}`] = r.initiator_id
  }
  return { primaryByKey, secondaryByKey }
}
