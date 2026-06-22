/**
 * Glowing status pill. Use for Present/Absent/Pending/Approved/Rejected.
 *
 * @param {string} tone — 'success' | 'error' | 'warning' | 'info' | 'gold' | 'brand' | 'neutral'
 */
const TONE_CLASS = {
  success: 'badge-success',
  error:   'badge-error',
  warning: 'badge-warning',
  info:    'badge-info',
  gold:    'badge-gold',
  brand:   'badge-brand',
  neutral: 'badge-neutral',
}

export default function StatusBadge({ tone = 'neutral', pulse = false, children, className = '' }) {
  return (
    <span
      className={
        'badge ' +
        (TONE_CLASS[tone] || TONE_CLASS.neutral) +
        (pulse ? ' animate-pulse-soft' : '') +
        ' ' + className
      }
    >
      {children}
    </span>
  )
}
