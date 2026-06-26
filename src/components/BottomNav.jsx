import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardCheck, Users, IndianRupee, FileText,
  CalendarOff, MoreHorizontal,
} from 'lucide-react'

/**
 * Mobile bottom tab bar — 5 primary destinations per role.
 * Hidden on md+ (sidebar takes over).
 */
const BOSS_TABS = [
  { to: '/boss',            label: 'Home',     icon: LayoutDashboard, end: true },
  { to: '/boss/attendance', label: 'Attend',   icon: ClipboardCheck },
  { to: '/boss/workers',    label: 'Workers',  icon: Users },
  { to: '/boss/payroll',    label: 'Payroll',  icon: IndianRupee },
  { to: '/boss/more',       label: 'More',     icon: MoreHorizontal },
]

const SUP_TABS = [
  { to: '/supervisor',            label: 'Home',    icon: LayoutDashboard, end: true },
  { to: '/supervisor/attendance', label: 'Attend',  icon: ClipboardCheck },
  { to: '/supervisor/todays-plan',   label: 'Plan',    icon: Users },
  { to: '/supervisor/daily-updates', label: 'Updates', icon: FileText },
  { to: '/supervisor/leave',      label: 'Leave',   icon: CalendarOff },
]

export default function BottomNav({ role, onMore }) {
  const tabs = role === 'boss' ? BOSS_TABS : SUP_TABS

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E2E8F0] flex items-stretch pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => {
        const Icon = t.icon
        const isMore = t.to.endsWith('/more')
        if (isMore) {
          return (
            <button
              key={t.to}
              onClick={onMore}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[#64748B] active:scale-95 transition"
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} />
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          )
        }
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end ?? false}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] transition active:scale-95 ${
                isActive ? 'text-[#C0272D]' : 'text-[#64748B]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="text-[10px] font-medium">{t.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
