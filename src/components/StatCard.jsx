import { Link } from 'react-router-dom'
import CountUp from './CountUp'

/**
 * Premium light KPI card with animated number and tinted icon chip.
 *
 * @param {Function} icon      lucide-react icon component
 * @param {string}   label
 * @param {number}   value     numeric value (count-up target)
 * @param {string}   tone      'brand' | 'success' | 'warning' | 'error' | 'gold' | 'info'
 * @param {string}   sublabel  optional secondary text
 * @param {string}   prefix    e.g. "₹"
 * @param {number}   decimals  digits after decimal
 * @param {number}   delay     animation delay in ms
 * @param {string}   href      optional route — wraps card in a Link with hover lift
 */
const TONES = {
  brand:   { icon: '#C0272D', bg: '#FFF1F1', value: '#0F172A' },
  success: { icon: '#10B981', bg: '#D1FAE5', value: '#0F172A' },
  warning: { icon: '#F59E0B', bg: '#FEF3C7', value: '#0F172A' },
  error:   { icon: '#EF4444', bg: '#FEE2E2', value: '#0F172A' },
  info:    { icon: '#3B82F6', bg: '#DBEAFE', value: '#0F172A' },
  gold:    { icon: '#D97706', bg: '#FEF3C7', value: '#D97706' },
}

export default function StatCard({
  icon: Icon,
  label,
  value = 0,
  tone = 'brand',
  sublabel,
  prefix = '',
  suffix = '',
  decimals = 0,
  delay = 0,
  href,
}) {
  const t = TONES[tone] || TONES.brand

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
            {label}
          </p>
          <p
            className="mt-2 text-3xl font-bold leading-none num tabular-nums"
            style={{ color: t.value }}
          >
            <CountUp value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
          </p>
          {sublabel && (
            <p className="mt-1.5 text-xs text-[#94A3B8]">{sublabel}</p>
          )}
        </div>

        {Icon && (
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: t.bg }}
          >
            <Icon className="h-5 w-5" style={{ color: t.icon }} strokeWidth={2} />
          </div>
        )}
      </div>

      {/* Arrow shown only on clickable cards */}
      {href && (
        <div className="flex justify-end mt-3">
          <span
            className="text-xs font-semibold opacity-0 group-hover:opacity-100 transition-all duration-150 translate-x-0 group-hover:translate-x-0.5"
            style={{ color: t.icon }}
          >
            View →
          </span>
        </div>
      )}
    </>
  )

  if (href) {
    return (
      <Link
        to={href}
        className="card p-5 stagger block cursor-pointer group
          transition-all duration-200
          hover:-translate-y-0.5
          hover:shadow-[0_8px_24px_-6px_rgba(15,23,42,0.12),0_4px_8px_rgba(15,23,42,0.06)]
          hover:border-[#CBD5E1]"
        style={{ animationDelay: `${delay}ms` }}
      >
        {inner}
      </Link>
    )
  }

  return (
    <div
      className="card card-hover p-5 stagger"
      style={{ animationDelay: `${delay}ms` }}
    >
      {inner}
    </div>
  )
}
