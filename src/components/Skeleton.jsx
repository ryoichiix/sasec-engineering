/**
 * Skeleton placeholder block. Composes the .skeleton shimmer class.
 */
export function Skeleton({ className = '', style }) {
  return <div className={'skeleton ' + className} style={style} />
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={'space-y-2 ' + className}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  )
}

export function SkeletonStatCard() {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-11 w-11 rounded-xl" />
      </div>
    </div>
  )
}
