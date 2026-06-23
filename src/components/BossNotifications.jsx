import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/auth-context'
import { fetchNotifications, markAllRead } from '../lib/notifications'
import { supabase } from '../lib/supabase'
import { toIST } from '../lib/dates'
import { cleanTitle, formatUiText, getNotifPath } from '../lib/notification-meta'

// ── Category definitions ───────────────────────────────────
//
// Each tab matches a set of notification.type values.
// 'General' is everything that doesn't fit one of the named tabs.

const TABS = [
  {
    id:    'leave',
    label: 'Leave Requests',
    types: ['leave_request', 'leave_decision'],
  },
  {
    id:    'ot',
    label: 'OT Requests',
    types: ['ot_request', 'ot_decision'],
  },
  {
    id:    'advance',
    label: 'Advance Alerts',
    types: ['advance_alert', 'advance_request', 'advance_decision'],
  },
  {
    id:    'general',
    label: 'General Updates',
    types: null, // null => everything not claimed above
  },
]

const ALL_NAMED_TYPES = new Set(
  TABS.filter((t) => t.types).flatMap((t) => t.types)
)

function categoryOf(type) {
  for (const t of TABS) {
    if (t.types && t.types.includes(type)) return t.id
  }
  return 'general'
}

export default function BossNotifications() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('leave')

  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    fetchNotifications(user.id).then(({ data, error: err }) => {
      if (!isMounted) return
      if (err) {
        setError(err.message)
        setItems([])
      } else {
        setItems(data || [])
        setError(null)
      }
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [user?.id])

  // Bucket and unread counts per tab
  const buckets = useMemo(() => {
    const map = { leave: [], ot: [], advance: [], general: [] }
    for (const n of items) {
      const cat = categoryOf(n.type)
      map[cat].push(n)
    }
    return map
  }, [items])

  const unreadCounts = useMemo(() => {
    const m = { leave: 0, ot: 0, advance: 0, general: 0 }
    for (const n of items) {
      if (!n.is_read) m[categoryOf(n.type)] += 1
    }
    return m
  }, [items])

  // Mark all in a tab as read — called from tab clicks and from the
  // initial-load effect. Optimistic UI + best-effort server update.
  const markTabRead = async (tabId) => {
    if (!user?.id) return
    const tab = TABS.find((t) => t.id === tabId)
    const unreadInTab = items.filter(
      (n) => !n.is_read && categoryOf(n.type) === tabId
    )
    if (unreadInTab.length === 0) return
    // Optimistic UI
    setItems((prev) =>
      prev.map((n) =>
        categoryOf(n.type) === tabId ? { ...n, is_read: true } : n
      )
    )
    if (tab?.types) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .in('type', tab.types)
    } else {
      const ids = unreadInTab.map((n) => n.id)
      if (ids.length > 0) {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('id', ids)
      }
    }
  }

  // Tab click handler — switches view AND marks the new tab as read.
  // Read-marking happens here instead of inside an effect so we don't
  // trigger the set-state-in-effect lint rule.
  const switchTab = (id) => {
    setActiveTab(id)
    markTabRead(id)
  }

  // After the first load, mark the *default* active tab as read once.
  // Catches the case where the user lands on the page and never clicks.
  // markTabRead does a setState — that's the intended side effect.
  useEffect(() => {
    if (loading || !user?.id) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    markTabRead(activeTab)
    // Fallback: also clear any never-categorised unread on first load.
    markAllRead(user.id).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id])

  const visibleItems = buckets[activeTab] || []

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-6 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
          {!loading && (
            <span className="text-xs text-slate-400">{items.length} recent</span>
          )}
        </div>
        {/* Tab bar */}
        <div className="flex gap-1 flex-wrap">
          {TABS.map((t) => {
            const active = t.id === activeTab
            const unread = unreadCounts[t.id]
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={
                  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition ' +
                  (active
                    ? 'bg-navy text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                }
              >
                {t.label}
                {unread > 0 && (
                  <span
                    className={
                      'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-[10px] font-bold rounded-full ' +
                      (active
                        ? 'bg-white text-navy'
                        : 'bg-brand text-white')
                    }
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-6 text-sm text-slate-500">Loading…</div>
      ) : error ? (
        <div className="px-6 py-6 text-sm text-rose-600">{error}</div>
      ) : visibleItems.length === 0 ? (
        <div className="px-6 py-8 text-sm text-slate-500 text-center">
          No notifications in this category.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {visibleItems.map((n) => {
              const dest = getNotifPath(n, 'boss', false)
              return (
                <li key={n.id}>
                  <Link
                    to={dest}
                    className="flex gap-3 px-6 py-3 hover:bg-[#FFF1F1] transition-colors cursor-pointer group"
                  >
                    <span
                      aria-label={n.is_read ? 'read' : 'unread'}
                      className={
                        'mt-1.5 inline-block h-2 w-2 rounded-full flex-shrink-0 transition-colors ' +
                        (n.is_read
                          ? 'bg-slate-300 group-hover:bg-[#C0272D]/30'
                          : 'bg-[#C0272D]')
                      }
                    />
                    <div className="flex-1 min-w-0">
                      {n.title && (
                        <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#C0272D] transition-colors">
                          {cleanTitle(n.title)}
                        </p>
                      )}
                      {n.message && (
                        <p className="text-sm text-[#475569]">{formatUiText(n.message)}</p>
                      )}
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        {toIST(n.created_at)}
                      </p>
                    </div>
                    <span className="self-center text-[#C0272D] opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium flex-shrink-0">
                      →
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* View all footer */}
          {(activeTab === 'leave' || activeTab === 'ot') && (
            <div className="px-6 py-3 border-t border-[#F1F5F9]">
              <Link
                to="/boss/requests"
                className="text-xs font-semibold text-[#C0272D] hover:text-[#A01E23] transition-colors flex items-center gap-1"
              >
                View all requests →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Re-export so other code that wants the full type→tab mapping can use it.
// eslint-disable-next-line react-refresh/only-export-components
export { TABS as BOSS_NOTIFICATION_TABS, ALL_NAMED_TYPES, categoryOf }
