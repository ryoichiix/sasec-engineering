import { useEffect, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import {
  fetchAllLeaveDisclaimers,
  fetchAllOnboardingForms,
  printLeaveDisclaimer,
  printOnboardingForm,
  getScanUrl,
} from '../lib/forms'

const TABS = [
  { id: 'leave',      label: 'Leave Disclaimers' },
  { id: 'onboarding', label: 'Onboarding Forms'  },
]

export default function BossForms() {
  const [tab, setTab] = useState('leave')

  return (
    <DashboardShell title="Forms">
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

      {tab === 'leave'      && <LeaveTab />}
      {tab === 'onboarding' && <OnboardingTab />}
    </DashboardShell>
  )
}

// ── Leave Disclaimers tab ─────────────────────────────────────

function LeaveTab() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [scanUrls, setScanUrls] = useState({})

  useEffect(() => {
    let isMounted = true
    fetchAllLeaveDisclaimers().then(({ data, error: err }) => {
      if (!isMounted) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setRows(data || [])
      for (const r of data || []) {
        if (r.scan_path) {
          getScanUrl(r.scan_path).then((url) => {
            if (url && isMounted) setScanUrls((p) => ({ ...p, [r.id]: url }))
          })
        }
      }
    })
    return () => { isMounted = false }
  }, [])

  return (
    <FormTable
      rows={rows}
      loading={loading}
      error={error}
      scanUrls={scanUrls}
      emptyText="No leave disclaimers submitted yet."
      columns={[
        { label: 'Worker',          render: (r) => r.worker_name },
        { label: 'Leave period',    render: (r) => `${r.leave_start} → ${r.leave_end}` },
        { label: 'Supervisor',      render: (r) => r.supervisor_account_name },
        { label: 'Submitted',       render: (r) => r.created_at?.slice(0, 10) },
      ]}
      onPrint={(r) => printLeaveDisclaimer({
        workerName:     r.worker_name,
        workerPhone:    r.worker_phone,
        leaveStart:     r.leave_start,
        leaveEnd:       r.leave_end,
        supervisorName: r.supervisor_name,
      })}
    />
  )
}

// ── Onboarding Forms tab ──────────────────────────────────────

function OnboardingTab() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [scanUrls, setScanUrls] = useState({})

  useEffect(() => {
    let isMounted = true
    fetchAllOnboardingForms().then(({ data, error: err }) => {
      if (!isMounted) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setRows(data || [])
      for (const r of data || []) {
        if (r.scan_path) {
          getScanUrl(r.scan_path).then((url) => {
            if (url && isMounted) setScanUrls((p) => ({ ...p, [r.id]: url }))
          })
        }
      }
    })
    return () => { isMounted = false }
  }, [])

  return (
    <FormTable
      rows={rows}
      loading={loading}
      error={error}
      scanUrls={scanUrls}
      emptyText="No onboarding forms submitted yet."
      columns={[
        { label: 'Worker',       render: (r) => r.full_name },
        { label: 'Designation',  render: (r) => r.designation || '—' },
        { label: 'Joining date', render: (r) => r.date_of_joining || '—' },
        { label: 'Supervisor',   render: (r) => r.supervisor_account_name },
        { label: 'Submitted',    render: (r) => r.created_at?.slice(0, 10) },
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
    />
  )
}

// ── Shared table ──────────────────────────────────────────────

function FormTable({ rows, loading, error, scanUrls, emptyText, columns, onPrint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">
          {loading ? 'Loading…' : `${rows.length} form${rows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-sm text-slate-500">Loading…</div>
      ) : error ? (
        <div className="px-5 py-6 text-sm text-rose-600">{error}</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-sm text-slate-500 text-center">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className="px-5 py-3">{c.label}</th>
                ))}
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  {columns.map((c) => (
                    <td key={c.label} className="px-5 py-3 text-slate-700">
                      {c.render(r)}
                    </td>
                  ))}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onPrint(r)}
                        className="text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 px-2.5 py-1.5 rounded-md transition"
                      >
                        🖨 Print
                      </button>
                      {scanUrls[r.id] ? (
                        <a
                          href={scanUrls[r.id]}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2.5 py-1.5 rounded-md transition"
                        >
                          📎 View scan
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">No scan</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
