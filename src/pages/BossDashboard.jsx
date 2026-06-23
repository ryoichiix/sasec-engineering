import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  UserCheck, UserX, AlertTriangle, IndianRupee, Users2,
  ClipboardCheck, CalendarOff, Clock, FileText, Receipt,
  ArrowRight,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import DashboardShell from '../components/DashboardShell'
import StatCard from '../components/StatCard'
import { SkeletonStatCard, Skeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import AdvanceSummaryCard from '../components/AdvanceSummaryCard'
import BossNotifications from '../components/BossNotifications'
import { useAuth } from '../contexts/auth-context'
import { supabase } from '../lib/supabase'
import { todayLocal } from '../lib/dates'
import { monthRange, formatCurrency, computePayroll } from '../lib/payroll'
import { fetchWeeklyAdvancesInPeriod } from '../lib/advances'
import { checkVehicleExpiry } from '../lib/vehicles'

const C = { brand: '#C0272D', success: '#10B981', warning: '#F59E0B', error: '#EF4444', gold: '#D97706', info: '#3B82F6' }

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function todayPretty() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function lastNDates(n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export default function BossDashboard() {
  const { profile, user } = useAuth()
  const firstName = (profile?.full_name || user?.email || 'Director').split(' ')[0]
  const today = todayLocal()
  const month = useMemo(() => monthRange(today), [today])

  const [stats, setStats] = useState(null)
  const [trend, setTrend] = useState([])
  const [teams, setTeams] = useState([])
  const [payroll, setPayroll] = useState(null)
  const [totalWorkers, setTotalWorkers] = useState(0)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingTrend, setLoadingTrend] = useState(true)
  const [loadingTeams, setLoadingTeams] = useState(true)
  const [loadingPayroll, setLoadingPayroll] = useState(true)

  // ── Today KPIs + worker count ──────────────────────────
  useEffect(() => {
    let m = true
    Promise.all([
      supabase.from('attendance').select('status').eq('attendance_date', today),
      supabase.from('leave_requests').select('id', { count: 'exact', head: true })
        .in('status', ['pending_field_manager', 'pending_boss', 'callback_requested']),
      supabase.from('attendance').select('id', { count: 'exact', head: true }).in('ot_status', ['pending', 'pending_boss']),
      supabase.from('workers').select('id', { count: 'exact', head: true }),
      supabase.from('weekly_advances').select('id', { count: 'exact', head: true }).eq('advance_status', 'pending_boss'),
    ]).then(([att, leave, ot, wk, adv]) => {
      if (!m) return
      const rows = att.data || []
      setStats({
        present: rows.filter((r) => r.status === 'present').length,
        half:    rows.filter((r) => r.status === 'half_day').length,
        absent:  rows.filter((r) => r.status === 'absent').length,
        pending: (leave.count || 0) + (ot.count || 0) + (adv.count || 0),
      })
      setTotalWorkers(wk.count || 0)
      setLoadingStats(false)
    })
    return () => { m = false }
  }, [today])

  // ── 7-day attendance trend ─────────────────────────────
  useEffect(() => {
    let m = true
    const dates = lastNDates(7)
    supabase
      .from('attendance')
      .select('attendance_date, status')
      .gte('attendance_date', dates[0])
      .lte('attendance_date', dates[6])
      .then(({ data }) => {
        if (!m) return
        const byDate = {}
        for (const d of dates) byDate[d] = 0
        for (const r of data || []) {
          if (r.status === 'present' || r.status === 'half_day') {
            byDate[r.attendance_date] = (byDate[r.attendance_date] || 0) + 1
          }
        }
        setTrend(dates.map((d) => ({
          day: new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }),
          present: byDate[d] || 0,
          isToday: d === today,
        })))
        setLoadingTrend(false)
      })
    return () => { m = false }
  }, [today])

  // ── Today's teams ──────────────────────────────────────
  useEffect(() => {
    let m = true
    supabase.from('daily_assignments').select('supervisor_id, worker_table_id')
      .eq('assignment_date', today)
      .then(async ({ data }) => {
        if (!m) return
        const bySup = new Map()
        for (const r of data || []) bySup.set(r.supervisor_id, (bySup.get(r.supervisor_id) || 0) + 1)
        const ids = Array.from(bySup.keys())
        let names = {}
        if (ids.length) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
          for (const p of profs || []) names[p.id] = p.full_name
        }
        if (!m) return
        setTeams(ids.map((id) => ({ id, name: names[id] || 'Supervisor', count: bySup.get(id) })).sort((a, b) => b.count - a.count))
        setLoadingTeams(false)
      })
    return () => { m = false }
  }, [today])

  // ── Payroll actual vs expected ─────────────────────────
  useEffect(() => {
    let m = true
    Promise.all([
      supabase.from('workers').select('id, individual_wage, wage_type'),
      supabase.from('attendance').select('worker_table_id, attendance_date, status, ot_hours, ot_status')
        .gte('attendance_date', month.start).lte('attendance_date', month.end),
      fetchWeeklyAdvancesInPeriod(month.start, month.end),
    ]).then(([wk, att, adv]) => {
      if (!m) return
      const workers = wk.data || []
      const advBy = {}
      for (const a of adv.data || []) advBy[a.worker_table_id] = (advBy[a.worker_table_id] || 0) + Number(a.amount)
      const byWorker = new Map()
      for (const a of att.data || []) {
        if (!byWorker.has(a.worker_table_id)) byWorker.set(a.worker_table_id, { attendance: {}, ot: {}, otStatus: {} })
        const e = byWorker.get(a.worker_table_id)
        e.attendance[a.attendance_date] = a.status
        const oth = Number(a.ot_hours) || 0
        if (oth > 0) { e.ot[a.attendance_date] = oth; e.otStatus[a.attendance_date] = a.ot_status ?? null }
      }
      const daysInMonth = new Date(new Date(month.start).getFullYear(), new Date(month.start).getMonth() + 1, 0).getDate()
      let actual = 0, expected = 0
      for (const w of workers) {
        const rate = Number(w.individual_wage) || 0
        const wt = w.wage_type ?? 'daily_rate'
        const d = byWorker.get(w.id) ?? { attendance: {}, ot: {}, otStatus: {} }
        actual += computePayroll({ dailyRate: rate, wageType: wt, attendanceByDate: d.attendance, otByDate: d.ot, otStatusByDate: d.otStatus, mode: 'monthly', advanceDeduction: advBy[w.id] || 0 }).net
        const exp = {}
        const s = new Date(month.start)
        for (let i = 0; i < daysInMonth; i++) exp[new Date(s.getFullYear(), s.getMonth(), i + 1).toISOString().slice(0, 10)] = 'present'
        expected += computePayroll({ dailyRate: rate, wageType: wt, attendanceByDate: exp, otByDate: {}, otStatusByDate: {}, mode: 'monthly', advanceDeduction: 0 }).net
      }
      setPayroll({ actual, expected })
      setLoadingPayroll(false)
    })
    return () => { m = false }
  }, [month.start, month.end])

  // ── Vehicle document-expiry notifications (once per day per login) ──
  useEffect(() => {
    if (!user?.id) return
    checkVehicleExpiry(user.id)
  }, [user?.id])

  const payrollPct = payroll && payroll.expected > 0 ? Math.min(100, Math.round((payroll.actual / payroll.expected) * 100)) : 0

  return (
    <DashboardShell title="Dashboard">
      {/* Greeting */}
      <div className="mb-7 animate-fade-in-up">
        <h2 className="text-2xl font-bold text-[#0F172A]">
          {greeting()}, {firstName}
        </h2>
        <p className="text-sm text-[#64748B] mt-1">{todayPretty()}</p>
      </div>

      {/* Row 1 — KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loadingStats || loadingPayroll ? (
          <><SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard /></>
        ) : (
          <>
            <StatCard icon={UserCheck} label="Present today"      value={stats.present}   tone="success" sublabel={`of ${totalWorkers} workers`}              delay={0}   href="/boss/attendance" />
            <StatCard icon={UserX}     label="Absent today"       value={stats.absent}    tone="error"   sublabel={stats.absent > 0 ? 'need attention' : 'all clear'} delay={50}  href="/boss/attendance" />
            <StatCard icon={AlertTriangle} label="Pending approvals" value={stats.pending} tone="warning" sublabel="leave + OT + advance"                               delay={100} href="/boss/requests"   />
            <StatCard icon={IndianRupee} label="Monthly payroll"  value={payroll.actual}  tone="gold"    prefix="₹" sublabel="estimated net"                          delay={150} href="/boss/payroll"    />
          </>
        )}
      </div>

      {/* Row 2 — Trend chart + Teams */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card p-5 stagger" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-[#0F172A]">Attendance trend</h3>
              <p className="text-xs text-[#64748B] mt-0.5">Workers present · last 7 days</p>
            </div>
            <Link to="/boss/attendance" className="text-xs text-[#C0272D] hover:text-[#A01E23] font-semibold flex items-center gap-1">
              View <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loadingTrend ? <Skeleton className="h-56 w-full" /> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    contentStyle={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(15,23,42,0.08)' }}
                  />
                  <Bar dataKey="present" radius={[6, 6, 0, 0]} maxBarSize={40}>
                    {trend.map((d, i) => <Cell key={i} fill={d.isToday ? C.brand : '#FCA5A5'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-5 stagger" style={{ animationDelay: '250ms' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-[#0F172A]">Today's teams</h3>
            <Link to="/boss/assignments" className="text-xs text-[#C0272D] hover:text-[#A01E23] font-semibold flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loadingTeams ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : teams.length === 0 ? (
            <EmptyState icon={Users2} title="No teams yet" description="No supervisor has picked workers today." />
          ) : (
            <ul className="space-y-2 max-h-56 overflow-y-auto scrollbar-hide">
              {teams.map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[#F8FAFC] transition">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF1F1] text-[#C0272D] text-xs font-bold flex-shrink-0">
                    {t.name[0]?.toUpperCase()}
                  </span>
                  <p className="text-sm font-medium text-[#0F172A] truncate flex-1">{t.name}</p>
                  <span className="text-sm font-bold text-[#0F172A] num tabular-nums">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Row 3 — Payroll breakdown + Advance summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5 stagger" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-[#0F172A]">Payroll this month</h3>
            <IndianRupee className="h-4 w-4 text-[#D97706]" strokeWidth={2} />
          </div>
          {loadingPayroll ? (
            <><Skeleton className="h-8 w-32 mb-4" /><Skeleton className="h-2 w-full mb-2" /><Skeleton className="h-3 w-24" /></>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-wide text-[#64748B] mb-1">Actual so far</p>
              <p className="text-2xl font-bold text-money num tabular-nums">{formatCurrency(payroll.actual)}</p>
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-[#F1F5F9] overflow-hidden">
                  <div className="h-full bg-[#D97706] rounded-full transition-all duration-1000" style={{ width: `${payrollPct}%` }} />
                </div>
                <div className="flex justify-between items-baseline mt-2">
                  <span className="text-[10px] text-[#94A3B8] uppercase tracking-wide">Expected (full attendance)</span>
                  <span className="text-xs font-semibold text-[#475569] num tabular-nums">{formatCurrency(payroll.expected)}</span>
                </div>
              </div>
              <Link to="/boss/payroll" className="mt-4 inline-flex items-center gap-1 text-xs text-[#C0272D] hover:text-[#A01E23] font-semibold">
                Open payroll <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          )}
        </div>

        <div className="stagger" style={{ animationDelay: '350ms' }}>
          <AdvanceSummaryCard />
        </div>
      </div>

      {/* Row 4 — Quick actions */}
      <div className="mb-6 stagger" style={{ animationDelay: '400ms' }}>
        <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Quick actions</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <QuickAction to="/boss/attendance" icon={ClipboardCheck} label="Attendance" />
          <QuickAction to="/boss/leave" icon={CalendarOff} label="Leave" />
          <QuickAction to="/boss/ot-requests" icon={Clock} label="OT" />
          <QuickAction to="/boss/payroll" icon={IndianRupee} label="Payroll" />
          <QuickAction to="/boss/work-feed" icon={FileText} label="Work feed" />
          <QuickAction to="/boss/expenses" icon={Receipt} label="Expenses" />
        </div>
      </div>

      {/* Notifications */}
      <div className="stagger" style={{ animationDelay: '450ms' }}>
        <BossNotifications />
      </div>
    </DashboardShell>
  )
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <Link to={to} className="card card-hover p-4 flex flex-col items-center gap-2 text-center group min-h-[88px] justify-center">
      <div className="h-9 w-9 rounded-lg bg-[#F8FAFC] flex items-center justify-center group-hover:bg-[#FFF1F1] transition">
        <Icon className="h-4 w-4 text-[#64748B] group-hover:text-[#C0272D] transition" strokeWidth={1.9} />
      </div>
      <p className="text-xs font-semibold text-[#0F172A]">{label}</p>
    </Link>
  )
}
