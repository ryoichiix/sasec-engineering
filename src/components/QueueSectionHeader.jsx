/**
 * Section header for the Site Incharge approval queues.
 * Title + optional count badge + hairline divider.
 */
export default function QueueSectionHeader({ title, count = 0 }) {
  return (
    <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400">{title}</h2>
      {count > 0 && (
        <span className="w-5 h-5 bg-[#C0272D] text-white text-xs font-bold rounded-full flex items-center justify-center">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  )
}

export function QueueEmptyState({ text = 'No pending requests' }) {
  return (
    <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-6 text-center mb-3">
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  )
}
