import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/auth-context'
import SplashScreen from '../components/SplashScreen'
import IndustrialScene from '../components/IndustrialScene'

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

  // Splash plays once per app open (session), before the form is revealed.
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return !sessionStorage.getItem('sasec:splash')
    } catch {
      return true
    }
  })
  const handleSplashDone = useCallback(() => {
    try {
      sessionStorage.setItem('sasec:splash', '1')
    } catch {
      /* private mode — splash simply replays next visit */
    }
    setShowSplash(false)
  }, [])

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
      className="login-root min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden"
      style={{ background: '#0F172A' }}
    >
      {/* Blueprint grid — breathes slowly */}
      <div
        className="login-grid fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* Warm glow behind card + edge vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(192,39,45,0.08) 0%, transparent 70%)',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(2,6,18,0.5) 100%)',
        }}
      />

      {/* Full steel-plant erection panorama — cranes hoist, workers weld,
          structures draw themselves in. Fixed wide width on phones so both
          cranes stay in frame. */}
      <IndustrialScene
        variant="construction"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 h-full w-[1400px] md:w-full text-[#8FA3BF]"
      />

      {/* Drawing-sheet frame with registration corners + annotations */}
      <div className="pointer-events-none fixed inset-2.5 sm:inset-4 border border-white/[0.08]" aria-hidden="true">
        <div className="absolute -top-px -left-px h-3 w-3 border-t-2 border-l-2 border-white/25" />
        <div className="absolute -top-px -right-px h-3 w-3 border-t-2 border-r-2 border-white/25" />
        <div className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-white/25" />
        <div className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-white/25" />
        <span className="f-mono absolute top-2 left-5 text-[8.5px] tracking-[0.25em] text-slate-500">
          SASEC ENGINEERING PVT. LTD.
        </span>
        <span className="f-mono absolute top-2 right-5 hidden sm:block text-[8.5px] tracking-[0.25em] text-slate-500">
          DWG · EMS-ACCESS-01
        </span>
        <span className="f-mono absolute bottom-2 left-5 hidden sm:block text-[8.5px] tracking-[0.25em] text-slate-500">
          SITE — JSW STEEL PLANT
        </span>
        <span className="f-mono absolute bottom-2 right-5 text-[8.5px] tracking-[0.25em] text-slate-500">
          SCALE · NTS
        </span>
      </div>

      {/* Login card — the drawing's title block */}
      <div
        className={`relative z-10 w-full max-w-[400px] rounded-lg bg-[#FBFCFE] px-6 sm:px-8 pt-8 pb-7 transition-all duration-300 ${
          success ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'
        }`}
        style={{
          boxShadow: '0 25px 60px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
          animation: 'loginCardIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        {/* Weld-seam accent along the top edge */}
        <div className="absolute top-0 left-6 right-6 h-[3px] rounded-b bg-gradient-to-r from-transparent via-[#C0272D] to-transparent" />

        {/* Header */}
        <img
          src="/logo.png"
          alt="SASEC Engineering"
          style={{ height: 52, width: 'auto', objectFit: 'contain' }}
        />

        {/* Hairline + weld tack */}
        <div className="mt-5 flex items-center gap-2">
          <span className="h-[5px] w-[5px] bg-[#C0272D]" />
          <span className="h-px flex-1 bg-[#E2E8F0]" />
        </div>

        {/* Heading */}
        <div className="mt-5 mb-6">
          <h1 className="f-disp text-[30px] font-bold uppercase tracking-[0.05em] leading-none text-[#0F172A]">
            Site Access
          </h1>
          <p className="mt-1.5 text-[12.5px] text-[#64748B]">
            Workforce management system — sign in to continue
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-identifier"
              className="f-mono block mb-1.5 text-[9.5px] tracking-[0.22em] text-[#64748B]"
            >
              MOBILE NO. / EMAIL ID
            </label>
            <div
              className={`flex items-stretch rounded-md border bg-white overflow-hidden transition-all duration-150 ${
                isReady
                  ? 'border-[#10B981]'
                  : 'border-[#E2E8F0] focus-within:border-[#C0272D]'
              }`}
              style={{
                boxShadow: isReady
                  ? '0 0 0 3px rgba(16,185,129,0.12)'
                  : undefined,
                height: 46,
              }}
            >
              <div className="flex items-center gap-1.5 px-3 bg-[#F8FAFC] border-r border-[#E2E8F0] select-none flex-shrink-0">
                {isEmail
                  ? <Mail  className="h-4 w-4 text-[#64748B]" strokeWidth={2} />
                  : <Phone className="h-4 w-4 text-[#64748B]" strokeWidth={2} />
                }
                <span className="f-mono text-[13px] font-semibold text-[#0F172A]">
                  {isEmail ? 'Email' : '+91'}
                </span>
              </div>
              <input
                id="login-identifier"
                type="text"
                inputMode="text"
                autoComplete="username"
                required
                placeholder="Mobile number or email"
                value={identifier}
                onChange={handleIdentifier}
                className="flex-1 min-w-0 px-3 text-sm text-[#0F172A] bg-transparent outline-none placeholder:text-[#94A3B8] h-full"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="f-mono block mb-1.5 text-[9.5px] tracking-[0.22em] text-[#64748B]"
            >
              PASSCODE
            </label>
            <div
              className="flex items-stretch rounded-md border border-[#E2E8F0] bg-white overflow-hidden transition-all duration-150 focus-within:border-[#C0272D]"
              style={{ height: 46 }}
            >
              <div className="flex items-center px-3 bg-[#F8FAFC] border-r border-[#E2E8F0] flex-shrink-0">
                <Lock className="h-4 w-4 text-[#64748B]" strokeWidth={2} />
              </div>
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="flex-1 min-w-0 px-3 text-sm text-[#0F172A] bg-transparent outline-none placeholder:text-[#94A3B8] h-full"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                className="flex items-center px-3 text-[#94A3B8] hover:text-[#0F172A] transition-colors flex-shrink-0 focus-visible:outline-2 focus-visible:outline-[#C0272D] focus-visible:-outline-offset-2"
              >
                {showPwd
                  ? <EyeOff className="h-4 w-4" strokeWidth={1.8} />
                  : <Eye    className="h-4 w-4" strokeWidth={1.8} />
                }
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[#FEE2E2] border border-[#FECACA]">
              <AlertCircle className="h-4 w-4 text-[#B91C1C] flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-xs text-[#B91C1C] font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !isReady}
            className="btn-weld f-disp w-full flex items-center justify-center gap-2.5 text-white text-[17px] font-semibold uppercase tracking-[0.18em] rounded-md group"
            style={{ height: 48 }}
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

        <p className="mt-5 text-center text-[9px] tracking-wide text-[#CBD5E1]">
          © 2026 SASEC Engineering — Confidential
        </p>
      </div>

      {showSplash && <SplashScreen onDone={handleSplashDone} />}

      <style>{`
        .login-root .f-disp { font-family: 'Barlow Condensed', 'Inter', sans-serif; }
        .login-root .f-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

        @keyframes loginCardIn {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .login-grid { animation: loginGridPulse 9s ease-in-out infinite; }
        @keyframes loginGridPulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }

        .btn-weld {
          background: #C0272D;
          box-shadow: inset 0 -2px 0 rgba(15, 23, 42, 0.28), 0 2px 10px rgba(192, 39, 45, 0.28);
          transition: background 150ms ease, box-shadow 150ms ease, transform 120ms ease;
        }
        .btn-weld:hover:not(:disabled) {
          background: #A81F25;
          box-shadow: inset 0 -2px 0 rgba(15, 23, 42, 0.32), 0 4px 18px rgba(192, 39, 45, 0.42);
        }
        .btn-weld:active:not(:disabled) { transform: translateY(1px); }
        .btn-weld:disabled { opacity: 0.45; cursor: not-allowed; }
        .btn-weld:focus-visible { outline: 2px solid #FCA5A5; outline-offset: 2px; }

        @media (prefers-reduced-motion: reduce) {
          .login-grid { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
