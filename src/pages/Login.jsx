import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/auth-context'
import SplashScreen from '../components/SplashScreen'

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

/* ── Background line sketches — single ink tone, stroke only ── */

function CraneSketch({ className }) {
  return (
    <svg viewBox="0 0 340 560" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {/* tower mast + base */}
        <path d="M104 552V168M144 552V168M88 552H160" />
        <path
          strokeWidth="1"
          d="M104 552L144 504M144 552L104 504M104 504L144 456M144 504L104 456M104 456L144 408M144 456L104 408M104 408L144 360M144 408L104 360M104 360L144 312M144 360L104 312M104 312L144 264M144 312L104 264M104 264L144 216M144 264L104 216M104 216L144 168M144 216L104 168"
        />
        <path
          strokeWidth="1"
          d="M104 504H144M104 456H144M104 408H144M104 360H144M104 312H144M104 264H144M104 216H144"
        />
        {/* slewing group — jib gently slews */}
        <g className="crane-slew">
          <path d="M96 168H152V156H96Z" />
          <path d="M144 156V130H178V156" />
          <path d="M148 136H162" strokeWidth="1" />
          <path d="M112 156L124 96L136 156" />
          {/* jib */}
          <path d="M136 150H332M136 138L332 146" />
          <path
            strokeWidth="1"
            d="M136 150L150 139L164 150L178 140L192 150L206 141L220 150L234 142L248 150L262 143L276 150L290 144L304 150L318 145L332 146"
          />
          {/* tie bars */}
          <path strokeWidth="1" d="M124 100L236 141M124 100L52 145" />
          {/* counter-jib + counterweight with hatching */}
          <path d="M112 150H28M112 143L28 148" />
          <path d="M28 150V180H58V150" />
          <path strokeWidth="0.9" d="M33 156L52 175M33 166L45 178" />
          {/* trolley + swaying hook */}
          <path d="M252 150V158H268V150" />
          <g className="hook-sway">
            <path strokeWidth="1" d="M260 158V252" />
            <circle cx="260" cy="258" r="5" />
            <path d="M260 263C260 271 251 272 251 279C251 285 258 287 262 282" />
          </g>
        </g>
      </g>
    </svg>
  )
}

