import { Link } from 'react-router-dom'

export default function DashboardNav({ items }) {
  if (!items?.length) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className="group block bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-brand/30 transition-all"
        >
          {/* Red left accent bar */}
          <span className="block w-8 h-0.5 bg-brand mb-3 rounded-full transition-all group-hover:w-12" />
          <h3 className="text-sm font-semibold text-slate-900 group-hover:text-brand transition-colors">
            {it.title}
          </h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{it.description}</p>
        </Link>
      ))}
    </div>
  )
}
