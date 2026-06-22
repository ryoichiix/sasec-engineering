import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dates'
import LeaveStatusPill from './LeaveStatusPill'
import QueueSectionHeader, { QueueEmptyState } from './QueueSectionHeader'
// Notifications handled exclusively by DB trigger — no client-side calls needed
import {
  fetchAttachmentsByLeaveRequestId,
  getSignedUrl,
} from '../lib/work-updates'

function dateRange(start, end) {
  if (start === end) return formatDate(start)
  return `${formatDate(start)} → ${formatDate(end)}`
}

/**
 * Shared leave queue component.
 *
 * stage="field_manager"
 *   Shows pending_field_manager requests. FM can Approve / Reject.
 *
 * stage="boss"
 *   Shows pending_boss and callback_requested requests.
 *   Boss can Approve / Reject / Request Callback.
 *
 * stage="supervisor"
 *   Read-only view of all requests (all statuses).
 */
export default function LeaveQueue({ stage, onCountChange }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const [draft, setDraft]         = useState({})  // per-row { note, busy, error }
  const [voiceUrls, setVoiceUrls] = useState({})  // leaveRequestId -> signed URL

  const isFieldManager = stage === 'field_manager'
  const isBoss         = stage === 'boss'
  const isSupervisor   = stage === 'supervisor'

  useEffect(() => {
    let isMounted = true

    let query = supabase
      .from('leave_requests')
      .select(
        'id, supervisor_id, start_date, end_date, reason, status, ' +
        'field_manager_id, field_manager_decision, field_manager_note, field_manager_decided_at, ' +
        'boss_note, boss_decided_at, created_at'
      )
      .order('created_at', { ascending: false })

    if (isFieldManager) {
      query = query.eq('status', 'pending_field_manager')
    } else if (isBoss) {
      query = query.in('status', ['pending_boss', 'callback_requested'])
    }
    // supervisor: no filter → all requests

    query.then(async ({ data, error }) => {
      if (!isMounted) return
      if (error) {
        setLoadError(error.message)
        setLoading(false)
        return
      }

      const requests = data || []

      // Batch-fetch applicant + field manager names
      const profileIds = new Set()
      for (const r of requests) {
        profileIds.add(r.supervisor_id)
        if (r.field_manager_id) profileIds.add(r.field_manager_id)
      }
      const profileMap = {}
      if (profileIds.size > 0) {
        const { data: pRows } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(profileIds))
        for (const p of pRows || []) profileMap[p.id] = p.full_name
      }

      if (!isMounted) return
      setLoadError(null)
      setRows(
        requests.map((r) => ({
          ...r,
          applicant_name:     profileMap[r.supervisor_id]    || 'Unknown supervisor',
          field_manager_name: r.field_manager_id
            ? profileMap[r.field_manager_id] || 'Site Incharge'
            : null,
        }))
      )
      setLoading(false)

      // Voice attachments (async, non-blocking)
      for (const req of requests) {
        fetchAttachmentsByLeaveRequestId(req.id).then(({ data: atts }) => {
          if (!isMounted) return
          const audio = (atts || []).find(
            (a) => a.mime_type && a.mime_type.startsWith('audio/')
          )
          if (!audio) return
          getSignedUrl(audio.storage_path).then(({ data: signed }) => {
            if (!isMounted || !signed?.signedUrl) return
            setVoiceUrls((prev) => ({ ...prev, [req.id]: signed.signedUrl }))
          })
        })
      }
    })

    return () => { isMounted = false }
  }, [stage, isFieldManager, isBoss, refreshTick])

  // Report pending count to parent (Site Incharge approval-queue header).
  useEffect(() => { onCountChange?.(rows.length) }, [rows.length, onCountChange])

  // ── Field Manager decision ──────────────────────────────────
  // All notifications are handled exclusively by the DB trigger (notify_leave_event).
  // No client-side notify calls — avoids duplicates.
  const fmDecide = async (row, decision) => {
    const { id } = row
    const note = (draft[id]?.note || '').trim()

    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), busy: true, error: null } }))

    const { error } = await supabase
      .from('leave_requests')
      .update({
        field_manager_decision: decision,
        field_manager_note:     note || null,
      })
      .eq('id', id)

    if (error) {
      setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), busy: false, error: error.message } }))
      return
    }

    // DB trigger fires the notification. Just refresh.
    setDraft((d) => { const n = { ...d }; delete n[id]; return n })
    setRefreshTick((t) => t + 1)
  }

  // ── Boss decision ────────────────────────────────────────────
  // All notifications are handled exclusively by the DB trigger (notify_leave_event).
  // No client-side notify calls — avoids duplicates and double-fire after callback.
  const bossDecide = async (row, decision) => {
    // decision: 'approved' | 'rejected' | 'callback'
    const { id } = row
    const note = (draft[id]?.note || '').trim()

    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), busy: true, error: null } }))

    let updatePayload
    if (decision === 'callback') {
      // Set status directly to callback_requested. The BEFORE UPDATE trigger allows
      // this transition from either pending_boss or callback_requested.
      updatePayload = { status: 'callback_requested', boss_note: note || null }
    } else {
      // approve / reject — trigger derives the new status from boss_decision.
      // Works from BOTH pending_boss AND callback_requested states.
      updatePayload = { boss_decision: decision, boss_note: note || null }
    }

    const { error } = await supabase
      .from('leave_requests')
      .update(updatePayload)
      .eq('id', id)

    if (error) {
      setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), busy: false, error: error.message } }))
      return
    }

    // DB trigger fires the notification. Remove from local list and clear draft.
    setDraft((d) => { const n = { ...d }; delete n[id]; return n })
    setRefreshTick((t) => t + 1)
  }

  // ── Site Incharge (Field Manager) premium render ──────────────
  if (isFieldManager) {
    return (
      <div>
        <QueueSectionHeader title="Leave Requests" count={loading ? 0 : rows.length} />

        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm text-gray-400">
            Loading…
          </div>
        ) : loadError ? (
          <p className="mb-3 text-sm text-red-600">{loadError}</p>
        ) : rows.length === 0 ? (
          <QueueEmptyState text="No pending requests" />
        ) : (
          rows.map((r) => {
            const d = draft[r.id] || {}
            const audioUrl = voiceUrls[r.id]
            const name = r.applicant_name || 'Unknown supervisor'
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-3 hover:shadow-md transition-shadow">
                <div className="px-5 pt-4 pb-3 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{name}</span>
                      <span className="text-xs text-gray-400">{dateRange(r.start_date, r.end_date)}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{r.reason}</p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 bg-blue-50 text-blue-700 border-blue-200">
                    Leave
                  </span>
                </div>

                {audioUrl && (
                  <div className="px-5 pb-3">
                    <audio controls src={audioUrl} className="w-full h-8" preload="metadata" />
                  </div>
                )}

                <div className="px-5 pb-3">
                  <textarea
                    placeholder="Add a note (optional)..."
                    rows={2}
                    value={d.note ?? ''}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, [r.id]: { ...(p[r.id] || {}), note: e.target.value } }))
                    }
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-gray-300 text-gray-700 placeholder-gray-300"
                  />
                  {d.error && <p className="text-xs text-red-600 mt-1">{d.error}</p>}
                </div>

                <div className="flex items-center gap-2 px-5 pb-4">
                  <button
                    onClick={() => fmDecide(r, 'approved')}
                    disabled={d.busy}
                    className="flex-1 bg-[#0F172A] hover:bg-gray-800 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-colors disabled:opacity-60"
                  >
                    {d.busy ? 'Saving…' : 'Approve → Director'}
                  </button>
                  <button
                    onClick={() => fmDecide(r, 'rejected')}
                    disabled={d.busy}
                    className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────
  const title = isFieldManager
    ? 'Pending your review'
    : isBoss
      ? 'Pending your approval'
      : 'All leave requests'

  const emptyText = isFieldManager
    ? 'No leave requests pending your review.'
    : isBoss
      ? 'No pending leave requests.'
      : 'No leave requests submitted yet.'

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <div className="flex items-center gap-2">
            {isSupervisor && (
              <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                Read-only
              </span>
            )}
            <span className="text-xs text-slate-400">
              {loading ? '' : `${rows.length} request${rows.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>
        ) : loadError ? (
          <div className="px-6 py-6 text-sm text-rose-600">{loadError}</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-8 text-sm text-slate-500">{emptyText}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const d = draft[r.id] || {}
              const audioUrl = voiceUrls[r.id]
              const isCallback = r.status === 'callback_requested'

              return (
                <li key={r.id} className="px-6 py-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {r.applicant_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {dateRange(r.start_date, r.end_date)}
                        <span className="ml-2 text-slate-400">
                          · Submitted {formatDate(r.created_at?.slice(0, 10))}
                        </span>
                      </p>
                    </div>
                    <LeaveStatusPill value={r.status} />
                  </div>

                  {/* Reason */}
                  <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-md px-3 py-2">
                    {r.reason}
                  </p>

                  {/* Voice player */}
                  {audioUrl && (
                    <div className="bg-slate-50 rounded-md px-3 py-2">
                      <p className="text-xs font-medium text-slate-500 mb-1.5">🎙 Voice message</p>
                      <audio controls src={audioUrl} className="w-full h-9" preload="metadata" />
                    </div>
                  )}

                  {/* Field Manager note (shown on boss view + supervisor read-only) */}
                  {r.field_manager_note && (
                    <p className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">Site Incharge note:</span>{' '}
                      {r.field_manager_note}
                      {r.field_manager_name && (
                        <span className="text-slate-400"> ({r.field_manager_name})</span>
                      )}
                    </p>
                  )}

                  {/* Boss note */}
                  {r.boss_note && (
                    <p className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">Director note:</span>{' '}
                      {r.boss_note}
                    </p>
                  )}

                  {/* Callback banner */}
                  {isCallback && (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800">
                      <span>📞</span>
                      <span>
                        <span className="font-semibold">Director requested a callback</span> before
                        making a final decision.
                        {r.boss_note && ` "${r.boss_note}"`}
                      </span>
                    </div>
                  )}

                  {/* FIELD MANAGER controls */}
                  {isFieldManager && (
                    <>
                      <textarea
                        rows={2}
                        placeholder="Optional note…"
                        value={d.note ?? ''}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, [r.id]: { ...(p[r.id] || {}), note: e.target.value } }))
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                      {d.error && <p className="text-xs text-rose-600">{d.error}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => fmDecide(r, 'approved')}
                          disabled={d.busy}
                          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-md transition"
                        >
                          {d.busy ? 'Saving…' : 'Approve → send to Director'}
                        </button>
                        <button
                          onClick={() => fmDecide(r, 'rejected')}
                          disabled={d.busy}
                          className="bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60 text-xs font-semibold px-4 py-2 rounded-md transition"
                        >
                          Reject
                        </button>
                      </div>
                    </>
                  )}

                  {/* BOSS controls */}
                  {isBoss && (
                    <>
                      <textarea
                        rows={2}
                        placeholder="Optional note for the supervisor…"
                        value={d.note ?? ''}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, [r.id]: { ...(p[r.id] || {}), note: e.target.value } }))
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                      {d.error && <p className="text-xs text-rose-600">{d.error}</p>}
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => bossDecide(r, 'approved')}
                          disabled={d.busy}
                          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-md transition"
                        >
                          {d.busy ? 'Saving…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => bossDecide(r, 'rejected')}
                          disabled={d.busy}
                          className="bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60 text-xs font-semibold px-4 py-2 rounded-md transition"
                        >
                          Reject
                        </button>
                        {!isCallback && (
                          <button
                            onClick={() => bossDecide(r, 'callback')}
                            disabled={d.busy}
                            className="bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-60 text-xs font-semibold px-4 py-2 rounded-md transition"
                          >
                            📞 Request Callback
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
