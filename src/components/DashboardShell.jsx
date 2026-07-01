import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, LogOut, X } from 'lucide-react'
import { useAuth } from '../contexts/auth-context'
import { NAV_LINKS } from '../lib/nav'
import { fetchPendingApprovalCounts } from '../lib/approvals'
import { getWorkFeedLastViewed, markWorkFeedViewed, fetchWorkFeedUnreadCount } from '../lib/work-feed'
import NotificationBell from './NotificationBell'
import BottomNav from './BottomNav'

function initials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

export default function DashboardShell({ title, children }) {
  const { profile, user, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const role = profile?.role ?? ''
  const displayName = profile?.full_name ?? user?.email ?? ''
  const isFM = profile?.field_manager === true
  const links = (NAV_LINKS[role] ?? []).filter((item) => !item.fmOnly || isFM)

  const [pendingApprovals, setPendingApprovals] = useState(0)
  useEffect(() => {
    if (role !== 'supervisor' || !isFM) return
    let isMounted = true
    fetchPendingApprovalCounts().then(({ total }) => {
      if (isMounted) setPendingApprovals(total)
    })
    return () => { isMounted = false }
  }, [role, isFM])

  // Bug 2: Work Feed "unread" badge. Only roles with a Work Feed link (Director,
  // Site Incharge) compute it. Like pendingApprovals, this refetches whenever
  // DashboardShell mounts — which happens on every route change — so the count
  // stays fresh without a subscription. On the very first load we seed the
  // baseline to "now" so historical rows don't show a misleading count; opening
  // the feed later re-stamps it (see markWorkFeedViewed in the feed pages).
  const hasWorkFeed = links.some((item) => item.to.endsWith('/work-feed'))
  const [workFeedUnread, setWorkFeedUnread] = useState(0)
  useEffect(() => {
    const userId = user?.id
    if (!hasWorkFeed || !userId) return
    let since = getWorkFeedLastViewed(userId)
    if (!since) {
      markWorkFeedViewed(userId)
      since = new Date().toISOString()
    }
    let isMounted = true
    fetchWorkFeedUnreadCount(userId, since).then((n) => {
      if (isMounted) setWorkFeedUnread(n)
    })
    return () => { isMounted = false }
  }, [hasWorkFeed, user?.id])

  const roleBadge =
    role === 'boss'
      ? { label: 'Director', cls: 'badge-brand' }
      : { label: isFM ? 'Site Incharge' : 'Supervisor', cls: isFM ? 'badge-gold' : 'badge-info' }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]">
      {/* ── Mobile backdrop ─────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0F172A]/40 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar (desktop drawer / mobile slide-over) ─── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-[#0F172A]
          transform transition-transform duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:flex-shrink-0
        `}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10 relative">
          <img src="/logo.png" alt="SASEC" className="h-9 w-9 object-contain flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">SASEC Engineering</p>
            <p className="text-[10px] text-[#64748B] leading-tight truncate mt-0.5">
              Swamy &amp; Sons · Engineers
            </p>
          </div>
          <button
            className="md:hidden ml-auto p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/10 transition"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {links.map((item) => {
            const Icon = item.icon
            // Each badge draws from its own source: Work Feed shows new-feed
            // activity, Approvals shows the pending-review queue. (Previously
            // both fmOnly links reused pendingApprovals, so Work Feed wrongly
            // mirrored the Approvals count.)
            const badgeCount = item.to.endsWith('/work-feed')
              ? workFeedUnread
              : item.to.endsWith('/approvals')
              ? pendingApprovals
              : 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `sidebar-link group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] ${
                    isActive ? 'active' : 'text-[#94A3B8] hover:bg-[#1E293B] hover:text-white'
                  }`
                }
              >
                {Icon && <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.9} />}
                <span className="truncate">{item.label}</span>
                {badgeCount > 0 && (
                  <span className="ml-auto h-5 min-w-[1.25rem] px-1 bg-[#C0272D] text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none flex-shrink-0">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* User + sign out */}
        <div className="border-t border-white/10 px-4 py-4 space-y-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#C0272D] text-xs font-bold text-white uppercase">
              {initials(displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{displayName}</p>
              <span className={`badge ${roleBadge.cls} mt-1 !text-[10px] !px-1.5 !py-0`}>
                {roleBadge.label}
              </span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 text-xs text-[#94A3B8] hover:text-white transition px-2 py-2 rounded-md hover:bg-[#1E293B] min-h-[40px]"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.9} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main column ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-4 bg-white/80 backdrop-blur-xl border-b border-[#E2E8F0] px-4 md:px-6 py-3 flex-shrink-0 z-10">
          <button
            className="md:hidden p-1.5 rounded-md text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="inline-block h-5 w-1 rounded-full bg-[#C0272D] flex-shrink-0" />
            <h1 className="text-base font-bold text-[#0F172A] truncate">{title}</h1>
          </div>

          <NotificationBell />

          <div className="hidden md:flex items-center gap-2 text-right flex-shrink-0">
            <div>
              <p className="text-xs font-semibold text-[#0F172A] leading-tight">{displayName}</p>
              <p className="text-[10px] text-[#94A3B8]">{roleBadge.label}</p>
            </div>
          </div>
        </header>

        {/* Scrollable content — route fade via key */}
        <main className="flex-1 overflow-y-auto">
          <div key={title} className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 pb-24 md:pb-8 animate-fade-in">
            {children}
          </div>

          <footer className="hidden md:block mt-8 py-6 px-6 border-t border-[#E2E8F0]">
            <p className="text-center text-[11px] text-[#94A3B8]">
              SASEC Engineering PVT. LTD. &copy; 2025 &mdash; Confidential
            </p>
          </footer>
        </main>
      </div>

      {/* ── Mobile bottom tab bar ─────────────────────────── */}
      <BottomNav role={role} onMore={() => setSidebarOpen(true)} />
    </div>
  )
}
