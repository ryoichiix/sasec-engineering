import { CheckCircle2, ArrowRightCircle, XCircle, FileText, PhoneCall, IndianRupee, Bell } from 'lucide-react'

// Older notifications are stored with a leading emoji glyph (✅ ❌ etc.) —
// strip it since the colored icon circle now conveys that status.
const LEADING_EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}️]+\s*/u

const BOSS_UI_RE = /\b[Bb]oss\b/g

/** Replace legacy "Boss" wording in user-visible copy (e.g. DB notification text). */
export function formatUiText(text) {
  return (text || '').replace(BOSS_UI_RE, 'Director')
}

export function cleanTitle(title) {
  return formatUiText((title || '').replace(LEADING_EMOJI_RE, ''))
}

const COLORS = {
  emerald: { border: 'border-l-emerald-500', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600' },
  amber:   { border: 'border-l-amber-500',   iconBg: 'bg-amber-50',   iconText: 'text-amber-600' },
  blue:    { border: 'border-l-blue-500',    iconBg: 'bg-blue-50',    iconText: 'text-blue-600' },
  rose:    { border: 'border-l-rose-500',    iconBg: 'bg-rose-50',    iconText: 'text-rose-600' },
  slate:   { border: 'border-l-slate-300',   iconBg: 'bg-slate-100',  iconText: 'text-slate-500' },
}

/**
 * Classify a notification into an icon + color scheme based on its
 * type / title text:
 *  - OT approved / Leave approved      -> CheckCircle2, emerald
 *  - OT forwarded                      -> ArrowRightCircle, amber
 *  - Leave forwarded                   -> ArrowRightCircle, blue
 *  - Leave request                     -> FileText, slate
 *  - Rejected                          -> XCircle, rose
 *  - Callback requested                -> PhoneCall, amber
 *  - Advance                           -> IndianRupee, slate
 *  - Everything else                   -> Bell, slate
 */
export function getNotifMeta(n) {
  const type = n.type || ''
  const text = `${n.title || ''} ${type}`.toLowerCase()

  let scheme
  let Icon

  if (text.includes('reject')) {
    scheme = COLORS.rose
    Icon = XCircle
  } else if (text.includes('callback')) {
    scheme = COLORS.amber
    Icon = PhoneCall
  } else if (text.includes('approve')) {
    scheme = COLORS.emerald
    Icon = CheckCircle2
  } else if (type.startsWith('ot') && (text.includes('forward') || text.includes('pending'))) {
    scheme = COLORS.amber
    Icon = ArrowRightCircle
  } else if (type.startsWith('leave') && text.includes('forward')) {
    scheme = COLORS.blue
    Icon = ArrowRightCircle
  } else if (type.startsWith('leave')) {
    scheme = COLORS.slate
    Icon = FileText
  } else if (type.startsWith('advance')) {
    scheme = COLORS.slate
    Icon = IndianRupee
  } else {
    scheme = COLORS.slate
    Icon = Bell
  }

  return { ...scheme, Icon }
}

/**
 * Decide where a notification should navigate to, based on its type and the
 * viewer's role.
 *
 * - Director (role === 'boss'): every actionable leave/OT/advance review
 *   (request/decision/alert) lives on the single /boss/requests tabbed hub —
 *   that's where LeaveQueue (stage="boss"), OTRequestsContent and
 *   AdvanceRequestsContent actually render. Final-outcome advance
 *   notifications (partial/approved/rejected) are sent BY the director, not
 *   to them, so they fall back to /boss/advances (history) defensively.
 *
 * - Site Incharge (isFieldManager): the FM review queues (LeaveQueue
 *   stage="field_manager", OTRequestsFMContent, AdvanceRequestsFMContent)
 *   are all embedded in the Supervisor dashboard (/supervisor) — there is no
 *   dedicated Site Incharge route — so "needs your review" notifications
 *   route there. Outcome notifications they're cc'd on (advance decided)
 *   route to /supervisor/advances as the closest existing detail page.
 *
 * - Supervisor: leave_/ot_ notifications about their own request route to
 *   the pages that show their own history (/supervisor/leave,
 *   /supervisor/attendance); advance outcomes route to /supervisor/advances.
 */
export function getNotifPath(n, role, isFieldManager = false) {
  const type = n.type || ''
  const isBoss = role === 'boss'

  if (type.startsWith('leave_')) {
    if (isBoss) return '/boss/requests'
    if (isFieldManager) return '/supervisor'
    return '/supervisor/leave'
  }

  if (type.startsWith('ot_')) {
    if (isBoss) return '/boss/requests'
    if (isFieldManager) return '/supervisor'
    return '/supervisor/attendance'
  }

  if (type.startsWith('advance_')) {
    const isOutcome = type === 'advance_partial' || type === 'advance_approved' || type === 'advance_rejected' || type === 'advance_decision'
    if (isBoss) return isOutcome ? '/boss/advances' : '/boss/requests'
    if (isFieldManager) return isOutcome ? '/supervisor/advances' : '/supervisor'
    return '/supervisor/advances'
  }

  if (type.startsWith('work_plan')) {
    if (isBoss) return '/boss/work-feed'
    if (isFieldManager) return '/supervisor/work-feed'
    return '/supervisor/work-plan'
  }

  return isBoss ? '/boss' : '/supervisor'
}

/** Coarse category used by the filter tabs on the "View all" page. */
export function getNotifCategory(n) {
  const type = n.type || ''
  if (type.startsWith('ot_')) return 'ot'
  if (type.startsWith('leave_')) return 'leave'
  if (type.startsWith('advance_')) return 'advance'
  return 'general'
}
