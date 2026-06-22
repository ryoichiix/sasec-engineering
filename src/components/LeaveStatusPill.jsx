import { LEAVE_STATUS_META } from '../lib/leave'

export default function LeaveStatusPill({ value }) {
  const meta = LEAVE_STATUS_META[value]
  if (!meta) {
    return <span className="text-xs text-slate-400">—</span>
  }
  return (
    <span
      className={
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ' +
        meta.pill
      }
    >
      {meta.label}
    </span>
  )
}
