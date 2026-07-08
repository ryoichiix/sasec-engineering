import { useEffect, useState } from 'react'

/**
 * SASEC splash — the nameplate is "plate-fitted": three diagonally-cut
 * plates slide together, tack-weld sparks flash along the seams, then the
 * whole screen lifts away like a shutter. ~1.9s total, honors
 * prefers-reduced-motion (static logo, simple fade).
 */
export default function SplashScreen({ onDone }) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const hold = reduced ? 850 : 1480
    const exit = reduced ? 320 : 430
    const t1 = setTimeout(() => setLeaving(true), hold)
    const t2 = setTimeout(() => onDone?.(), hold + exit)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onDone, reduced])

  return (
    <div
      className={`splash-root fixed inset-0 z-50 flex items-center justify-center ${
        leaving ? 'splash-leave' : ''
      } ${reduced ? 'splash-reduced' : ''}`}
      style={{ background: '#0F172A' }}
      aria-hidden="true"
    >
      {/* Blueprint grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* Faint heat glow behind the plate */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 48%, rgba(192,39,45,0.10) 0%, transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* The nameplate, assembled from three plate pieces */}
        <div className="splash-plate relative" style={{ width: 172, height: 172 }}>
          <div className="splash-plate-backing absolute inset-0" />
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`splash-piece splash-piece-${i} absolute inset-0 bg-white flex items-center justify-center`}
            >
              <img
                src="/logo.png"
                alt=""
                draggable="false"
                style={{ width: 132, height: 'auto' }}
              />
            </div>
          ))}
          {/* Weld seams + tack sparks */}
          <div className="splash-seam splash-seam-a" />
          <div className="splash-seam splash-seam-b" />
          <div className="splash-spark splash-spark-1" />
          <div className="splash-spark splash-spark-2" />
          <div className="splash-spark splash-spark-3" />
        </div>

        <div className="splash-rule mt-7 h-[2px] w-24 rounded-full bg-[#C0272D]" />
        <p
          className="splash-caption mt-4 text-[10px] tracking-[0.32em] text-slate-400 text-center px-6"
          style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}
        >
          STRUCTURAL FABRICATION · PLANT ERECTION
        </p>
      </div>

      <style>{`
        .splash-root {
          transition: transform 0.43s cubic-bezier(0.7, 0, 0.28, 1), opacity 0.43s ease;
          will-change: transform;
        }
        .splash-leave { transform: translateY(-100%); }
        .splash-reduced.splash-leave { transform: none; opacity: 0; }

        .splash-plate-backing {
          background: #fff;
          opacity: 0;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
          animation: splashBackingIn 0.35s ease 0.6s forwards;
        }
        @keyframes splashBackingIn { to { opacity: 1; } }

        .splash-piece {
          opacity: 0;
          will-change: transform;
          animation: splashPieceIn 0.62s cubic-bezier(0.18, 0.9, 0.24, 1) both;
        }
        .splash-piece-0 {
          clip-path: polygon(0 0, 100% 0, 100% 34%, 0 46%);
          --dx: -46px; --dy: -30px;
          animation-delay: 0.05s;
        }
        .splash-piece-1 {
          clip-path: polygon(0 46%, 100% 34%, 100% 73%, 0 82%);
          --dx: 52px; --dy: 6px;
          animation-delay: 0.17s;
        }
        .splash-piece-2 {
          clip-path: polygon(0 82%, 100% 73%, 100% 100%, 0 100%);
          --dx: -34px; --dy: 40px;
          animation-delay: 0.29s;
        }
        @keyframes splashPieceIn {
          from { transform: translate(var(--dx), var(--dy)); opacity: 0; }
          to   { transform: translate(0, 0); opacity: 1; }
        }

        .splash-seam {
          position: absolute;
          left: -6%;
          width: 112%;
          height: 2px;
          opacity: 0;
          filter: blur(0.4px);
          background: linear-gradient(90deg, transparent, rgba(252, 211, 77, 0.95), rgba(255, 255, 255, 0.9), rgba(252, 211, 77, 0.95), transparent);
        }
        .splash-seam-a { top: 40%; transform: rotate(-4deg); animation: splashSeamFlash 0.5s ease-out 0.58s; }
        .splash-seam-b { top: 77.5%; transform: rotate(3deg); animation: splashSeamFlash 0.5s ease-out 0.76s; }
        @keyframes splashSeamFlash {
          0% { opacity: 0; }
          25% { opacity: 1; }
          100% { opacity: 0; }
        }

        .splash-spark {
          position: absolute;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #FDE68A;
          box-shadow: 0 0 14px 4px rgba(251, 191, 36, 0.85);
          opacity: 0;
        }
        .splash-spark-1 { top: 39%; right: -2px; animation: splashSpark 0.34s ease-out 0.6s; }
        .splash-spark-2 { top: 45%; left: -2px; animation: splashSpark 0.3s ease-out 0.76s; }
        .splash-spark-3 { top: 78%; right: 22%; animation: splashSpark 0.34s ease-out 0.9s; }
        @keyframes splashSpark {
          0% { opacity: 0; transform: scale(0.4); }
          30% { opacity: 1; transform: scale(1.3); }
          100% { opacity: 0; transform: scale(0.5); }
        }

        .splash-rule {
          transform: scaleX(0);
          animation: splashRuleIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.8s forwards;
        }
        @keyframes splashRuleIn { to { transform: scaleX(1); } }

        .splash-caption {
          opacity: 0;
          animation: splashCaptionIn 0.5s ease 0.92s forwards;
        }
        @keyframes splashCaptionIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .splash-reduced .splash-piece,
        .splash-reduced .splash-plate-backing,
        .splash-reduced .splash-rule,
        .splash-reduced .splash-caption {
          animation: none;
          opacity: 1;
          transform: none;
        }
        .splash-reduced .splash-seam,
        .splash-reduced .splash-spark { display: none; }

        @media (prefers-reduced-motion: reduce) {
          .splash-piece, .splash-plate-backing, .splash-rule, .splash-caption {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
          .splash-seam, .splash-spark { display: none !important; }
        }
      `}</style>
    </div>
  )
}
