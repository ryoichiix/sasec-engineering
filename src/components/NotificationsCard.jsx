import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import { fetchNotifications, markAllRead } from '../lib/notifications'
import { formatDate } from '../lib/dates'
import { formatUiText } from '../lib/notification-meta'

export default function NotificationsCard() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    fetchNotifications(user.id).then(({ data, error }) => {
      if (!isMounted) return
      if (error) {
        console.error('Failed to load notifications', error)
        setError(error.message)
        setItems([])
      } else {
        setItems(data || [])
        // Fire and forget — read state is best-effort.
        markAllRead(user.id).then(({ error: e }) => {
          if (e) console.warn('markAllRead failed', e)
        })
      }
      setLoading(false)
    })
    return () => {
      isMounted = false
    }
  }, [user?.id])

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
        <span className="text-xs text-slate-400">
          {loading ? '' : `${items.length} recent`}
        </span>
      </div>

      {loading ? (
        <div className="px-6 py-6 text-sm text-slate-500">Loading…</div>
      ) : error ? (
        <div className="px-6 py-6 text-sm text-rose-600">{error}</div>
      ) : items.length === 0 ? (
        <div className="px-6 py-6 text-sm text-slate-500">No notifications yet.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.id} className="px-6 py-3 flex gap-3">
              <span
                aria-label={n.is_read ? 'read' : 'unread'}
                className={
                  'mt-1.5 inline-block h-2 w-2 rounded-full flex-shrink-0 ' +
                  (n.is_read ? 'bg-slate-300' : 'bg-rose-500')
                }
              />
              <div className="flex-1 min-w-0">
                {n.title && (
                  <p className="text-sm font-medium text-slate-900">{formatUiText(n.title)}</p>
                )}
                <p className="text-sm text-slate-800">{formatUiText(n.message)}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatDate(n.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
