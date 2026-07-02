import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import AttendanceModeBanner from '../components/AttendanceModeBanner'
import { supabase } from '../lib/supabase'
import StatusPill from '../components/StatusPill'
import { todayLocal, formatDate } from '../lib/dates'

export default function BossAttendance() {
  const [date, setDate] = useState(todayLocal())
  const [supervisors, setSupervisors] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState({}) // worker_id -> status
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true
    Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'supervisor')
        .order('full_name'),
      supabase
        .from('workers')
        .select('id, full_name, supervisor_id')
        .order('full_name'),
    ])
      .then(([sup, wk]) => {
        if (!isMounted) return
        if (sup.error || wk.error) {
          setError((sup.error || wk.error).message)
        } else {
          setSupervisors(sup.data || [])
          setWorkers(wk.data || [])
        }
        setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    ;(async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('worker_table_id, status, marked_by')
        .eq('attendance_date', date)
        .not('worker_table_id', 'is', null)
      if (!isMounted) return
      if (error) {
        console.error('Failed to load attendance', error)
        setAttendance({})
        return
      }
      // Resolve marker names for the "Marked by" label.
      const markerIds = Array.from(new Set((data || []).map((r) => r.marked_by).filter(Boolean)))
      let names = {}
      if (markerIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', markerIds)
        for (const p of profs || []) names[p.id] = p.full_name
      }
      if (!isMounted) return
      const map = {}
      for (const r of data || []) {
        map[r.worker_table_id] = {
          status: r.status,
          marked_by_name: r.marked_by ? (names[r.marked_by] || null) : null,
        }
      }
      setAttendance(map)
    })()
    return () => {
      isMounted = false
    }
  }, [date])

  const groups = useMemo(() => {
    const bySupervisor = new Map()
    for (const s of supervisors) {
      bySupervisor.set(s.id, { supervisor: s, workers: [] })
    }
    const unassigned = []
    for (const w of workers) {
      if (w.supervisor_id && bySupervisor.has(w.supervisor_id)) {
        bySupervisor.get(w.supervisor_id).workers.push(w)
      } else {
        unassigned.push(w)
      }
    }
    const result = Array.from(bySupervisor.values())
    if (unassigned.length) {
      result.push({ supervisor: null, workers: unassigned })
    }
    return result
  }, [supervisors, workers])

  return (
    <DashboardShell title="Attendance Overview" accent="bg-amber-500">
      <AttendanceModeBanner />
      <div className="mb-6 flex items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <p className="text-sm text-slate-500 pb-2">{formatDate(date)}</p>
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500">No supervisors or workers yet.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const marked = g.workers.filter((w) => attendance[w.id]?.status).length
            return (
              <div
                key={g.supervisor?.id ?? 'unassigned'}
                className="bg-white border border-slate-200 rounded-lg"
              >
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {g.supervisor?.full_name ?? 'Unassigned workers'}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {marked} / {g.workers.length} marked
                  </span>
                </div>
                {g.workers.length === 0 ? (
                  <div className="px-6 py-6 text-sm text-slate-500">
                    No workers.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {g.workers.map((w) => {
                      const rec = attendance[w.id]
                      return (
                        <li
                          key={w.id}
                          className="px-6 py-3 flex items-center justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-slate-800 truncate">
                              {w.full_name || 'Unnamed worker'}
                            </p>
                            {rec?.marked_by_name && (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                Marked by: {rec.marked_by_name}
                              </p>
                            )}
                          </div>
                          <StatusPill value={rec?.status} />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </DashboardShell>
  )
}
