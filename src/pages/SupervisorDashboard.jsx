import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, FileText, Users, FileCheck2,
  CheckCircle2, Circle, ChevronRight,
} from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import { Skeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/auth-context'
import { supabase } from '../lib/supabase'
import { todayLocal } from '../lib/dates'
import { fetchMyAssignmentsForDate } from '../lib/assignments'
import { fetchPendingApprovalCounts } from '../lib/approvals'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  return 'Evening'
}
function todayPretty() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function SupervisorDashboard() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const isFM = profile?.field_manager === true
  const today = todayLocal()

  const [tasks, setTasks] = useState(null)
  const [team, setTeam] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [loadingTeam, setLoadingTeam] = useState(true)

  // Site Incharge approval-queue summary (full queues live on /supervisor/approvals).
  const [pendingApprovals, setPendingApprovals] = useState(0)
  useEffect(() => {
    if (!isFM) return
    let m = true
    fetchPendingApprovalCounts().then(({ total }) => {
      if (m) setPendingApprovals(total)
    })
    return () => { m = false }
  }, [isFM])

  // ── Task completion status ─────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    let m = true
    Promise.all([
      supabase.from('attendance').select('id', { count: 'exact', head: true })
        .eq('supervisor_id', user.id).eq('attendance_date', today),
      fetchMyAssignmentsForDate(user.id, today),
      supabase.from('work_updates').select('id', { count: 'exact', head: true })
        .eq('supervisor_id', user.id).eq('update_date', today),
      supabase.from('evening_reports').select('id', { count: 'exact', head: true })
        .eq('supervisor_id', user.id).eq('report_date', today),
    ]).then(([att, asn, upd, rep]) => {
      if (!m) return
      setTasks({
        attendance: (att.count || 0) > 0,
        team:       (asn.data || []).length > 0,
        morning:    (upd.count || 0) > 0,
        evening:    (rep.count || 0) > 0,
      })
      setLoadingTasks(false)
    })
    return () => { m = false }
  }, [user?.id, today])

  // ── My team today ──────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    let m = true
    fetchMyAssignmentsForDate(user.id, today).then(async ({ data }) => {
      if (!m) return
      const ids = (data || []).map((a) => a.worker_id || a.worker_table_id).filter(Boolean)
      if (!ids.length) { setTeam([]); setLoadingTeam(false); return }
      const { data: workers } = await supabase.from('workers').select('id, full_name').in('id', ids).order('full_name')
      if (!m) return
      setTeam(workers || [])
      setLoadingTeam(false)
    })
    return () => { m = false }
  }, [user?.id, today])

  const taskList = tasks ? [
    { key: 'attendance', label: 'Mark attendance', desc: 'Record present / absent / half day', icon: ClipboardCheck, to: '/supervisor/attendance', done: tasks.attendance },
    { key: 'morning',    label: 'Post morning update', desc: "Share today's work plan", icon: FileText, to: '/supervisor/todays-plan', done: tasks.morning },
    { key: 'team',       label: 'Pick your team', desc: 'Select present workers for your crew', icon: Users, to: '/supervisor/todays-plan', done: tasks.team },
    { key: 'evening',    label: 'Submit EOD report', desc: 'Log completed & pending work', icon: FileCheck2, to: '/supervisor/daily-updates', done: tasks.evening },
  ] : []

  const doneCount = taskList.filter((t) => t.done).length

  return (
    <DashboardShell title="Dashboard">
      {/* Header */}
      <div className="mb-6 animate-fade-in-up flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-[#0F172A]">Today's tasks</h2>
            <span className="badge badge-neutral">{greeting()}</span>
          </div>
          <p className="text-sm text-[#64748B] mt-1">{todayPretty()}</p>
        </div>
        {!loadingTasks && (
          <div className="text-right">
            <p className="text-2xl font-bold text-[#0F172A] num">{doneCount}<span className="text-[#94A3B8] text-lg">/4</span></p>
            <p className="text-xs text-[#64748B]">tasks done</p>
          </div>
        )}
      </div>

      {/* Task checklist — primary daily actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {loadingTasks
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)
          : taskList.map((t, i) => {
              const Icon = t.icon
              return (
                <Link
                  key={t.key}
                  to={t.to}
                  className="group relative bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4 stagger min-h-[92px] shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${t.done ? 'bg-[#FFF1F1]' : 'bg-[#F8FAFC]'} transition`}>
                    <Icon className={`h-5 w-5 ${t.done ? 'text-[#C0272D]' : 'text-[#475569]'}`} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[#0F172A] tracking-tight">{t.label}</p>
                    <p className="text-xs text-[#64748B] mt-1 truncate">{t.desc}</p>
                  </div>
                  {t.done ? (
                    <CheckCircle2 className="h-6 w-6 text-[#C0272D] flex-shrink-0" strokeWidth={2.2} />
                  ) : (
                    <Circle className="h-6 w-6 text-[#CBD5E1] group-hover:text-[#94A3B8] flex-shrink-0 transition" strokeWidth={1.8} />
                  )}
                </Link>
              )
            })}
      </div>

      {/* My team today */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-8 stagger" style={{ animationDelay: '220ms' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[#0F172A] tracking-tight">My team today</h3>
          <Link to="/supervisor/todays-plan" className="text-xs text-[#C0272D] hover:text-[#A01E23] font-semibold flex items-center gap-1">
            Edit <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {loadingTeam ? (
          <div className="flex gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />)}</div>
        ) : team.length === 0 ? (
          <p className="text-sm text-[#64748B] py-2">No workers picked yet. Tap "Pick your team" above.</p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {team.map((w) => (
              <span key={w.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F1F5F9] text-sm font-medium text-[#334155]">
                <span className="h-5 w-5 rounded-full bg-[#C0272D] text-white text-[10px] font-bold flex items-center justify-center">
                  {w.full_name?.[0]?.toUpperCase()}
                </span>
                {w.full_name || 'Unnamed'}
              </span>
            ))}
            <span className="inline-flex items-center text-xs text-[#94A3B8] px-2">{team.length} total</span>
          </div>
        )}
      </div>

      {/* Site Incharge approval summary — full queues live on /supervisor/approvals */}
      {isFM && (
        <div
          onClick={() => navigate('/supervisor/approvals')}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow animate-fade-in-up"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Pending Approvals</p>
              <p className="text-2xl font-bold text-gray-900">{pendingApprovals}</p>
              <p className="text-sm text-gray-400 mt-1">items awaiting your review</p>
            </div>
            {pendingApprovals > 0 && (
              <div className="w-12 h-12 bg-[#C0272D] rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-lg">{pendingApprovals}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  )
}
