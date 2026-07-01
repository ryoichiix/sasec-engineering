import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import DashboardShell from '../../components/DashboardShell'
import AttachmentList from '../../components/AttachmentList'
import BatchTeamList from '../../components/BatchTeamList'
import {
  fetchAllUpdatesRange,
  fetchAllEveningReportsRange,
  fetchAttachmentsByUpdateIds,
} from '../../lib/work-updates'
import { fetchSiteReportsRange } from '../../lib/work-plans'
import { fetchAssignmentsRange } from '../../lib/assignments'
import { fetchBatchesRange } from '../../lib/batches'
import { fetchCollaborationsRange, buildCollabMap, buildAcceptedMerges } from '../../lib/collaborations'
import { markWorkFeedViewed } from '../../lib/work-feed'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateTime } from '../../lib/dates'
import { useAuth } from '../../contexts/auth-context'

const DAYS_BACK = 30

function to12hr(time24) {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const roleLabel = (role) =>
  ({ supervisor: 'Supervisor', boss: 'Director', field_manager: 'Field Manager' })[role] || 'Supervisor'

// Dedupe a merged team list by worker id (collaborating supervisors share a pool).
function dedupeTeam(list) {
  const seen = new Set()
  const out = []
  for (const w of list) {
    if (!w || seen.has(w.id)) continue
    seen.add(w.id)
    out.push(w)
  }
  return out
}

export default function SiteInchargeWorkFeed() {
  const { profile, user } = useAuth()
  const isFM = profile?.field_manager === true
  const [tab, setTab] = useState('updates') // 'updates' | 'reports'

  // Bug 2: opening the feed marks everything up to now as "seen", resetting the
  // sidebar unread badge on the next render.
  useEffect(() => {
    if (user?.id) markWorkFeedViewed(user.id)
  }, [user?.id])

  // Not a Site Incharge — this page has nothing to show them.
  if (profile && !isFM) return <Navigate to="/supervisor" replace />

  return (
    <DashboardShell title="Work Feed" accent="bg-amber-500">
      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        <TabButton active={tab === 'updates'} onClick={() => setTab('updates')}>
          Daily updates
        </TabButton>
        <TabButton active={tab === 'reports'} onClick={() => setTab('reports')}>
          EOD Reports
        </TabButton>
      </div>

      {tab === 'updates' ? <UpdatesFeed /> : <ReportsFeed />}
    </DashboardShell>
  )
}

// ── Daily Updates tab ──────────────────────────────────────

function UpdatesFeed() {
  const [updates, setUpdates] = useState([])
  const [attsByUpdateId, setAttsByUpdateId] = useState({})
  const [supervisorMeta, setSupervisorMeta] = useState({}) // id -> { name, role }
  const [plansByKey, setPlansByKey] = useState({})         // `${date}|${supId}` -> report
  const [teamsByKey, setTeamsByKey] = useState({})         // `${date}|${supId}` -> [{ id, name, designation }]
  const [batchesByKey, setBatchesByKey] = useState({})     // `${date}|${supId}` -> [batch, …]
  const [collabMap, setCollabMap] = useState({})           // `${date}|${supId}` -> [{ name, status }]
  const [mergePrimary, setMergePrimary] = useState({})     // `${date}|${initiatorId}` -> collaboratorId (accepted)
  const [mergeSecondary, setMergeSecondary] = useState({}) // `${date}|${collaboratorId}` -> initiatorId (accepted)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null) // { supId, name, role, date }

  useEffect(() => {
    let isMounted = true
    ;(async () => {
      const [updRes, planRes, asnRes, batchRes, collabRes] = await Promise.all([
        fetchAllUpdatesRange(DAYS_BACK),
        fetchSiteReportsRange(DAYS_BACK),
        fetchAssignmentsRange(DAYS_BACK),
        fetchBatchesRange(DAYS_BACK),
        fetchCollaborationsRange(DAYS_BACK),
      ])
      if (!isMounted) return
      if (updRes.error) { setError(updRes.error.message); setLoading(false); return }

      const updateList = updRes.data || []
      const planList   = planRes.data || []
      const asnList    = asnRes.data || []
      const batchList  = batchRes.data || []
      const collabRows = collabRes.data || []
      setUpdates(updateList)

      // Fix 3: accepted-pair maps so collaborating supervisors render as ONE card.
      const merges = buildAcceptedMerges(collabRows)
      setMergePrimary(merges.primaryByKey)
      setMergeSecondary(merges.secondaryByKey)

      // Structured plans keyed by date|supervisor
      const planMap = {}
      for (const p of planList) planMap[`${p.plan_date}|${p.supervisor_id}`] = p.report
      setPlansByKey(planMap)

      // Batch-Mode teams keyed by date|supervisor
      const batchMap = {}
      for (const b of batchList) {
        const key = `${b.date}|${b.supervisor_id}`
        if (!batchMap[key]) batchMap[key] = []
        batchMap[key].push(b)
      }
      setBatchesByKey(batchMap)

      // Resolve worker names + designations for all assignments in one query
      const workerIds = [...new Set(asnList.map((a) => a.worker_id || a.worker_table_id).filter(Boolean))]
      let workersById = {}
      if (workerIds.length) {
        const { data: workers } = await supabase
          .from('workers')
          .select('id, full_name, designation_id, designations(name)')
          .in('id', workerIds)
        if (!isMounted) return
        for (const w of workers || []) {
          workersById[w.id] = { id: w.id, name: w.full_name || 'Unnamed', designation: w.designations?.name || '' }
        }
      }
      const teamMap = {}
      for (const a of asnList) {
        const wid = a.worker_id || a.worker_table_id
        const w = workersById[wid]
        if (!w) continue
        const key = `${a.assignment_date}|${a.supervisor_id}`
        if (!teamMap[key]) teamMap[key] = []
        teamMap[key].push(w)
      }
      setTeamsByKey(teamMap)

      // Supervisor names + roles for everyone who has updates OR a plan
      const supIds = [...new Set([
        ...updateList.map((u) => u.supervisor_id),
        ...planList.map((p) => p.supervisor_id),
        ...batchList.map((b) => b.supervisor_id),
        ...collabRows.map((c) => c.initiator_id),
        ...collabRows.map((c) => c.collaborator_id),
      ])]
      if (supIds.length) {
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name, role').in('id', supIds)
        if (!isMounted) return
        const map = {}
        const namesById = {}
        for (const p of profiles || []) {
          map[p.id] = { name: p.full_name || 'Unnamed supervisor', role: p.role }
          namesById[p.id] = p.full_name || 'Supervisor'
        }
        setSupervisorMeta(map)
        setCollabMap(buildCollabMap(collabRows, namesById))
      }

      // Attachments for update previews + drawer
      if (updateList.length) {
        const { data: atts } = await fetchAttachmentsByUpdateIds(updateList.map((u) => u.id))
        if (!isMounted) return
        const map = {}
        for (const a of atts || []) {
          if (!map[a.update_id]) map[a.update_id] = []
          map[a.update_id].push(a)
        }
        setAttsByUpdateId(map)
      }

      setError(null)
      setLoading(false)
    })()
    return () => { isMounted = false }
  }, [])

  // Fix A: live-update merged plan cards when any work plan changes (e.g. a
  // collaborator edits the shared canonical plan). Only the plans map needs
  // refreshing — teams/updates are unaffected by a plan edit. Requires
  // work_plans in the realtime publication (migration 48-work-plans-realtime.sql).
  useEffect(() => {
    const channel = supabase
      .channel('si-feed-work-plans')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'work_plans' },
        async () => {
          const { data: plans } = await fetchSiteReportsRange(DAYS_BACK)
          const planMap = {}
          for (const p of plans || []) planMap[`${p.plan_date}|${p.supervisor_id}`] = p.report
          setPlansByKey(planMap)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Group by date → supervisor (union of those with updates or a plan)
  const groups = useMemo(() => {
    const byDate = new Map()
    const ensure = (date, supId) => {
      if (!byDate.has(date)) byDate.set(date, new Map())
      const bySup = byDate.get(date)
      if (!bySup.has(supId)) bySup.set(supId, [])
      return bySup.get(supId)
    }
    for (const u of updates) ensure(u.update_date, u.supervisor_id).push(u)
    // Make sure supervisors with a plan but no updates still get a card
    for (const key of Object.keys(plansByKey)) {
      const [date, supId] = key.split('|')
      ensure(date, supId)
    }
    // …and supervisors who only submitted Batch-Mode teams
    for (const key of Object.keys(batchesByKey)) {
      const [date, supId] = key.split('|')
      ensure(date, supId)
    }
    // Fix 3: ensure each accepted pair's primary (initiator) has a card to host the merge.
    for (const key of Object.keys(mergePrimary)) {
      const [date, supId] = key.split('|')
      ensure(date, supId)
    }

    const out = []
    for (const [date, bySup] of byDate) {
      const supervisors = []
      for (const [supId, supUpdates] of bySup) {
        // Fix 3: the secondary (collaborator) is folded into the primary's merged card.
        if (mergeSecondary[`${date}|${supId}`]) continue
        supUpdates.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        supervisors.push({ supId, updates: supUpdates })
      }
      supervisors.sort((a, b) =>
        (supervisorMeta[a.supId]?.name || '').toLowerCase()
          .localeCompare((supervisorMeta[b.supId]?.name || '').toLowerCase()))
      out.push({ date, supervisors })
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1))
    return out
  }, [updates, plansByKey, batchesByKey, supervisorMeta, mergePrimary, mergeSecondary])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!groups.length) {
    return (
      <p className="text-sm text-slate-500">No work plans or updates in the last {DAYS_BACK} days.</p>
    )
  }

  return (
    <>
      {groups.map((g) => {
        const totalUpdates = g.supervisors.reduce((s, sv) => s + sv.updates.length, 0)
        return (
          <section key={g.date}>
            <div className="flex items-center gap-4 mb-5 mt-8 first:mt-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-gray-900">{formatDate(g.date)}</h2>
                <span className="text-xs text-gray-400">{g.supervisors.length} supervisor{g.supervisors.length !== 1 ? 's' : ''} · {totalUpdates} update{totalUpdates !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
            {g.supervisors.map(({ supId, updates: supUpdates }) => {
              const meta = supervisorMeta[supId] || {}
              const key = `${g.date}|${supId}`

              // Fix 3: merge an accepted collaboration partner into this (primary) card.
              const partnerSupId = mergePrimary[key] || null
              const partnerKey = partnerSupId ? `${g.date}|${partnerSupId}` : null
              const partnerName = partnerSupId ? (supervisorMeta[partnerSupId]?.name || 'Supervisor') : null
              const team = partnerKey
                ? dedupeTeam([...(teamsByKey[key] || []), ...(teamsByKey[partnerKey] || [])])
                : (teamsByKey[key] || [])
              const cardUpdates = partnerSupId
                ? [...supUpdates, ...updates.filter((u) => u.update_date === g.date && u.supervisor_id === partnerSupId)]
                    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                : supUpdates

              return (
                <SupervisorCard
                  key={supId}
                  name={meta.name || 'Unnamed supervisor'}
                  partnerName={partnerName}
                  role={roleLabel(meta.role)}
                  report={plansByKey[key] || null}
                  team={team}
                  batches={batchesByKey[key] || []}
                  collaboration={partnerSupId ? [] : (collabMap[key] || [])}
                  updates={cardUpdates}
                  attsByUpdateId={attsByUpdateId}
                  onViewFull={() => setDetail({
                    supId,
                    name: meta.name || 'Unnamed supervisor',
                    role: roleLabel(meta.role),
                    date: g.date,
                    partnerSupId,
                    partnerName,
                  })}
                />
              )
            })}
          </section>
        )
      })}
      <p className="text-xs text-gray-400 text-center pt-2">Showing the last {DAYS_BACK} days.</p>

      {detail && (
        <DetailDrawer
          detail={detail}
          report={plansByKey[`${detail.date}|${detail.supId}`] || null}
          team={teamsByKey[`${detail.date}|${detail.supId}`] || []}
          batches={batchesByKey[`${detail.date}|${detail.supId}`] || []}
          updates={(groups.find((g) => g.date === detail.date)?.supervisors
            .find((s) => s.supId === detail.supId)?.updates) || []}
          partnerName={detail.partnerName || null}
          partnerReport={detail.partnerSupId ? (plansByKey[`${detail.date}|${detail.partnerSupId}`] || null) : null}
          partnerTeam={detail.partnerSupId ? (teamsByKey[`${detail.date}|${detail.partnerSupId}`] || []) : []}
          attsByUpdateId={attsByUpdateId}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  )
}

// ── Supervisor card ────────────────────────────────────────

function CollabBadges({ collaboration }) {
  if (!collaboration?.length) return null
  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      {collaboration.map((c, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${
            c.status === 'accepted'
              ? 'bg-purple-50 text-purple-700 border-purple-200'
              : 'bg-purple-50/60 text-purple-400 border-purple-200 border-dashed'
          }`}
        >
          🤝 {c.status === 'accepted' ? 'Collaborating with' : 'Pending'} {c.name}
        </span>
      ))}
    </div>
  )
}

function SupervisorCard({ name, partnerName = null, role, report, team, batches = [], collaboration = [], updates, attsByUpdateId, onViewFull }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  const partnerInitial = partnerName ? partnerName.charAt(0).toUpperCase() : null
  const displayName = partnerName ? `${name} + ${partnerName}` : name
  const eq = report?.equipment || {}
  const hasBatches = batches.length > 0

  // No structured plan submitted — but may still have Batch-Mode teams and/or updates
  if (!report) {
    return (
      <div className={`bg-white rounded-2xl overflow-hidden mb-3 ${
        hasBatches ? 'border border-gray-100 shadow-sm' : 'border border-dashed border-gray-200'
      }`}>
        <div className="px-5 pt-4 pb-3 flex items-center gap-3">
          <div className="flex-shrink-0 flex items-center">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-base ${
              hasBatches ? 'bg-[#0F172A] text-white shadow-sm' : 'bg-gray-100 text-gray-400'
            }`}>
              {initial}
            </div>
            {partnerInitial && (
              <div className="w-11 h-11 rounded-full bg-[#C0272D] text-white flex items-center justify-center font-bold text-base shadow-sm -ml-3 ring-2 ring-white">
                {partnerInitial}
              </div>
            )}
          </div>
          <div>
            <span className="font-semibold text-gray-700 text-sm">{displayName}</span>
            <p className="text-xs text-gray-400 mt-0.5">
              {hasBatches
                ? `Batch Mode · ${batches.length} batch${batches.length === 1 ? '' : 'es'}`
                : 'No work plan submitted for this date'}
            </p>
            <CollabBadges collaboration={collaboration} />
          </div>
        </div>

        <BatchTeamList batches={batches} />

        {updates.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/40">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2.5">Updates</p>
            <div className="space-y-2">
              {updates.map((u, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-0.5 font-mono">
                    {new Date(u.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}
                  </span>
                  {!u.content && attsByUpdateId[u.id]?.length > 0
                    ? <span className="text-xs text-gray-500 italic flex items-center gap-1"><span>🎙</span> Voice message</span>
                    : <span className="text-sm text-gray-700 leading-snug">{u.content}</span>
                  }
                </div>
              ))}
            </div>
          </div>
        )}

        {hasBatches && (
          <div className="border-t border-gray-50 px-5 py-3">
            <button
              onClick={onViewFull}
              className="text-xs font-semibold text-[#C0272D] hover:text-red-800 flex items-center gap-1 transition-colors"
            >
              View full plan <span className="text-base leading-none">→</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  const hasTrawler = eq.trawler && eq.trawler !== 'NOT REQUIRED'
  const hasEquipment = !!(eq.crane || eq.hydra || hasTrawler)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden mb-3">

      {/* Card header — supervisor identity + project */}
      <div className="px-5 pt-5 pb-4 flex items-start gap-4">
        <div className="flex-shrink-0 flex items-center">
          <div className="w-11 h-11 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-base shadow-sm">
            {initial}
          </div>
          {partnerInitial && (
            <div className="w-11 h-11 rounded-full bg-[#C0272D] text-white flex items-center justify-center font-bold text-base shadow-sm -ml-3 ring-2 ring-white">
              {partnerInitial}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-base">{displayName}</span>
            <span className="text-xs text-gray-400 font-normal">{role}</span>
            {/* Bug 1: only show OT times when approved; otherwise show a pending label.
                Uses report.overtime (the actual saved boolean — spec called it ot_planned). */}
            {report.overtime && report.ot_status === 'approved' && (
              <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-emerald-200">
                ⚡ OT {report.ot_from}–{report.ot_to}
              </span>
            )}
            {report.overtime && report.ot_status && !['none', 'approved', 'rejected'].includes(report.ot_status) && (
              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-amber-200">
                ⚡ OT Pending Approval
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {report.project_description && (
              <span className="inline-flex items-center bg-red-50 text-[#C0272D] text-xs font-semibold px-2.5 py-0.5 rounded-full border border-red-100">
                {report.project_description}
              </span>
            )}
            {report.project_location && (
              <span className="text-xs text-gray-400">{report.project_location}</span>
            )}
            {report.work_from && (
              <span className="text-xs text-gray-400">· {to12hr(report.work_from)}–{to12hr(report.work_to)}</span>
            )}
          </div>
          <CollabBadges collaboration={collaboration} />
        </div>
      </div>

      {/* Tasks + Equipment row */}
      {(report.tasks?.length > 0 || hasEquipment) && (
        <div className="px-5 pb-4 grid grid-cols-2 gap-6">
          {report.tasks?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Tasks</p>
              <ul className="space-y-1.5">
                {report.tasks.map((task, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasEquipment && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Equipment</p>
              <div className="space-y-1.5">
                {eq.crane && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🏗</span>
                    <span className="text-xs text-gray-600">{eq.crane}</span>
                  </div>
                )}
                {eq.hydra && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🔧</span>
                    <span className="text-xs text-gray-600">{eq.hydra}</span>
                  </div>
                )}
                {hasTrawler && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🚛</span>
                    <span className="text-xs text-gray-600">{eq.trawler}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Team chips */}
      {team.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Team · {team.length} worker{team.length === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {team.slice(0, 5).map((w, i) => (
              <span key={i} className="text-xs bg-gray-50 border border-gray-200 text-gray-600 px-2.5 py-1 rounded-full font-medium">
                {w.designation || w.name}
              </span>
            ))}
            {team.length > 5 && (
              <span className="text-xs bg-gray-50 border border-gray-200 text-gray-500 px-2.5 py-1 rounded-full">
                +{team.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Batch-Mode teams */}
      <BatchTeamList batches={batches} />

      {/* Updates section */}
      {updates.length > 0 && (
        <div className="border-t border-gray-50 px-5 py-3 bg-gray-50/50">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2.5">Updates</p>
          <div className="space-y-2">
            {updates.slice(0, 2).map((u, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-0.5 font-mono">
                  {new Date(u.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
                {!u.content && attsByUpdateId[u.id]?.length > 0
                  ? <span className="text-xs text-gray-500 italic flex items-center gap-1"><span>🎙</span> Voice message</span>
                  : <span className="text-sm text-gray-700 leading-snug">{u.content}</span>
                }
              </div>
            ))}
          </div>
          <button
            onClick={onViewFull}
            className="mt-3 text-xs font-semibold text-[#C0272D] hover:text-red-800 flex items-center gap-1 transition-colors"
          >
            View full plan <span className="text-base leading-none">→</span>
          </button>
        </div>
      )}

      {/* No updates — still show view link */}
      {updates.length === 0 && (
        <div className="border-t border-gray-50 px-5 py-3">
          <button
            onClick={onViewFull}
            className="text-xs font-semibold text-[#C0272D] hover:text-red-800 flex items-center gap-1 transition-colors"
          >
            View full plan <span className="text-base leading-none">→</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Detail drawer ──────────────────────────────────────────

// Fix 3: compact "both supervisors side by side" block for the collaboration
// partner inside the detail drawer — their own project summary + workmen list.
function CollabPartnerDetail({ name, report, team = [] }) {
  const eq = report?.equipment || {}
  const hasTrawler = eq.trawler && eq.trawler !== 'NOT REQUIRED'
  return (
    <section className="pt-5 border-t border-gray-100">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-purple-500 mb-3">
        🤝 {name}&apos;s plan
      </h3>
      {report ? (
        <div className="bg-purple-50/50 rounded-xl p-4 space-y-3 mb-4">
          {[
            { label: 'Description', value: report.project_description },
            { label: 'Location', value: report.project_location },
            { label: 'Permit Holder', value: report.permit_holder },
            { label: 'Timing', value: report.work_from && report.work_to ? `${to12hr(report.work_from)} – ${to12hr(report.work_to)}` : null },
          ].map(({ label, value }) => value && (
            <div key={label} className="flex justify-between items-baseline gap-4">
              <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
              <span className="text-sm font-medium text-gray-900 text-right">{value}</span>
            </div>
          ))}
          {/* Bug 1: OT row only when approved (green); pending in-flight shows a label, no times. */}
          {report.overtime && report.ot_status === 'approved' && (
            <div className="flex justify-between items-baseline gap-4 pt-2 border-t border-purple-100">
              <span className="text-xs text-emerald-600 flex-shrink-0">⚡ OT Timing</span>
              <span className="text-sm font-semibold text-emerald-700 text-right">{report.ot_from} – {report.ot_to}</span>
            </div>
          )}
          {report.overtime && report.ot_status && !['none', 'approved', 'rejected'].includes(report.ot_status) && (
            <div className="flex justify-between items-baseline gap-4 pt-2 border-t border-purple-100">
              <span className="text-xs text-amber-600 flex-shrink-0">⚡ OT</span>
              <span className="text-sm font-semibold text-amber-700 text-right">Pending Approval</span>
            </div>
          )}
          {hasTrawler && (
            <div className="flex justify-between items-baseline gap-4">
              <span className="text-xs text-gray-500 flex-shrink-0">Trawler</span>
              <span className="text-sm font-medium text-gray-900 text-right">{eq.trawler}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400 mb-4">No work plan submitted.</p>
      )}
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Workmen ({team.length})</p>
      {team.length ? (
        <div className="space-y-2">
          {team.map((w, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <span className="text-xs text-gray-400 w-5 text-right font-mono">{i + 1}</span>
              <span className="text-sm font-semibold text-gray-900">{w.name}</span>
              <span className="text-xs text-gray-400 ml-auto">{w.designation}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-gray-400">No team picked.</p>}
    </section>
  )
}

function DetailDrawer({ detail, report, team, batches = [], updates, partnerName = null, partnerReport = null, partnerTeam = [], attsByUpdateId, onClose }) {
  const eq = report?.equipment || {}
  const hasTrawler = eq.trawler && eq.trawler !== 'NOT REQUIRED'
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 flex items-center">
              <div className="w-9 h-9 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm">
                {(detail.name || '?').charAt(0)}
              </div>
              {partnerName && (
                <div className="w-9 h-9 rounded-full bg-[#C0272D] text-white flex items-center justify-center font-bold text-sm -ml-2.5 ring-2 ring-white">
                  {(partnerName || '?').charAt(0)}
                </div>
              )}
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-base">{partnerName ? `${detail.name} + ${partnerName}` : detail.name}</h2>
              <p className="text-xs text-gray-400">{formatDate(detail.date)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-7">
          {report ? (
            <>
              {/* Project */}
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Project</h3>
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  {[
                    { label: 'Description', value: report.project_description },
                    { label: 'Location', value: report.project_location },
                    { label: 'Permit Holder', value: report.permit_holder },
                    { label: 'Timing', value: report.work_from && report.work_to ? `${to12hr(report.work_from)} – ${to12hr(report.work_to)}` : null },
                  ].map(({ label, value }) => value && (
                    <div key={label} className="flex justify-between items-baseline gap-4">
                      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
                      <span className="text-sm font-medium text-gray-900 text-right">{value}</span>
                    </div>
                  ))}
                  {/* Bug 1: OT row only when approved (green); pending in-flight shows a label, no times. */}
                  {report.overtime && report.ot_status === 'approved' && (
                    <div className="flex justify-between items-baseline gap-4 pt-2 border-t border-emerald-100">
                      <span className="text-xs text-emerald-600 flex-shrink-0">⚡ OT Timing</span>
                      <span className="text-sm font-semibold text-emerald-700 text-right">{report.ot_from} – {report.ot_to}</span>
                    </div>
                  )}
                  {report.overtime && report.ot_status && !['none', 'approved', 'rejected'].includes(report.ot_status) && (
                    <div className="flex justify-between items-baseline gap-4 pt-2 border-t border-amber-100">
                      <span className="text-xs text-amber-600 flex-shrink-0">⚡ OT</span>
                      <span className="text-sm font-semibold text-amber-700 text-right">Pending Approval</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Tasks */}
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Today&apos;s Tasks</h3>
                {report.tasks?.length ? (
                  <div className="space-y-2">
                    {report.tasks.map((task, i) => (
                      <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                        <span className="w-5 h-5 rounded-full bg-[#0F172A] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-gray-800">{task}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-400">No tasks listed.</p>}
              </section>

              {/* Equipment */}
              {(eq.crane || eq.hydra || eq.trawler_not_required || eq.trawler) && (
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Equipment</h3>
                  <div className="space-y-2">
                    {eq.crane && (
                      <div className="flex items-center gap-3 text-sm">
                        <span>🏗</span>
                        <span className="text-gray-500 w-16">Crane</span>
                        <span className="font-medium text-gray-900">{eq.crane}</span>
                      </div>
                    )}
                    {eq.hydra && (
                      <div className="flex items-center gap-3 text-sm">
                        <span>🔧</span>
                        <span className="text-gray-500 w-16">Hydra</span>
                        <span className="font-medium text-gray-900">{eq.hydra}</span>
                      </div>
                    )}
                    {(eq.trawler_not_required || hasTrawler) && (
                      <div className="flex items-center gap-3 text-sm">
                        <span>🚛</span>
                        <span className="text-gray-500 w-16">Trawler</span>
                        <span className="font-medium text-gray-900">{eq.trawler_not_required ? 'Not Required' : eq.trawler}</span>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">No work plan submitted for this date.</p>
          )}

          {/* Team */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
              Workmen ({team.length})
            </h3>
            {team.length ? (
              <div className="space-y-2">
                {team.map((w, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <span className="text-xs text-gray-400 w-5 text-right font-mono">{i + 1}</span>
                    <span className="text-sm font-semibold text-gray-900">{w.name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{w.designation}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No team picked for this date.</p>}
          </section>

          {/* Batches */}
          {batches?.length > 0 && (
            <section>
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Batches ({batches.length})
              </h3>
              <div className="space-y-3">
                {batches.map((batch, idx) => {
                  const m = batch.metadata || {}
                  const fields = [
                    { label: 'Project', value: m.project_description || batch.project_description },
                    { label: 'Location', value: m.project_location || batch.project_location },
                    { label: 'Timing', value: m.timing_from ? `${m.timing_from} – ${m.timing_to || ''}`.trim() : null },
                  ].filter((f) => f.value)
                  const equipment = [
                    { key: 'crane', icon: '🏗', label: 'Crane' },
                    { key: 'hydra', icon: '🔧', label: 'Hydra' },
                    { key: 'trawler', icon: '🚛', label: 'Trawler' },
                    { key: 'cherry_picker', icon: '🏗', label: 'Cherry Picker' },
                  ].filter((e) => m[e.key])
                  return (
                    <div key={batch.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-6 h-6 rounded-full bg-[#C0272D] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-gray-900 text-sm">{batch.batch_name}</span>
                      </div>

                      {(fields.length > 0 || m.ot_planned) && (
                        <div className="space-y-2 mb-3">
                          {fields.map((f) => (
                            <div key={f.label} className="flex justify-between text-xs gap-4">
                              <span className="text-gray-500 flex-shrink-0">{f.label}</span>
                              <span className="font-medium text-gray-900 text-right">{f.value}</span>
                            </div>
                          ))}
                          {m.ot_planned && (
                            <div className="flex justify-between text-xs gap-4">
                              <span className="text-amber-600 flex-shrink-0">⚡ OT</span>
                              <span className="font-semibold text-amber-700 text-right">{m.ot_from || '—'} – {m.ot_to || '—'}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {batch.tasks?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-500 mb-1">Tasks</p>
                          <div className="flex flex-wrap gap-1">
                            {batch.tasks.map((task) => (
                              <span key={task} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{task}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {equipment.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-500 mb-1">Equipment</p>
                          <div className="space-y-1">
                            {equipment.map((e) => (
                              <div key={e.key} className="flex items-center gap-2 text-xs">
                                <span>{e.icon}</span>
                                <span className="text-gray-500 w-24 flex-shrink-0">{e.label}</span>
                                <span className="text-gray-700">{m[e.key]}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {batch.assignments?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Workers ({batch.assignments.length})</p>
                          <div className="space-y-1">
                            {batch.assignments.map((a, i) => (
                              <div key={a.id || i} className="flex items-center gap-2 text-xs">
                                <span className="text-gray-400 w-4">{i + 1}.</span>
                                <span className="font-medium text-gray-900">{a.worker?.full_name}</span>
                                <span className="text-gray-400 ml-auto">{a.worker?.designations?.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Updates */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Updates</h3>
            {updates.length ? (
              <div className="space-y-4">
                {updates.map((u, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex-shrink-0 text-right">
                      <span className="text-xs font-mono text-gray-400">
                        {new Date(u.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </span>
                      <p className="text-[10px] text-gray-300">
                        {new Date(u.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-xl px-3.5 py-2.5">
                      {u.content
                        ? <p className="text-sm text-gray-700 leading-relaxed">{u.content}</p>
                        : <AttachmentList attachments={attsByUpdateId[u.id] || []} />
                      }
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No updates posted.</p>}
          </section>

          {/* Fix 3: collaborating partner's own plan + team (both supervisors' details). */}
          {partnerName && (
            <CollabPartnerDetail name={partnerName} report={partnerReport} team={partnerTeam} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Evening Reports tab ────────────────────────────────────

function ReportsFeed() {
  const [reports, setReports] = useState([])
  const [supervisorNames, setSupervisorNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let isMounted = true
    ;(async () => {
      const { data, error: err } = await fetchAllEveningReportsRange(DAYS_BACK)
      if (!isMounted) return
      if (err) { setError(err.message); setLoading(false); return }

      const list = data || []
      setReports(list)

      const ids = [...new Set(list.map((r) => r.supervisor_id))]
      if (ids.length) {
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name').in('id', ids)
        if (!isMounted) return
        const map = {}
        for (const p of profiles || []) map[p.id] = p.full_name
        setSupervisorNames(map)
      }

      setError(null)
      setLoading(false)
    })()
    return () => { isMounted = false }
  }, [])

  // Group by date descending
  const groups = useMemo(() => {
    const byDate = new Map()
    for (const r of reports) {
      if (!byDate.has(r.report_date)) byDate.set(r.report_date, [])
      byDate.get(r.report_date).push(r)
    }
    const out = []
    for (const [date, reps] of byDate) {
      reps.sort((a, b) => {
        const na = (supervisorNames[a.supervisor_id] || '').toLowerCase()
        const nb = (supervisorNames[b.supervisor_id] || '').toLowerCase()
        return na.localeCompare(nb)
      })
      out.push({ date, reports: reps })
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1))
    return out
  }, [reports, supervisorNames])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!groups.length) {
    return (
      <p className="text-sm text-slate-500">No EOD reports in the last {DAYS_BACK} days.</p>
    )
  }

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.date}>
          <header className="mb-3 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">{formatDate(g.date)}</h2>
            <span className="text-xs text-slate-400">
              {g.reports.length} report{g.reports.length !== 1 ? 's' : ''}
            </span>
          </header>

          {/* Table for the date */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-[160px_1fr_1fr_1fr] gap-0 border-b border-slate-100 bg-slate-50">
              <Cell header>Supervisor</Cell>
              <Cell header>Completed</Cell>
              <Cell header>Pending</Cell>
              <Cell header>Plan tomorrow</Cell>
            </div>

            {g.reports.map((r) => {
              const isOpen = expandedId === r.id
              return (
                <div key={r.id} className="border-b border-slate-100 last:border-b-0">
                  {/* Desktop row */}
                  <div
                    className="hidden md:grid grid-cols-[160px_1fr_1fr_1fr] gap-0 cursor-pointer hover:bg-slate-50/60"
                    onClick={() => setExpandedId(isOpen ? null : r.id)}
                  >
                    <Cell className="font-medium">
                      {supervisorNames[r.supervisor_id] || 'Unknown'}
                    </Cell>
                    <Cell>{r.completed}</Cell>
                    <Cell className={r.pending ? '' : 'text-slate-400 italic'}>
                      {r.pending || '—'}
                    </Cell>
                    <Cell>{r.plan_tomorrow}</Cell>
                  </div>

                  {/* Mobile card */}
                  <div
                    className="md:hidden p-4 cursor-pointer"
                    onClick={() => setExpandedId(isOpen ? null : r.id)}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">
                        {supervisorNames[r.supervisor_id] || 'Unknown'}
                      </p>
                      <ChevronIcon open={isOpen} />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{r.completed}</p>
                  </div>

                  {/* Expanded detail (mobile: always; desktop: on click) */}
                  {isOpen && (
                    <div className="px-4 pb-4 md:px-6 md:pb-5 space-y-3 md:border-t md:border-slate-100">
                      <ReportDetailRow label="Completed today" value={r.completed} />
                      <ReportDetailRow label="Pending" value={r.pending} />
                      {r.pending_reason && (
                        <ReportDetailRow label="Reason for pending" value={r.pending_reason} />
                      )}
                      <ReportDetailRow label="Plan tomorrow" value={r.plan_tomorrow} />
                      <ReportAttachments reportId={r.id} />
                      <p className="text-xs text-slate-400">
                        Submitted {formatDateTime(r.created_at)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <p className="text-xs text-slate-400 text-center pt-2">Showing the last {DAYS_BACK} days.</p>
    </div>
  )
}

// Lazy-loads attachments for one report only when expanded
function ReportAttachments({ reportId }) {
  const [atts, setAtts] = useState(null)

  useEffect(() => {
    if (!reportId) return
    supabase
      .from('work_attachments')
      .select('id, storage_path, file_name, file_size, mime_type')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setAtts(data || []))
  }, [reportId])

  if (!atts) return null
  if (!atts.length) return null
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1">Attachments</p>
      <AttachmentList attachments={atts} />
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
        active
          ? 'border-amber-500 text-amber-700'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

function Cell({ children, header = false, className = '' }) {
  const base = 'px-4 py-3 text-sm border-r border-slate-100 last:border-r-0 align-top'
  const styles = header
    ? `${base} text-xs font-semibold text-slate-500 uppercase tracking-wide`
    : `${base} text-slate-800 ${className}`
  return <div className={styles}>{children}</div>
}

function ReportDetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 whitespace-pre-wrap">{value}</p>
    </div>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
      className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  )
}
