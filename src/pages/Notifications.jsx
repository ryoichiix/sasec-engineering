import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../contexts/auth-context'
import { supabase } from '../lib/supabase'
import { fetchAllNotifications, markAllRead, markNotificationRead } from '../lib/notifications'
import { getNotifMeta, getNotifPath, getNotifCategory, cleanTitle, formatUiText } from '../lib/notification-meta'
import { todayLocal, toIST } from '../lib/dates'

const TABS = [
  { key: 'all',      label: 'All' },
  { key: 'ot',       label: 'OT' },
  { key: 'leave',    label: 'Leave' },
  { key: 'advance',  label: 'Advance' },
  { key: 'general',  label: 'General' },
]

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Group notifications into Today / Yesterday / This Week / Earlier sections. */
function groupByDate(items) {
  const today = startOfDay(new Date(todayLocal()))
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - 7)

  const groups = { Today: [], Yesterday: [], 'This Week': [], Earlier: [] }
  for (const n of items) {
    const created = startOfDay(new Date(n.created_at))
    if (created.getTime() === today.getTime()) groups.Today.push(n)
    else if (created.getTime() === yesterday.getTime()) groups.Yesterday.push(n)
    else if (created > weekStart) groups['This Week'].push(n)
    else groups.Earlier.push(n)
  }
  return groups
}

export default function Notifications() {
  const { user, role, profile } = useAuth()
  const isFieldManager = profile?.field_manager === true
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [respondedIds, setRespondedIds] = useState({}) // collab notif id -> 'accepted' | 'declined'

  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    fetchAllNotifications(user.id).then(({ data, error }) => {
      if (!isMounted) return
      if (!error) setItems(data || [])
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [user?.id])

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items])

  const filtered = useMemo(() => {
    if (tab === 'all') return items
    return items.filter((n) => getNotifCategory(n) === tab)
  }, [items, tab])

  const groups = useMemo(() => groupByDate(filtered), [filtered])

  const handleMarkAllRead = () => {
    if (unreadCount === 0) return
    markAllRead(user.id)
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const handleItemClick = (n) => {
    if (!n.is_read) {
      markNotificationRead(n.id)
      setItems((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
      )
    }
    navigate(getNotifPath(n, role, isFieldManager))
  }

  // Accept / Decline a collaboration request straight from the notification.
  const handleCollabResponse = async (n, status) => {
    // Prefer the exact link referenced by the notification; fall back to this
    // user's most recent still-pending request if older notifs lack a ref.
    let collabId = n.reference_id
    if (!collabId) {
      const { data } = await supabase
        .from('work_plan_collaborations')
        .select('id')
        .eq('collaborator_id', user.id)
        .eq('status', 'pending')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      collabId = data?.id
    }
    if (collabId) {
      await supabase
        .from('work_plan_collaborations')
        .update({ status })
        .eq('id', collabId)
    }
    if (!n.is_read) await markNotificationRead(n.id)
    setRespondedIds((p) => ({ ...p, [n.id]: status }))
    setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)))
  }

  return (
    <DashboardShell title="Notifications">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-slate-900">Notifications</h1>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-sm font-medium text-brand hover:text-brand-hover transition"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition ${
                tab === t.key
                  ? 'bg-brand text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="You're all caught up"
              description="No notifications to show here."
            />
          ) : (
            Object.entries(groups).map(([label, list]) =>
              list.length === 0 ? null : (
                <div key={label}>
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {label}
                    </p>
                  </div>
                  <ul>
                    {list.map((n) => {
                      const meta = getNotifMeta(n)
                      const Icon = meta.Icon
                      return (
                        <li key={n.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleItemClick(n)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                handleItemClick(n)
                              }
                            }}
                            className={`w-full text-left flex gap-3 px-4 py-4 border-l-4 ${meta.border} border-b border-slate-100 last:border-b-0 cursor-pointer transition-colors hover:bg-slate-50 ${
                              !n.is_read ? 'bg-[#F8FAFC]' : 'bg-white'
                            }`}
                          >
                            <span
                              className={`flex-shrink-0 mt-0.5 h-10 w-10 rounded-full flex items-center justify-center ${meta.iconBg} ${meta.iconText}`}
                            >
                              <Icon className="w-5 h-5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-bold text-slate-900 leading-snug">
                                  {cleanTitle(n.title)}
                                </p>
                                {!n.is_read && (
                                  <span className="mt-1.5 h-2 w-2 rounded-full bg-brand flex-shrink-0" />
                                )}
                              </div>
                              {n.message && (
                                <p className="text-sm text-slate-500 mt-0.5">{formatUiText(n.message)}</p>
                              )}
                              <p className="text-xs text-slate-400 mt-1.5">
                                {toIST(n.created_at)}
                              </p>

                              {/* Collaboration request — accept / decline inline */}
                              {n.type === 'collaboration_request' && (
                                respondedIds[n.id] ? (
                                  <p className={`mt-2 text-xs font-semibold ${
                                    respondedIds[n.id] === 'accepted' ? 'text-purple-700' : 'text-slate-400'
                                  }`}>
                                    {respondedIds[n.id] === 'accepted' ? '🤝 Accepted' : 'Declined'}
                                  </p>
                                ) : (
                                  <div className="flex gap-2 mt-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleCollabResponse(n, 'accepted') }}
                                      className="px-3 py-1.5 bg-[#0F172A] text-white text-xs font-semibold rounded-lg hover:bg-gray-800"
                                    >
                                      Accept
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleCollabResponse(n, 'declined') }}
                                      className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50"
                                    >
                                      Decline
                                    </button>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            )
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
