import { useEffect, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase, createImportAuthClient } from '../lib/supabase'

const EMAIL_DOMAIN = 'sasec.in'

// ── Credential derivation ────────────────────────────────────
function phoneToEmail(phone) {
  const digits = String(phone).replace(/\D/g, '')
  return `${digits}@${EMAIL_DOMAIN}`
}

function phoneToPassword(phone) {
  const digits = String(phone).replace(/\D/g, '')
  return `SASEC@${digits.slice(-4)}`
}

// ── Print credential sheet ───────────────────────────────────
function printCredentials(results) {
  const created = results.filter((r) => r.status !== 'skipped')
  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) { alert('Allow pop-ups to print.'); return }

  const rows = results.map((r) => `
    <tr style="border-bottom:1px solid #E2E8F0">
      <td style="padding:10px 12px">${esc(r.name)}</td>
      <td style="padding:10px 12px">${esc(r.phone)}</td>
      <td style="padding:10px 12px;font-family:monospace">${esc(r.email)}</td>
      <td style="padding:10px 12px;font-family:monospace;font-weight:600">${esc(r.password)}</td>
      <td style="padding:10px 12px">
        <span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;${
          r.status === 'created'  ? 'background:#D1FAE5;color:#065F46' :
          r.status === 'skipped'  ? 'background:#FEF3C7;color:#92400E' :
                                    'background:#FEE2E2;color:#991B1B'
        }">
          ${r.status === 'created' ? '✓ Created' : r.status === 'skipped' ? 'Already exists' : '✗ Failed'}
        </span>
      </td>
    </tr>
  `).join('')

  win.document.write(`<!DOCTYPE html><html><head>
  <meta charset="UTF-8">
  <title>Supervisor Login Credentials — SASEC Engineering</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:13px;color:#0F172A;padding:40px 50px}
    .header{display:flex;align-items:center;gap:16px;border-bottom:2px solid #C0272D;padding-bottom:14px;margin-bottom:24px}
    .logo{width:56px;height:56px;object-fit:contain}
    .company{font-size:15px;font-weight:700;line-height:1.3}
    .subtitle{font-size:11px;color:#64748B;margin-top:2px}
    h2{font-size:14px;font-weight:700;color:#C0272D;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px}
    .notice{background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#92400E}
    table{width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden}
    thead th{background:#F8FAFC;text-align:left;padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#64748B;border-bottom:1px solid #E2E8F0}
    .footer{margin-top:32px;border-top:1px solid #E2E8F0;padding-top:12px;font-size:10px;color:#94A3B8;text-align:center}
    @media print{@page{size:A4;margin:20mm 25mm}body{padding:0}}
  </style>
</head><body>
  <div class="header">
    <img class="logo" src="${window.location.origin}/logo.png" alt="SASEC">
    <div>
      <div class="company">SASEC Engineering PVT. LTD.</div>
      <div class="subtitle">Swamy &amp; Sons · Engineers | Contractors</div>
    </div>
  </div>
  <h2>Supervisor Login Credentials</h2>
  <div class="notice">
    ⚠ Confidential — distribute directly to supervisors. Ask them to change their password after first login.
  </div>
  <table>
    <thead>
      <tr>
        <th>Name</th><th>Phone</th><th>Login Email</th><th>Default Password</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    Generated ${new Date().toLocaleString('en-IN')} · SASEC Engineering Internal Portal
  </div>
  <script>
    window.addEventListener('load', function(){
      window.print();
      window.addEventListener('afterprint', () => window.close());
    });
  </script>
</body></html>`)
  win.document.close()
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Helpers ────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

