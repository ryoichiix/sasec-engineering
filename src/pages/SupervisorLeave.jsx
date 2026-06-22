import { useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import LeaveQueue from '../components/LeaveQueue'
import VoiceRecorder from '../components/VoiceRecorder'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/auth-context'
import { todayLocal, formatDate } from '../lib/dates'
import { notifyFieldManagers, notifyOtherSupervisors } from '../lib/notifications'
import { uploadAttachment } from '../lib/work-updates'

export default function SupervisorLeave() {
  const { user, profile } = useAuth()
  const [startDate, setStartDate] = useState(todayLocal())
  const [endDate, setEndDate] = useState(todayLocal())
  const [reasonCategory, setReasonCategory] = useState('')
  const [reasonDetail, setReasonDetail] = useState('')
  const [voiceFile, setVoiceFile] = useState(null)
  const [voiceKey, setVoiceKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const isOther = reasonCategory === 'Other'

  const submit = async (e) => {
    e.preventDefault()
    if (!reasonCategory) {
      setSubmitError('Please select a reason.')
      return
    }
    // For "Other": require either text OR a voice recording — not both
    if (isOther && !reasonDetail.trim() && !voiceFile) {
      setSubmitError('Please describe your reason or record a voice message.')
      return
    }
    if (endDate < startDate) {
      setSubmitError('End date cannot be before start date.')
      return
    }

    // Build the reason text. For voice-only "Other" use a placeholder
    // so the reason column (non-empty) is always satisfied.
    let finalReason
    if (isOther) {
      if (reasonDetail.trim()) {
        finalReason = `Other — ${reasonDetail.trim()}`
      } else {
        finalReason = 'Other — see voice recording'
      }
    } else {
      finalReason = reasonCategory
    }

    setSubmitError(null)
    setSubmitting(true)

    const { data: inserted, error } = await supabase
      .from('leave_requests')
      .insert({
        supervisor_id: user.id,
        start_date:    startDate,
        end_date:      endDate,
        reason:        finalReason,
      })
      .select('id')
      .single()

    if (error) {
      setSubmitting(false)
      setSubmitError(error.message)
      return
    }

    // Upload voice recording if one was captured
    if (voiceFile && inserted?.id) {
      const { error: attErr } = await uploadAttachment({
        supervisorId:   user.id,
        date:           startDate,
        file:           voiceFile,
        leaveRequestId: inserted.id,
      })
      if (attErr) {
        console.warn('Voice upload failed:', attErr.message)
      }
    }

    const supervisorName = profile?.full_name || user?.email || 'A supervisor'
    const notifMsg = `${supervisorName} requested leave from ${formatDate(startDate)} to ${formatDate(endDate)}. Reason: ${finalReason}`

    // Notify Field Managers first — they are the first approvers
    await notifyFieldManagers({
      title:         `📋 Leave Request — ${supervisorName}`,
      message:       notifMsg + ' Awaiting your review.',
      type:          'leave_request',
      referenceId:   inserted?.id ?? null,
      referenceType: 'leave_request',
    })

    // Notify all OTHER supervisors so they can see the request (read-only)
    await notifyOtherSupervisors({
      title:         `📋 Leave Request — ${supervisorName}`,
      message:       notifMsg,
      type:          'leave_request',
      referenceId:   inserted?.id ?? null,
      referenceType: 'leave_request',
    })

    setSubmitting(false)
    setReasonCategory('')
    setReasonDetail('')
    setVoiceFile(null)
    setVoiceKey((k) => k + 1)
    setStartDate(todayLocal())
    setEndDate(todayLocal())
    setRefreshTick((t) => t + 1)
  }

  return (
    <DashboardShell title="Leave requests" accent="bg-sky-500">
      <div className="space-y-6">
        {/* Apply for leave */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Apply for leave
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Your request goes straight to the boss for approval.
            </p>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Start date
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  End date
                </label>
                <input
                  type="date"
                  required
                  min={startDate}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Reason
              </label>
              <select
                required
                value={reasonCategory}
                onChange={(e) => {
                  setReasonCategory(e.target.value)
                  setReasonDetail('')
                  setSubmitError(null)
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
              >
                <option value="" disabled>Select a reason…</option>
                <option>Marriage</option>
                <option>Health Issue</option>
                <option>Family Emergency</option>
                <option>Maternity/Paternity Leave</option>
                <option>Bereavement</option>
                <option>Other</option>
              </select>
            </div>

            {/* "Other" expands to show optional text + voice recorder */}
            {isOther && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Description{' '}
                    <span className="text-slate-400 font-normal">
                      (optional if sending a voice message)
                    </span>
                  </label>
                  {/* NOT required — voice alone is sufficient */}
                  <textarea
                    rows={3}
                    value={reasonDetail}
                    onChange={(e) => setReasonDetail(e.target.value)}
                    placeholder="Briefly describe why you need leave…"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Voice message{' '}
                    <span className="text-slate-400 font-normal">
                      (optional if you wrote a description)
                    </span>
                  </label>
                  <VoiceRecorder
                    key={voiceKey}
                    onChange={setVoiceFile}
                    disabled={submitting}
                  />
                  {voiceFile && (
                    <p className="text-xs text-emerald-700 mt-1">
                      ✓ Voice recording ready ({(voiceFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                </div>
              </div>
            )}

            {submitError && (
              <p className="text-sm text-rose-600">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md transition"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </form>
        </div>

        {/* Read-only list of all leave requests */}
        <LeaveQueue stage="supervisor" key={refreshTick} />
      </div>
    </DashboardShell>
  )
}
