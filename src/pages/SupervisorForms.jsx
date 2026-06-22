import { useEffect, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import WorkerNameAutocomplete from '../components/WorkerNameAutocomplete'
import { useAuth } from '../contexts/auth-context'
import { todayLocal } from '../lib/dates'
import {
  insertLeaveDisclaimer,
  updateLeaveDisclaimerScan,
  fetchMyLeaveDisclaimers,
  printLeaveDisclaimer,
  insertOnboardingForm,
  updateOnboardingScan,
  fetchMyOnboardingForms,
  printOnboardingForm,
  uploadScan,
  getScanUrl,
} from '../lib/forms'

const TABS = [
  { id: 'leave',      label: 'Leave Disclaimer' },
  { id: 'onboarding', label: 'Worker Onboarding' },
]

export default function SupervisorForms() {
  const { user, profile } = useAuth()
  const [tab, setTab] = useState('leave')

  return (
    <DashboardShell title="Forms">
      {/* Tab bar */}
      <div className="flex border-b border-slate-200 mb-6 gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition border-b-2 ${
              tab === t.id
                ? 'border-brand text-brand bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'leave' && (
        <LeaveDisclaimerTab user={user} profile={profile} />
      )}
      {tab === 'onboarding' && (
        <OnboardingTab user={user} profile={profile} />
      )}
    </DashboardShell>
  )
}

// ── Leave Disclaimer Tab ──────────────────────────────────────

