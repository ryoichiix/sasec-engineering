import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '../contexts/auth-context'
import { fetchNotifications, markAllRead, markNotificationRead } from '../lib/notifications'
import { getNotifMeta, getNotifPath, cleanTitle, formatUiText } from '../lib/notification-meta'

const VISIBLE_LIMIT = 10

export default function NotificationBell() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread]               = useState(0)
  const [open, setOpen]                   = useState(false)
  const dropRef = useRef(null)

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const load = useCallback(() => {
    if (!user?.id) return
    fetchNotifications(user.id).then(({ data }) => {
      const notifs = data || []
      setNotifications(notifs)
      setUnread(notifs.filter((n) => !n.is_read).length)
    })
  }, [user?.id])

  // Initial load + poll every 30 s for new notifications
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  // Click outside closes dropdown
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => setOpen((prev) => !prev)

  const handleMarkAllRead = () => {
    if (unread === 0) return
    markAllRead(user.id)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnread(0)
  }

  const handleItemClick = (n) => {
    if (!n.is_read) {
      markNotificationRead(n.id)
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
      )
      setUnread((prev) => Math.max(0, prev - 1))
    }
    setOpen(false)
    navigate(getNotifPath(n, role))
  }

  const visible = notifications.slice(0, VISIBLE_LIMIT)
  const hasMore = notifications.length > VISIBLE_LIMIT

  return (
    <div className="relative" ref={dropRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className="relative p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
        aria-label="Notifications"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[1rem] px-0.5 bg-brand text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 origin-top-right animate-dropdown-in">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            {unread > 0 ? (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-brand hover:text-brand-hover transition"
              >
                Mark all as read
              </button>
            ) : (
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-slate-600">You're all caught up</p>
              <p className="text-xs text-slate-400 mt-0.5">No new notifications</p>
            </div>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {visible.map((n) => {
                const meta = getNotifMeta(n)
                const Icon = meta.Icon
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => handleItemClick(n)}
                      className={`w-full text-left flex gap-2.5 px-3 py-3 border-l-4 ${meta.border} border-b border-slate-100 last:border-b-0 cursor-pointer transition-colors hover:bg-slate-100 ${
                        !n.is_read ? 'bg-[#F8FAFC]' : 'bg-white'
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center ${meta.iconBg} ${meta.iconText}`}
                      >
                        <Icon className="w-4 h-4" />
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
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                            {formatUiText(n.message)}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1">
                          {new Date(n.created_at).toLocaleString(undefined, {
                            day:    'numeric',
                            month:  'short',
                            hour:   '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {hasMore && (
            <div className="px-4 py-2.5 border-t border-slate-100 text-center">
              <button
                onClick={() => {
                  setOpen(false)
                  navigate('/notifications')
                }}
                className="text-xs font-medium text-brand hover:text-brand-hover transition"
              >
                View all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="w-5 h-5"
    >
      <path
        fillRule="evenodd"
        d="M10 2a6 6 0 0 0-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 0 0 .515 1.076 32.91 32.91 0 0 0 3.256.508 3.5 3.5 0 0 0 6.972 0 32.903 32.903 0 0 0 3.256-.508.75.75 0 0 0 .515-1.076A11.448 11.448 0 0 1 16 8a6 6 0 0 0-6-6ZM8.05 14.943a33.54 33.54 0 0 0 3.9 0 2 2 0 0 1-3.9 0Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
