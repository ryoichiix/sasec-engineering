import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/auth-context'
import { ROLES } from '../lib/supabase'

export default function Signup() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(ROLES.SUPERVISOR)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    const { data, error } = await signUp({ email, password, fullName, role })
    setSubmitting(false)
    if (error) { setError(error.message); return }
    if (data?.session) {
      navigate('/', { replace: true })
    } else {
      setInfo('Account created. Check your email to confirm, then sign in.')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-site-bg px-4 py-10">
      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">

        {/* Card header — navy band */}
        <div className="bg-navy px-8 pt-8 pb-6 flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="SASEC Engineering"
            className="h-16 w-16 object-contain mb-3"
          />
          <h1 className="text-base font-bold text-white leading-tight">
            SASEC Engineering PVT. LTD.
          </h1>
          <p className="text-[10px] text-white/50 mt-0.5">
            Swamy &amp; Sons : Engineers | Contractors
          </p>
        </div>

        {/* Form area */}
        <div className="px-8 py-7">
          <p className="text-sm font-medium text-slate-700 mb-5">Create your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Full name">
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Email address">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputCls + ' bg-white'}
              >
                <option value={ROLES.SUPERVISOR}>Supervisor</option>
                <option value={ROLES.BOSS}>Boss</option>
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                Worker accounts are created by the Boss from Workers / Import Workers — they do not sign in to this app.
              </p>
            </Field>

            {error && (
              <p className="text-sm text-brand bg-brand-light border border-brand/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm mt-1"
            >
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-xs text-slate-500 mt-5 text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-brand font-semibold hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-6 text-xs text-slate-400 text-center">
        SASEC Engineering PVT. LTD. &copy; 2025 &mdash; Confidential
      </p>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition'

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