// ── Page ───────────────────────────────────────────────────────
export default function BossSupervisors() {
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [saving, setSaving]           = useState({})
  const [savedAt, setSavedAt]         = useState({})
  const [showAddModal, setShowAddModal]     = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('profiles')
      .select('id, full_name, email, field_manager, created_at')
      .eq('role', 'supervisor')
      .order('full_name')
    setLoading(false)
    if (err) { setError(err.message); return }
    setError(null)
    setSupervisors(data || [])
  }

  useEffect(() => { load() }, [])

  const toggleFM = async (sup) => {
    const next = !sup.field_manager
    setSaving((p) => ({ ...p, [sup.id]: true }))
    setSupervisors((prev) =>
      prev.map((s) => s.id === sup.id ? { ...s, field_manager: next } : s)
    )
    const { error: err } = await supabase
      .from('profiles')
      .update({ field_manager: next })
      .eq('id', sup.id)

    if (err) {
      setError(err.message)
      setSupervisors((prev) =>
        prev.map((s) => s.id === sup.id ? { ...s, field_manager: !next } : s)
      )
    } else {
      setSavedAt((p) => ({ ...p, [sup.id]: Date.now() }))
      setTimeout(() => setSavedAt((p) => { const n = { ...p }; delete n[sup.id]; return n }), 2500)
    }
    setSaving((p) => { const n = { ...p }; delete n[sup.id]; return n })
  }

  const fmCount = supervisors.filter((s) => s.field_manager).length

  return (
    <DashboardShell title="Supervisors">
      {/* Header banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {loading ? '—' : supervisors.length} supervisor{supervisors.length === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {fmCount > 0
              ? `${fmCount} Site Incharge${fmCount === 1 ? '' : 's'} — they review leave requests before they reach you.`
              : 'No Site Incharges assigned yet. Toggle the switch on any supervisor to promote them.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <button
            onClick={() => setShowSetupModal(true)}
            className="bg-[#0F172A] hover:bg-[#1E293B] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            🔑 Setup Supervisor Logins
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-brand hover:bg-brand-hover text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            + Add supervisor
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      {/* Supervisors list */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-10 text-sm text-slate-500">Loading…</div>
        ) : supervisors.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            No supervisor accounts yet. Use "Setup Supervisor Logins" or "+ Add supervisor" above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {supervisors.map((s) => (
              <li
                key={s.id}
                className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
              >
                <div className="h-10 w-10 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {initials(s.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {s.full_name || 'Unnamed supervisor'}
                  </p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {s.email || <span className="italic text-slate-400">email not on record</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  {s.field_manager && (
                    <span className="hidden sm:inline-flex items-center text-[11px] font-semibold text-violet-700 bg-violet-100 ring-1 ring-inset ring-violet-200 px-2 py-0.5 rounded-full">
                      ⭐ Site Incharge
                    </span>
                  )}
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <span className="text-xs text-slate-500 hidden sm:inline">Site Incharge</span>
                    <button
                      role="switch"
                      aria-checked={s.field_manager}
                      aria-label={`Toggle Site Incharge for ${s.full_name}`}
                      disabled={saving[s.id]}
                      onClick={() => toggleFM(s)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 ${
                        s.field_manager ? 'bg-violet-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          s.field_manager ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </label>
                </div>
                <span className="w-4 text-emerald-600 text-sm font-bold flex-shrink-0">
                  {saving[s.id] ? '…' : savedAt[s.id] ? '✓' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddModal && (
        <AddSupervisorModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); load() }}
        />
      )}

      {showSetupModal && (
        <SetupLoginsModal
          onClose={() => { setShowSetupModal(false); load() }}
        />
      )}
    </DashboardShell>
  )
}

// ── Setup Logins Modal ────────────────────────────────────────

function SetupLoginsModal({ onClose }) {
  const STAGES = { PREVIEW: 'preview', RUNNING: 'running', DONE: 'done' }
  const [stage, setStage]       = useState(STAGES.PREVIEW)
  const [candidates, setCandidates] = useState([])
  const [results, setResults]   = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [loadError, setLoadError] = useState(null)
  const [loadingCandidates, setLoadingCandidates] = useState(true)

  // Load workers with phone numbers
  useEffect(() => {
    supabase
      .from('workers')
      .select('id, full_name, phone_number')
      .not('phone_number', 'is', null)
      .neq('phone_number', '')
      .order('full_name')
      .then(({ data, error }) => {
        setLoadingCandidates(false)
        if (error) { setLoadError(error.message); return }
        setCandidates(data || [])
      })
  }, [])

  const run = async () => {
    setStage(STAGES.RUNNING)
    setProgress({ done: 0, total: candidates.length })

    const importClient = createImportAuthClient()
    const out = []

    for (let i = 0; i < candidates.length; i++) {
      const w = candidates[i]
      const phone    = String(w.phone_number).replace(/\D/g, '')
      const email    = phoneToEmail(phone)
      const password = phoneToPassword(phone)

      let status = 'created'
      let errorMsg = null
      let userId = null

      // Attempt to create the auth account
      const { data: signData, error: signErr } = await importClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: w.full_name, role: 'supervisor' },
        },
      })

      if (signErr) {
        const msg = signErr.message.toLowerCase()
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('email address is already')) {
          status = 'skipped'
        } else {
          status = 'failed'
          errorMsg = signErr.message
        }
      } else {
        userId = signData?.user?.id
        if (!userId) {
          status = 'failed'
          errorMsg = 'No user ID returned'
        } else {
          // Patch the profile row (trigger should have created it, but upsert to be safe)
          await supabase.from('profiles').upsert({
            id:           userId,
            full_name:    w.full_name,
            role:         'supervisor',
            email,
            phone_number: w.phone_number,
          })
        }
      }

      out.push({
        name:     w.full_name || '—',
        phone:    w.phone_number,
        email,
        password: status === 'skipped' ? '(unchanged)' : password,
        status,
        error:    errorMsg,
      })

      setProgress({ done: i + 1, total: candidates.length })
    }

    setResults(out)
    setStage(STAGES.DONE)
  }

  const created  = results.filter((r) => r.status === 'created').length
  const skipped  = results.filter((r) => r.status === 'skipped').length
  const failed   = results.filter((r) => r.status === 'failed').length
  const pct      = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-auto overflow-hidden">
        {/* Header */}
        <div className="bg-[#0F172A] px-6 py-5 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white">🔑 Setup Supervisor Logins</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Creates a Supabase auth account for each worker with a phone number.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition text-xl leading-none ml-4">×</button>
        </div>

        <div className="px-6 py-6">
          {/* ── Preview stage ─────────────────────────────── */}
          {stage === STAGES.PREVIEW && (
            <>
              {loadError && (
                <p className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{loadError}</p>
              )}

              {loadingCandidates ? (
                <p className="text-sm text-slate-500 py-4">Loading workers with phone numbers…</p>
              ) : candidates.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm font-semibold text-slate-800 mb-1">No workers with phone numbers found</p>
                  <p className="text-xs text-slate-500">Import the Payment Sheet (2).xlsx first so workers have phone numbers.</p>
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
                    <strong>{candidates.length} workers</strong> with phone numbers will get supervisor login accounts.
                    <span className="block text-xs mt-1 text-amber-700">
                      Email format: <code>phonenumber@{EMAIL_DOMAIN}</code> · Password: <code>SASEC@last4digits</code>
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 mb-5">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                        <tr>
                          <th className="px-4 py-2.5 text-left">Name</th>
                          <th className="px-4 py-2.5 text-left">Phone</th>
                          <th className="px-4 py-2.5 text-left">Login email</th>
                          <th className="px-4 py-2.5 text-left">Default password</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {candidates.map((w) => {
                          const ph = String(w.phone_number).replace(/\D/g, '')
                          return (
                            <tr key={w.id} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5 font-medium text-slate-900">{w.full_name}</td>
                              <td className="px-4 py-2.5 text-slate-600">{w.phone_number}</td>
                              <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{phoneToEmail(ph)}</td>
                              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800">{phoneToPassword(ph)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button onClick={onClose} className="btn-ghost px-5">Cancel</button>
                    <button onClick={run} className="btn-brand px-6">
                      Create {candidates.length} accounts
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Running stage ──────────────────────────────── */}
          {stage === STAGES.RUNNING && (
            <div className="text-center py-8">
              <p className="text-sm font-semibold text-slate-800 mb-1">Creating accounts…</p>
              <p className="text-xs text-slate-500 mb-6">
                {progress.done} of {progress.total} processed. Please keep this window open.
              </p>
              <div className="h-2 w-full max-w-xs mx-auto rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-[#C0272D] rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-3">{pct}%</p>
            </div>
          )}

          {/* ── Done stage ─────────────────────────────────── */}
          {stage === STAGES.DONE && (
            <>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-3 mb-5">
                <Chip tone="success" label={`${created} created`} />
                <Chip tone="warning" label={`${skipped} already existed`} />
                {failed > 0 && <Chip tone="error" label={`${failed} failed`} />}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 mb-5">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Name</th>
                      <th className="px-4 py-2.5 text-left">Phone</th>
                      <th className="px-4 py-2.5 text-left">Login email</th>
                      <th className="px-4 py-2.5 text-left">Password</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                        <td className="px-4 py-2.5 text-slate-600">{r.phone}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.email}</td>
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800">{r.password}</td>
                        <td className="px-4 py-2.5">
                          {r.status === 'created' && (
                            <span className="badge badge-success">✓ Created</span>
                          )}
                          {r.status === 'skipped' && (
                            <span className="badge badge-warning">Already exists</span>
                          )}
                          {r.status === 'failed' && (
                            <span className="badge badge-error" title={r.error}>✗ Failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={onClose} className="btn-ghost px-5">Close</button>
                <button
                  onClick={() => printCredentials(results)}
                  className="btn-brand px-6"
                >
                  🖨 Print credentials
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Chip({ tone, label }) {
  const cls = tone === 'success' ? 'bg-emerald-100 text-emerald-800'
            : tone === 'warning' ? 'bg-amber-100 text-amber-800'
            : 'bg-rose-100 text-rose-800'
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${cls}`}>
      {label}
    </span>
  )
}

// ── Add Supervisor Modal ────────────────────────────────────────
function AddSupervisorModal({ onClose, onCreated }) {
  const [fullName, setFullName] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [busy,     setBusy]     = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !password) { setError('All fields are required.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setBusy(true)
    setError(null)

    const importClient = createImportAuthClient()
    const { data: signData, error: signErr } = await importClient.auth.signUp({
      email:   email.trim().toLowerCase(),
      password,
      options: { data: { full_name: fullName.trim(), role: 'supervisor' } },
    })

    if (signErr) { setError(signErr.message); setBusy(false); return }

    const userId = signData?.user?.id
    if (!userId) { setError('No user ID returned.'); setBusy(false); return }

    await supabase.from('profiles').upsert({
      id:        userId,
      full_name: fullName.trim(),
      role:      'supervisor',
      email:     email.trim().toLowerCase(),
    })

    setBusy(false)
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="bg-[#0F172A] px-6 py-5">
          <h2 className="text-base font-bold text-white">Add supervisor</h2>
          <p className="text-xs text-slate-400 mt-0.5">Creates a Supabase auth account so the supervisor can log in.</p>
        </div>
        <form onSubmit={submit} className="px-6 py-6 space-y-4">
          <Field label="Full name" required>
            <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Aisha Khan" className="form-input min-h-[44px]" />
          </Field>
          <Field label="Email address" required>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="aisha@example.com" className="form-input min-h-[44px]" />
          </Field>
          <Field label="Temporary password" required>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="min. 6 characters" className="form-input min-h-[44px]" />
          </Field>
          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn-ghost flex-1 min-h-[44px]">Cancel</button>
            <button type="submit" disabled={busy} className="btn-brand flex-1 min-h-[44px]">
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
