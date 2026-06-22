import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/auth-context'

const EMAIL_DOMAIN = 'sasec.in'

function resolveEmail(raw) {
  const t = raw.trim()
  if (t.includes('@')) return t.toLowerCase()
  return `${t.replace(/\D/g, '')}@${EMAIL_DOMAIN}`
}

function inputMode(raw) {
  const t = raw.trim()
  if (t.includes('@')) return 'email'
  const d = t.replace(/\D/g, '')
  if (d.length === 0)  return 'empty'
  if (d.length === 10) return 'phone'
  if (d.length < 10)   return 'phone_partial'
  return 'invalid'
}

export default function Login() {
  const navigate   = useNavigate()
  const { signIn } = useAuth()

  const [identifier, setIdentifier] = useState('')
  const [password,   setPassword]   = useState('')
  const [showPwd,    setShowPwd]    = useState(false)
  const [error,      setError]      = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [success,    setSuccess]    = useState(false)

  const mode    = inputMode(identifier)
  const isEmail = mode === 'email'
  const isPhone = mode === 'phone'
  const isReady = isEmail || isPhone

  const handleIdentifier = (e) => {
    const val = e.target.value
    if (!val.includes('@') && !/[a-zA-Z]/.test(val)) {
      setIdentifier(val.replace(/\D/g, '').slice(0, 10))
      return
    }
    setIdentifier(val)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!isReady) {
      setError(mode === 'phone_partial'
        ? 'Please enter a complete 10-digit mobile number.'
        : 'Please enter your mobile number or email address.')
      return
    }
    setSubmitting(true)
    const { error: signInErr } = await signIn({ email: resolveEmail(identifier), password })
    if (signInErr) {
      setSubmitting(false)
      const m = signInErr.message.toLowerCase()
      setError(
        m.includes('invalid') || m.includes('credentials') || m.includes('password')
          ? 'Incorrect mobile number or password. Please try again.'
          : signInErr.message
      )
      return
    }
    setSuccess(true)
    setTimeout(() => navigate('/', { replace: true }), 200)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden"
      style={{ background: '#0F172A' }}
    >
      {/* Subtle grid pattern */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Subtle radial glow behind card */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(192,39,45,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Login card */}
      <div
        className={`relative w-full max-w-[380px] md:max-w-[420px] bg-white rounded-2xl px-8 py-10 transition-all duration-300 ${
          success ? 'opacity-0 translate-y-[-8px]' : 'opacity-100 translate-y-0'
        }`}
        style={{
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
          animation: 'loginCardIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="SASEC Engineering"
            style={{ height: 70, width: 'auto', objectFit: 'contain' }}
          />
        </div>

        {/* Divider */}
        <div className="mt-5 mb-5 h-[2px] w-10 mx-auto rounded-full bg-[#C0272D]" />

        {/* Heading */}
        <div className="mb-6 text-center">
          <h1 className="text-[22px] font-bold text-[#0F172A] leading-tight tracking-tight">
            Welcome back
          </h1>
          <p className="mt-1 text-[13px] text-[#64748B]">Sign in to continue</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone / email input */}
          <div>
            <div
              className={`flex items-stretch rounded-lg border bg-white overflow-hidden transition-all duration-150 ${
                isReady
                  ? 'border-[#10B981]'
                  : 'border-[#E2E8F0] focus-within:border-[#C0272D]'
              }`}
              style={{
                boxShadow: isReady
                  ? '0 0 0 3px rgba(16,185,129,0.12)'
                  : undefined,
                height: 44,
              }}
            >
              {/* Prefix */}
              <div className="flex items-center gap-1.5 px-3 bg-[#F8FAFC] border-r border-[#E2E8F0] select-none flex-shrink-0">
                {isEmail
                  ? <Mail  className="h-4 w-4 text-[#64748B]" strokeWidth={2} />
                  : <Phone className="h-4 w-4 text-[#64748B]" strokeWidth={2} />
                }
                <span className="text-sm font-semibold text-[#0F172A]">
                  {isEmail ? 'Email' : '+91'}
                </span>
              </div>
              <input
                type="text"
                inputMode="text"
                autoComplete="username"
                required
                placeholder="Mobile number or email"
                value={identifier}
                onChange={handleIdentifier}
                className="flex-1 min-w-0 px-3 text-sm text-[#0F172A] bg-white outline-none placeholder:text-[#94A3B8] h-full"
              />
            </div>
          </div>

          {/* Password input */}
          <div>
            <div
              className="flex items-stretch rounded-lg border border-[#E2E8F0] bg-white overflow-hidden transition-all duration-150 focus-within:border-[#C0272D]"
              style={{ height: 44 }}
            >
              <div className="flex items-center px-3 bg-[#F8FAFC] border-r border-[#E2E8F0] flex-shrink-0">
                <Lock className="h-4 w-4 text-[#64748B]" strokeWidth={2} />
              </div>
              <input
                type={showPwd ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="flex-1 min-w-0 px-3 text-sm text-[#0F172A] bg-white outline-none placeholder:text-[#94A3B8] h-full"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPwd((v) => !v)}
                className="flex items-center px-3 text-[#94A3B8] hover:text-[#0F172A] transition-colors flex-shrink-0"
              >
                {showPwd
                  ? <EyeOff className="h-4 w-4" strokeWidth={1.8} />
                  : <Eye    className="h-4 w-4" strokeWidth={1.8} />
                }
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FEE2E2] border border-[#FECACA]">
              <AlertCircle className="h-4 w-4 text-[#B91C1C] flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-xs text-[#B91C1C] font-medium">{error}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={submitting || !isReady}
            className="w-full flex items-center justify-center gap-2 text-white text-[15px] font-semibold rounded-lg transition-all duration-150 active:scale-[0.98] group disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              height: 48,
              background: '#C0272D',
              boxShadow: isReady ? '0 2px 8px rgba(192,39,45,0.25)' : undefined,
            }}
            onMouseEnter={(e) => {
              if (!submitting && isReady) {
                e.currentTarget.style.background = '#A01E23'
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(192,39,45,0.4)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#C0272D'
              e.currentTarget.style.boxShadow = isReady ? '0 2px 8px rgba(192,39,45,0.25)' : ''
            }}
          >
            {submitting ? (
              <>
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign In
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.2} />
              </>
            )}
          </button>
        </form>

        {/* Hint */}
        <p className="mt-5 text-center text-[11px] text-[#94A3B8]">
          Default password: <span className="font-mono font-semibold">SASEC@XXXX</span>
        </p>

        {/* Footer */}
        <p className="mt-6 text-center text-[10px] text-[#CBD5E1] tracking-wide">
          SASEC Engineering PVT. LTD. © 2025 — Confidential
        </p>
      </div>

      {/* Card slide-up keyframe */}
      <style>{`
        @keyframes loginCardIn {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
