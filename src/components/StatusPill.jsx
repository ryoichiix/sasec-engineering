import { statusMeta } from '../lib/attendance'

export default function StatusPill({ value }) {
  const meta = statusMeta(value)
  if (!meta) {
    return <span className="text-xs text-slate-400">— Not marked</span>
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
