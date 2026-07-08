/**
 * IndustrialLoader — blueprint-style loading indicator: a line-drawn gear
 * turning steadily, with an optional mono caption. Replaces generic
 * spinners on page-level loading states. Honors prefers-reduced-motion.
 */
export default function IndustrialLoader({ size = 26, label = 'Loading…', className = '' }) {
  return (
    <div
      className={`flex items-center gap-2.5 text-slate-500 ${className}`}
      role="status"
      aria-live="polite"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="il-gear flex-shrink-0"
      >
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="16" cy="16" r="8" />
          {/* teeth */}
          <path d="M16 7V3.2M16 25V28.8M7 16H3.2M25 16H28.8" />
          <path d="M9.6 9.6L6.9 6.9M22.4 9.6L25.1 6.9M9.6 22.4L6.9 25.1M22.4 22.4L25.1 25.1" />
          <circle cx="16" cy="16" r="2.6" />
        </g>
      </svg>
      {label && (
        <span className="f-mono text-[11px] tracking-[0.18em] uppercase">{label}</span>
      )}
      <style>{`
        .il-gear { animation: ilGearSpin 1.7s linear infinite; }
        @keyframes ilGearSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .il-gear { animation: none; } }
      `}</style>
    </div>
  )
}
