import { supabase } from './supabase'

// Bug 2: the Work Feed sidebar badge should reflect NEW feed activity since the
// user last opened Work Feed — not the pending-approvals count it was
// accidentally reusing. "Last viewed" is stored per user in localStorage (keyed
// by user id so shared devices stay correct) to avoid a schema change.
const viewedKey = (userId) => `sasec:work_feed_last_viewed:${userId}`

/** ISO timestamp of when this user last opened Work Feed, or null if never. */
export function getWorkFeedLastViewed(userId) {
  if (!userId) return null
  try {
    return localStorage.getItem(viewedKey(userId))
  } catch {
    return null
  }
}

/** Stamp "now" as this user's last-viewed time — called when they open the feed. */
export function markWorkFeedViewed(userId) {
  if (!userId) return
  try {
    localStorage.setItem(viewedKey(userId), new Date().toISOString())
  } catch {
    /* ignore private-mode / quota errors — the badge is advisory */
  }
}

/**
 * Count of Work-Feed items new since `sinceIso`: work plans created OR edited
 * (updated_at) and Batch-Mode teams created after that time. The viewer's own
 * rows are excluded so a Site Incharge who is also a supervisor isn't badged
 * for their own submissions (a Director has no supervisor rows, so they see
 * every supervisor's activity — "Director sees all"). Returns a plain number;
 * errors degrade to 0 since the badge must never break navigation.
 */
export async function fetchWorkFeedUnreadCount(userId, sinceIso) {
  if (!userId || !sinceIso) return 0
  const [plans, batches] = await Promise.all([
    supabase
      .from('work_plans')
      .select('id', { count: 'exact', head: true })
      .gt('updated_at', sinceIso)
      .neq('supervisor_id', userId),
    supabase
      .from('today_team_batches')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', sinceIso)
      .neq('supervisor_id', userId),
  ])
  return (plans.count || 0) + (batches.count || 0)
}
