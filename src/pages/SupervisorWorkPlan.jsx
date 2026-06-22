import { useCallback, useEffect, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import VoiceRecorder from '../components/VoiceRecorder'
import FileUploader from '../components/FileUploader'
import AttachmentList from '../components/AttachmentList'
import DailySiteReport from '../components/DailySiteReport'
import { useAuth } from '../contexts/auth-context'
import {
  fetchUpdatesForDate,
  insertUpdate,
  fetchEveningReport,
  upsertEveningReport,
  fetchAttachmentsByUpdateIds,
  fetchAttachmentsByReportId,
  uploadAttachment,
} from '../lib/work-updates'
import { fetchMyAssignmentsForDate } from '../lib/assignments'
import { supabase } from '../lib/supabase'
import { todayLocal, formatDate, formatDateTime } from '../lib/dates'

export default function SupervisorWorkPlan() {
  const { user, profile } = useAuth()
  const [date, setDate] = useState(todayLocal())

  // ── Team ──────────────────────────────────────────────────
  const [team, setTeam] = useState([])
  const [teamLoading, setTeamLoading] = useState(true)

  // teamLoading starts true; no setTeamLoading(true) inside the effect to
  // satisfy the set-state-in-effect lint rule. On date change the previous
  // team pills stay visible until the new fetch resolves.
  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    fetchMyAssignmentsForDate(user.id, date).then(async ({ data, error }) => {
      if (!isMounted) return
      if (error || !data?.length) { setTeam([]); setTeamLoading(false); return }
      const ids = data.map((a) => a.worker_id || a.worker_table_id).filter(Boolean)
      const { data: workers } = await supabase
        .from('workers')
        .select('id, full_name, designation_id, designations(name)')
        .in('id', ids)
        .order('full_name')
      if (!isMounted) return
      setTeam(workers || [])
      setTeamLoading(false)
    })
    return () => { isMounted = false }
  }, [user?.id, date])

  // ── Daily updates ─────────────────────────────────────────
  const [updates, setUpdates] = useState([])
  const [attachmentsByUpdate, setAttachmentsByUpdate] = useState({}) // updateId -> []
  const [updatesLoading, setUpdatesLoading] = useState(true)

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const loadUpdates = useCallback(async () => {
    if (!user?.id) return
    setUpdatesLoading(true)
    const { data, error } = await fetchUpdatesForDate(user.id, date)
    if (error) { setUpdatesLoading(false); return }
    const list = data || []
    setUpdates(list)
    if (list.length) {
      const { data: atts } = await fetchAttachmentsByUpdateIds(list.map((u) => u.id))
      const map = {}
      for (const a of atts || []) {
        if (!map[a.update_id]) map[a.update_id] = []
        map[a.update_id].push(a)
      }
      setAttachmentsByUpdate(map)
    } else {
      setAttachmentsByUpdate({})
    }
    setUpdatesLoading(false)
  }, [user?.id, date])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadUpdates() }, [loadUpdates])

  // ── Add update form ───────────────────────────────────────
  const [newText, setNewText] = useState('')
  const [newFiles, setNewFiles] = useState([])
  const [voiceFile, setVoiceFile] = useState(null)
  const [voiceKey, setVoiceKey] = useState(0) // increment to reset VoiceRecorder
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState(null)

  const postUpdate = async () => {
    if (!newText.trim() && !voiceFile) {
      setPostError('Write a message or record a voice note before posting.')
      return
    }
    setPosting(true)
    setPostError(null)

    const content = newText.trim() // '' for voice-only (requires migration 21-voice-messages.sql)
    const { data: update, error } = await insertUpdate(user.id, date, content)
    if (error) { setPosting(false); setPostError(error.message); return }

    // Upload file attachments then voice recording
    const newAtts = []
    for (const f of newFiles) {
      const { data: att, error: attErr } = await uploadAttachment({
        supervisorId: user.id, date, file: f, updateId: update.id,
      })
      if (!attErr && att) newAtts.push(att)
    }
    if (voiceFile) {
      const { data: att, error: attErr } = await uploadAttachment({
        supervisorId: user.id, date, file: voiceFile, updateId: update.id,
      })
      if (!attErr && att) newAtts.push(att)
    }

    setUpdates((prev) => [...prev, update])
    if (newAtts.length) {
      setAttachmentsByUpdate((prev) => ({
        ...prev, [update.id]: newAtts,
      }))
    }
    setNewText('')
    setNewFiles([])
    setVoiceFile(null)
    setVoiceKey((k) => k + 1) // reset the VoiceRecorder UI
    setPosting(false)
  }

  // ── Evening report ────────────────────────────────────────
  const [report, setReport] = useState(null)
  const [reportAtts, setReportAtts] = useState([])
  const [reportLoading, setReportLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const loadReport = useCallback(async () => {
    if (!user?.id) return
    setReportLoading(true)
    const { data } = await fetchEveningReport(user.id, date)
    setReport(data ?? null)
    if (data?.id) {
      const { data: atts } = await fetchAttachmentsByReportId(data.id)
      setReportAtts(atts || [])
    } else {
      setReportAtts([])
    }
    setReportLoading(false)
  }, [user?.id, date])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadReport() }, [loadReport])

  // ── Evening report form state ─────────────────────────────
  const [form, setForm] = useState({ completed: '', pending: '', pending_reason: '', plan_tomorrow: '' })
  const [formFiles, setFormFiles] = useState([])
  // Voice recording per field — keyed by field name
  const [formVoice, setFormVoice] = useState({})
  const [formVoiceKey, setFormVoiceKey] = useState(0) // increment to reset all VoiceRecorders
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // startEditing pre-fills the form imperatively rather than via an effect,
  // which avoids the set-state-in-effect lint rule.
  const startEditing = () => {
    if (report) {
      setForm({
        completed:      report.completed      ?? '',
        pending:        report.pending        ?? '',
        pending_reason: report.pending_reason ?? '',
        plan_tomorrow:  report.plan_tomorrow  ?? '',
      })
    }
    setEditing(true)
  }

  const setField = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }))
  const setFormVoiceField = (k) => (file) => setFormVoice((prev) => ({ ...prev, [k]: file }))

  const submitReport = async () => {
    if (!form.completed.trim() || !form.pending.trim() || !form.plan_tomorrow.trim()) {
      setSubmitError('Please fill in all mandatory fields.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    const { data: saved, error } = await upsertEveningReport(user.id, date, {
      completed: form.completed.trim(),
      pending: form.pending.trim(),
      pending_reason: form.pending_reason.trim() || null,
      plan_tomorrow: form.plan_tomorrow.trim(),
    })
    if (error) { setSubmitting(false); setSubmitError(error.message); return }

    // Upload file attachments + all per-field voice recordings
    const newAtts = []
    const filesToUpload = [
      ...formFiles,
      ...Object.values(formVoice).filter(Boolean),
    ]
    for (const f of filesToUpload) {
      const { data: att, error: attErr } = await uploadAttachment({
        supervisorId: user.id, date, file: f, reportId: saved.id,
      })
      if (!attErr && att) newAtts.push(att)
    }

    setReport(saved)
    setReportAtts((prev) => [...prev, ...newAtts])
    setFormFiles([])
    setFormVoice({})
    setFormVoiceKey((k) => k + 1) // reset all VoiceRecorder UIs
    setEditing(false)
    setSubmitting(false)
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <DashboardShell title="Work plan" accent="bg-sky-500">
      {/* Date picker */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <p className="text-sm text-slate-500">{formatDate(date)}</p>
      </div>

      {/* Structured daily site report */}
      <DailySiteReport
        key={date}
        date={date}
        supervisorId={user?.id}
        permitHolderDefault={profile?.full_name}
        team={team}
        teamLoading={teamLoading}
      />

      {/* Daily updates log */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-8">
        <div className="px-7 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="h-6 w-1 rounded-full bg-[#C0272D]" />
            <h3 className="text-base font-bold text-slate-900 tracking-tight">Daily updates</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1.5 ml-4">Post progress notes throughout the day — all entries are timestamped.</p>
        </div>

        {updatesLoading ? (
          <div className="px-7 py-6 text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            {/* Feed */}
            {updates.length === 0 ? (
              <div className="px-7 py-5 text-sm text-slate-400 italic">No updates posted yet for this date.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {updates.map((u) => (
                  <li key={u.id} className="px-7 py-4">
                    <p className="text-xs text-slate-400 mb-1">{formatDateTime(u.created_at)}</p>
                    {u.content && (
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{u.content}</p>
                    )}
                    <AttachmentList attachments={attachmentsByUpdate[u.id] || []} />
                  </li>
                ))}
              </ul>
            )}

            {/* Add update */}
            <div className="px-7 py-6 border-t border-slate-100 space-y-4">
              <textarea
                rows={3}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="What's happening on site right now? (optional if sending voice)"
                disabled={posting}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D] focus:border-[#C0272D] disabled:opacity-60"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <FileUploader files={newFiles} onChange={setNewFiles} disabled={posting} />
                <VoiceRecorder
                  key={voiceKey}
                  onChange={setVoiceFile}
                  disabled={posting}
                  variant="outline-slate"
                />
              </div>
              {postError && <p className="text-xs text-rose-600">{postError}</p>}
              <button
                onClick={postUpdate}
                disabled={posting}
                className="bg-[#C0272D] hover:bg-[#A01E23] disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-md transition shadow-sm"
              >
                {posting ? 'Posting…' : 'Post update'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Evening report */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="px-7 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="h-6 w-1 rounded-full bg-[#C0272D]" />
              <h3 className="text-base font-bold text-slate-900 tracking-tight">EOD report</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1.5 ml-4">Submit once at end of day.</p>
          </div>
          {report && !editing && (
            <button
              onClick={startEditing}
              className="text-xs font-medium text-slate-700 border border-slate-300 px-2.5 py-1 rounded-md hover:bg-slate-100"
            >
              Edit
            </button>
          )}
        </div>

        {reportLoading ? (
          <div className="px-7 py-6 text-sm text-slate-500">Loading…</div>
        ) : report && !editing ? (
          /* View saved report */
          <div className="px-7 py-6 space-y-4">
            <ReportField label="What was completed today?" value={report.completed} />
            <ReportField label="What is pending?" value={report.pending} />
            {report.pending_reason && (
              <ReportField label="Reason for pending work" value={report.pending_reason} />
            )}
            <ReportField label="Plan for tomorrow?" value={report.plan_tomorrow} />
            {reportAtts.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Attachments</p>
                <AttachmentList attachments={reportAtts} />
              </div>
            )}
            <p className="text-xs text-slate-400">
              Submitted {formatDateTime(report.created_at)}
              {report.updated_at !== report.created_at && ` · Updated ${formatDateTime(report.updated_at)}`}
            </p>
          </div>
        ) : (
          /* Form (new or editing) */
          <div className="px-7 py-6 space-y-5">
            <EveningField
              label="What was completed today?"
              required
              value={form.completed}
              onChange={setField('completed')}
              voiceKey={formVoiceKey}
              onVoiceFile={setFormVoiceField('completed')}
              disabled={submitting}
            />
            <EveningField
              label="What is pending?"
              required
              value={form.pending}
              onChange={setField('pending')}
              voiceKey={formVoiceKey}
              onVoiceFile={setFormVoiceField('pending')}
              disabled={submitting}
            />
            <EveningField
              label="Reason for pending work?"
              value={form.pending_reason}
              onChange={setField('pending_reason')}
              voiceKey={formVoiceKey}
              onVoiceFile={setFormVoiceField('pending_reason')}
              disabled={submitting}
              placeholder="Optional — leave blank if nothing is pending"
            />
            <EveningField
              label="Plan for tomorrow?"
              required
              value={form.plan_tomorrow}
              onChange={setField('plan_tomorrow')}
              voiceKey={formVoiceKey}
              onVoiceFile={setFormVoiceField('plan_tomorrow')}
              disabled={submitting}
            />
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Attachments (optional)</p>
              <FileUploader files={formFiles} onChange={setFormFiles} disabled={submitting} />
            </div>
            {submitError && <p className="text-xs text-rose-600">{submitError}</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={submitReport}
                disabled={submitting}
                className="bg-[#C0272D] hover:bg-[#A01E23] disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-md transition shadow-sm"
              >
                {submitting ? 'Submitting…' : report ? 'Save changes' : 'Submit report'}
              </button>
              {editing && (
                <button
                  onClick={() => setEditing(false)}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}

function EveningField({ label, required = false, value, onChange, onVoiceFile, voiceKey, disabled, placeholder = '' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <textarea
          rows={3}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder || `${label}…`}
          className="w-full pl-3 pr-12 py-2.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D] focus:border-[#C0272D] disabled:opacity-60"
        />
        <div className="absolute top-2 right-2">
          <VoiceRecorder key={voiceKey} onChange={onVoiceFile} disabled={disabled} variant="inline-icon" />
        </div>
      </div>
    </div>
  )
}

function ReportField({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className="text-sm text-slate-800 whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded-md px-3 py-2">{value}</p>
    </div>
  )
}
