import { Inbox } from 'lucide-react'

/**
 * Illustrated empty state — used in place of "No data" plain text.
 */
export default function EmptyState({
  icon: Icon = Inbox,
  title = 'Nothing here yet',
  description,
  action,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4 bg-[#F1F5F9]">
        <Icon className="h-6 w-6 text-[#94A3B8]" strokeWidth={1.6} />
      </div>
      <p className="text-sm font-semibold text-[#0F172A]">{title}</p>
      {description && (
        <p className="mt-1.5 text-xs text-[#64748B] max-w-xs">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
