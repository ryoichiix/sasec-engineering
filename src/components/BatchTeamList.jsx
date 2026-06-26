/**
 * Read-only list of Batch-Mode teams. Used inside a supervisor's Work Feed
 * card (Boss + Site-Incharge feeds) and reused on the supervisor's own
 * Today's Team page as a "what I submitted" summary. Each batch renders as a
 * sub-card: number, name, location, task chips, and worker count.
 */
export default function BatchTeamList({ batches, className = '' }) {
  if (!batches?.length) return null
  return (
    <div className={`px-5 pb-4 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
        Batches ({batches.length})
      </p>
      <div className="space-y-2">
        {batches.map((batch, idx) => (
          <div key={batch.id} className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-5 h-5 rounded-full bg-[#C0272D] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <span className="text-sm font-semibold text-gray-900">{batch.batch_name}</span>
              {batch.project_location && (
                <span className="text-xs text-gray-400">· {batch.project_location}</span>
              )}
            </div>
            {batch.tasks?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {batch.tasks.map((task) => (
                  <span
                    key={task}
                    className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full"
                  >
                    {task}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">
              {batch.assignments?.length || batch.worker_ids?.length || 0} workers
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