function BeamSketch({ className }) {
  return (
    <svg viewBox="0 0 240 310" fill="none" className={className} aria-hidden="true">
      <defs>
        <filter id="sk-wob-a" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2" />
        </filter>
      </defs>
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" filter="url(#sk-wob-a)">
        {/* I-section */}
        <path d="M60 60H180V76H128V204H180V220H60V204H112V76H60Z" />
        {/* centerline */}
        <path d="M120 46V234" strokeWidth="0.8" strokeDasharray="9 5 2 5" />
        {/* dimension lines — draw themselves in a slow loop */}
        <g className="dim-draw" strokeWidth="0.9">
          <path d="M186 60H212M186 220H212M206 60V220M206 60L203 68M206 60L209 68M206 220L203 212M206 220L209 212" />
          <path d="M60 54V32M180 54V32M60 38H180M60 38L68 35M60 38L68 41M180 38L172 35M180 38L172 41" />
        </g>
        {/* fillet weld symbol */}
        <path strokeWidth="1" d="M64 282H150M64 282L46 266M98 282V294L112 282" />
      </g>
      <g fill="currentColor" stroke="none" fontFamily="'IBM Plex Mono', ui-monospace, monospace">
        <text x="216" y="134" fontSize="10" transform="rotate(90 216 134)">400</text>
        <text x="106" y="30" fontSize="10">140</text>
        <text x="60" y="252" fontSize="11" letterSpacing="2">ISMB 400</text>
        <text x="60" y="268" fontSize="7.5" letterSpacing="1.5">STRUCTURAL STEEL · IS 2062</text>
      </g>
    </svg>
  )
}

function HatSketch({ className }) {
  return (
    <svg viewBox="0 0 180 130" fill="none" className={className} aria-hidden="true">
      <defs>
        <filter id="sk-wob-b" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
        </filter>
      </defs>
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" filter="url(#sk-wob-b)">
        <path d="M32 86C32 44 64 24 90 24C116 24 148 44 148 86" />
        <path d="M18 88Q90 74 162 88Q90 104 18 88Z" />
        <path d="M82 26V48M98 26V48M82 48H98" />
        <path strokeWidth="1" d="M54 56V68M126 56V68" />
      </g>
    </svg>
  )
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
      {/* Blueprint grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
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

      {/* Ambient line sketches — one ink tone, no fills */}
      <CraneSketch className="fixed bottom-0 -left-10 sm:left-0 h-[62vh] sm:h-[72vh] w-auto text-[#8FA3BF] opacity-[0.13] sm:opacity-[0.19] pointer-events-none" />
      <BeamSketch className="fixed bottom-8 right-4 w-[190px] text-[#8FA3BF] opacity-[0.16] pointer-events-none hidden md:block" />
      <HatSketch className="fixed top-9 right-5 sm:top-12 sm:right-12 w-[86px] sm:w-[118px] -rotate-[8deg] text-[#8FA3BF] opacity-[0.15] sm:opacity-[0.18] pointer-events-none" />

      {/* Login card — the drawing's title block */}
      <div
        className={`relative z-10 w-full max-w-[400px] rounded-lg bg-[#FBFCFE] px-6 sm:px-8 pt-8 pb-6 transition-all duration-300 ${
          success ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'
        }`}
        style={{
          boxShadow: '0 25px 60px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
          animation: 'loginCardIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        {/* Weld-seam accent along the top edge */}
        <div className="absolute top-0 left-6 right-6 h-[3px] rounded-b bg-gradient-to-r from-transparent via-[#C0272D] to-transparent" />

        {/* Header — logo + doc meta */}
        <div className="flex items-start justify-between gap-4">
          <img
            src="/logo.png"
            alt="SASEC Engineering"
            style={{ height: 52, width: 'auto', objectFit: 'contain' }}
          />
          <div className="f-mono text-right text-[9px] leading-[1.7] text-[#94A3B8] pt-1">
            <div>FORM EMS-01</div>
            <div>ACCESS CONTROL</div>
          </div>
        </div>

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

        {/* Hint */}
        <p className="f-mono mt-4 text-center text-[10px] tracking-[0.08em] text-[#94A3B8]">
          DEFAULT PASSCODE — <span className="font-semibold text-[#64748B]">SASEC@XXXX</span>
        </p>

        {/* Title block footer */}
        <div className="f-mono mt-6 grid grid-cols-3 divide-x divide-[#E2E8F0] rounded-md border border-[#E2E8F0] overflow-hidden text-center text-[8px] tracking-[0.14em] leading-[1.7] text-[#94A3B8]">
          <div className="px-1 py-2">SASEC ENGG.<br />PVT. LTD.</div>
          <div className="px-1 py-2">DOC<br />EMS-01 · R2</div>
          <div className="px-1 py-2">SITE<br />JSW STEEL</div>
        </div>
        <p className="mt-3 text-center text-[9px] tracking-wide text-[#CBD5E1]">
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

        /* Ambient sketch motion — restrained, slow */
        .crane-slew {
          transform-origin: 124px 156px;
          animation: craneSlew 18s ease-in-out infinite;
        }
        @keyframes craneSlew {
          0%, 100% { transform: rotate(-1.2deg); }
          50%      { transform: rotate(1.4deg); }
        }
        .hook-sway {
          transform-origin: 260px 154px;
          animation: hookSway 5.5s ease-in-out infinite;
        }
        @keyframes hookSway {
          0%, 100% { transform: rotate(-2.2deg); }
          50%      { transform: rotate(2.2deg); }
        }
        .dim-draw {
          stroke-dasharray: 420;
          animation: dimDraw 12s linear infinite;
        }
        @keyframes dimDraw {
          0%   { stroke-dashoffset: 420; opacity: 1; }
          22%  { stroke-dashoffset: 0; }
          80%  { stroke-dashoffset: 0; opacity: 1; }
          90%  { stroke-dashoffset: 0; opacity: 0; }
          91%  { stroke-dashoffset: 420; opacity: 0; }
          100% { stroke-dashoffset: 420; opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .crane-slew, .hook-sway, .dim-draw { animation: none !important; }
          .dim-draw { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}