function LeaveDisclaimerTab({ user, profile }) {
  const today = todayLocal()
  const [form, setForm] = useState({
    workerName:  '',
    workerPhone: '',
    leaveStart:  today,
    leaveEnd:    today,
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [scanUrls, setScanUrls] = useState({})

  const supervisorName = profile?.full_name || user?.email || ''

  const loadHistory = async () => {
    if (!user?.id) return
    const { data } = await fetchMyLeaveDisclaimers(user.id)
    setHistory(data || [])
    setHistLoading(false)
    for (const r of data || []) {
      if (r.scan_path) {
        getScanUrl(r.scan_path).then((url) => {
          if (url) setScanUrls((p) => ({ ...p, [r.id]: url }))
        })
      }
    }
  }

  useEffect(() => { loadHistory() }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sf = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.workerName.trim()) { setSubmitError('Worker name is required.'); return }
    setSubmitting(true)
    setSubmitError(null)
    const { data, error } = await insertLeaveDisclaimer({
      supervisor_id:   user.id,
      supervisor_name: supervisorName,
      worker_name:     form.workerName.trim(),
      worker_phone:    form.workerPhone.trim() || null,
      leave_start:     form.leaveStart,
      leave_end:       form.leaveEnd,
    })
    setSubmitting(false)
    if (error) { setSubmitError(error.message); return }
    // Auto-print
    printLeaveDisclaimer({
      workerName:     form.workerName.trim(),
      workerPhone:    form.workerPhone.trim(),
      leaveStart:     form.leaveStart,
      leaveEnd:       form.leaveEnd,
      supervisorName,
    })
    setForm({ workerName: '', workerPhone: '', leaveStart: today, leaveEnd: today })
    setHistory((p) => [data, ...p])
  }

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">New leave disclaimer</h3>
        <p className="text-xs text-slate-500 mb-4">
          Fill in worker details and click "Save &amp; Print" to generate the form. Collect the
          physical signature, then upload the scanned copy from the history below.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Worker name" required>
              <WorkerNameAutocomplete
                required
                value={form.workerName}
                onChange={(v) => setForm((p) => ({ ...p, workerName: v }))}
                placeholder="Full name of worker"
                className="form-input" />
            </Field>
            <Field label="Worker phone">
              <input type="tel" value={form.workerPhone} onChange={sf('workerPhone')}
                placeholder="+91 98765 43210"
                className="form-input" />
            </Field>
            <Field label="Leave start date" required>
              <input type="date" required value={form.leaveStart} onChange={sf('leaveStart')}
                className="form-input" />
            </Field>
            <Field label="Leave end date" required>
              <input type="date" required min={form.leaveStart} value={form.leaveEnd}
                onChange={sf('leaveEnd')} className="form-input" />
            </Field>
            <Field label="Supervisor name">
              <input type="text" readOnly value={supervisorName}
                className="form-input bg-slate-50 cursor-not-allowed text-slate-500" />
            </Field>
          </div>

          {/* Disclaimer preview */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600 italic leading-relaxed">
            <span className="font-semibold not-italic text-slate-700">Disclaimer: </span>
            I hereby acknowledge that SASEC Engineering PVT. LTD. holds no responsibility for
            any accidents, injuries, or incidents that occur outside the work premises during the
            leave period. The employee takes full personal responsibility for their safety during leave.
          </div>

          {submitError && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={submitting}
              className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition">
              {submitting ? 'Saving…' : '🖨 Save & Print'}
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <FormHistory
        title="Submitted leave disclaimers"
        rows={history}
        loading={histLoading}
        scanUrls={scanUrls}
        columns={[
          { label: 'Worker', render: (r) => r.worker_name },
          { label: 'Leave period', render: (r) => `${r.leave_start} → ${r.leave_end}` },
          { label: 'Submitted', render: (r) => r.created_at?.slice(0, 10) },
        ]}
        onPrint={(r) => printLeaveDisclaimer({
          workerName:     r.worker_name,
          workerPhone:    r.worker_phone,
          leaveStart:     r.leave_start,
          leaveEnd:       r.leave_end,
          supervisorName: r.supervisor_name,
        })}
        onScanUploaded={async (row, file) => {
          const { error, path } = await uploadScan(user.id, 'leave', row.id, file)
          if (error) return alert('Upload failed: ' + error.message)
          await updateLeaveDisclaimerScan(row.id, path)
          const url = await getScanUrl(path)
          if (url) setScanUrls((p) => ({ ...p, [row.id]: url }))
          setHistory((p) =>
            p.map((r) => r.id === row.id ? { ...r, scan_path: path } : r)
          )
        }}
      />
    </div>
  )
}

// ── Onboarding Tab ────────────────────────────────────────────

function OnboardingTab({ user, profile }) {
  const today = todayLocal()
  const [form, setForm] = useState({
    fullName: '', phoneNumber: '', address: '',
    emergencyContactName: '', emergencyContactPhone: '',
    previousExperience: '', designation: '', dateOfJoining: today,
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [scanUrls, setScanUrls] = useState({})

  const supervisorName = profile?.full_name || user?.email || ''

  const loadHistory = async () => {
    if (!user?.id) return
    const { data } = await fetchMyOnboardingForms(user.id)
    setHistory(data || [])
    setHistLoading(false)
    for (const r of data || []) {
      if (r.scan_path) {
        getScanUrl(r.scan_path).then((url) => {
          if (url) setScanUrls((p) => ({ ...p, [r.id]: url }))
        })
      }
    }
  }

  useEffect(() => { loadHistory() }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sf = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.fullName.trim()) { setSubmitError('Full name is required.'); return }
    setSubmitting(true)
    setSubmitError(null)
    const { data, error } = await insertOnboardingForm({
      supervisor_id:           user.id,
      supervisor_name:         supervisorName,
      full_name:               form.fullName.trim(),
      phone_number:            form.phoneNumber.trim() || null,
      address:                 form.address.trim() || null,
      emergency_contact_name:  form.emergencyContactName.trim() || null,
      emergency_contact_phone: form.emergencyContactPhone.trim() || null,
      previous_experience:     form.previousExperience.trim() || null,
      designation:             form.designation.trim() || null,
      date_of_joining:         form.dateOfJoining || null,
    })
    setSubmitting(false)
    if (error) { setSubmitError(error.message); return }
    printOnboardingForm({ ...form, supervisorName })
    setForm({
      fullName: '', phoneNumber: '', address: '',
      emergencyContactName: '', emergencyContactPhone: '',
      previousExperience: '', designation: '', dateOfJoining: today,
    })
    setHistory((p) => [data, ...p])
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">New onboarding form</h3>
        <p className="text-xs text-slate-500 mb-4">
          Fill in the worker's details and click "Save &amp; Print". Collect signatures then upload the scan.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" required>
              <WorkerNameAutocomplete
                required
                value={form.fullName}
                onChange={(v) => setForm((p) => ({ ...p, fullName: v }))}
                placeholder="Worker's full name"
                className="form-input" />
            </Field>
            <Field label="Phone number">
              <input type="tel" value={form.phoneNumber} onChange={sf('phoneNumber')}
                placeholder="+91 98765 43210" className="form-input" />
            </Field>
            <Field label="Address" full>
              <input type="text" value={form.address} onChange={sf('address')}
                placeholder="Residential address" className="form-input" />
            </Field>
            <Field label="Emergency contact name">
              <input type="text" value={form.emergencyContactName}
                onChange={sf('emergencyContactName')} placeholder="Name"
                className="form-input" />
            </Field>
            <Field label="Emergency contact phone">
              <input type="tel" value={form.emergencyContactPhone}
                onChange={sf('emergencyContactPhone')} placeholder="Phone"
                className="form-input" />
            </Field>
            <Field label="Designation">
              <input type="text" value={form.designation} onChange={sf('designation')}
                placeholder="e.g. Welder, Fitter" className="form-input" />
            </Field>
            <Field label="Date of joining">
              <input type="date" value={form.dateOfJoining} onChange={sf('dateOfJoining')}
                className="form-input" />
            </Field>
            <Field label="Previous experience" full>
              <textarea rows={3} value={form.previousExperience}
                onChange={sf('previousExperience')}
                placeholder="Brief summary of prior work experience…"
                className="form-input resize-none" />
            </Field>
          </div>

          {submitError && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}

          <button type="submit" disabled={submitting}
            className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition">
            {submitting ? 'Saving…' : '🖨 Save & Print'}
          </button>
        </form>
      </div>

      <FormHistory
        title="Submitted onboarding forms"
        rows={history}
        loading={histLoading}
        scanUrls={scanUrls}
        columns={[
          { label: 'Worker', render: (r) => r.full_name },
          { label: 'Designation', render: (r) => r.designation || '—' },
          { label: 'Joining date', render: (r) => r.date_of_joining || '—' },
          { label: 'Submitted', render: (r) => r.created_at?.slice(0, 10) },
        ]}
        onPrint={(r) => printOnboardingForm({
          fullName:               r.full_name,
          phoneNumber:            r.phone_number,
          address:                r.address,
          emergencyContactName:   r.emergency_contact_name,
          emergencyContactPhone:  r.emergency_contact_phone,
          previousExperience:     r.previous_experience,
          designation:            r.designation,
          dateOfJoining:          r.date_of_joining,
          supervisorName:         r.supervisor_name,
        })}
        onScanUploaded={async (row, file) => {
          const { error, path } = await uploadScan(user.id, 'onboarding', row.id, file)
          if (error) return alert('Upload failed: ' + error.message)
          await updateOnboardingScan(row.id, path)
          const url = await getScanUrl(path)
          if (url) setScanUrls((p) => ({ ...p, [row.id]: url }))
          setHistory((p) =>
            p.map((r) => r.id === row.id ? { ...r, scan_path: path } : r)
          )
        }}
      />
    </div>
  )
}

// ── Shared history list ────────────────────────────────────────

function FormHistory({ title, rows, loading, scanUrls, columns, onPrint, onScanUploaded }) {
  const fileRefs = useRef({})

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-400">
          {loading ? '' : `${rows.length} form${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-sm text-slate-500 text-center">No forms submitted yet.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {columns.map((col) => (
                    <div key={col.label}>
                      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{col.label}</p>
                      <p className="text-sm font-medium text-slate-800">{col.render(r)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onPrint(r)}
                    className="text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-md transition"
                  >
                    🖨 Re-print
                  </button>
                  {scanUrls[r.id] ? (
                    <a href={scanUrls[r.id]} target="_blank" rel="noreferrer"
                      className="text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-md transition">
                      📎 View scan
                    </a>
                  ) : (
                    <>
                      <button
                        onClick={() => fileRefs.current[r.id]?.click()}
                        className="text-xs font-medium border border-brand text-brand hover:bg-rose-50 px-3 py-1.5 rounded-md transition"
                      >
                        ⬆ Upload scan
                      </button>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        ref={(el) => { if (el) fileRefs.current[r.id] = el }}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) onScanUploaded(r, file)
                          e.target.value = ''
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Tiny helpers ──────────────────────────────────────────────

function Field({ label, required, full, children }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
