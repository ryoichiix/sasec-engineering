import { PAYROLL_MODE } from '../lib/payroll'

export default function PeriodNavigator({
  mode,
  onModeChange,
  label,
  onPrev,
  onNext,
}) {
  const modeButton = (value, text) => {
    const selected = mode === value
    return (
      <button
        onClick={() => onModeChange(value)}
        className={
          'px-3 py-1.5 text-sm font-medium transition ' +
          (selected
            ? 'bg-slate-900 text-white'
            : 'bg-white text-slate-700 hover:bg-slate-50')
        }
      >
        {text}
      </button>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div className="inline-flex border border-slate-200 rounded-md overflow-hidden self-start">
        {modeButton(PAYROLL_MODE.WEEKLY, 'Weekly')}
        {modeButton(PAYROLL_MODE.MONTHLY, 'Monthly')}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          aria-label="Previous period"
          className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-100"
        >
          ←
        </button>
        <span className="text-sm font-medium text-slate-900 min-w-[200px] text-center">
          {label}
        </span>
        <button
          onClick={onNext}
          aria-label="Next period"
          className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-100"
        >
          →
        </button>
      </div>
    </div>
  )
}
