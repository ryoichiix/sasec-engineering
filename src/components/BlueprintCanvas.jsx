import { useLocation } from 'react-router-dom'
import IndustrialScene from './IndustrialScene'

/**
 * BlueprintCanvas — the app-wide industrial backdrop layer.
 *
 * Rendered once inside DashboardShell behind the page content. Applies:
 *  - the faint blueprint grid on every page
 *  - a steel-section accent strip (top-left, every page)
 *  - the route-appropriate IndustrialScene as a corner/edge decoration
 *
 * Everything is pointer-events-none and sits below content (content is
 * lifted with z-index in the shell). Scenes shrink and fade further on
 * mobile so they never compete with the work.
 */

const SCENE_MAP = [
  {
    match: (p) => p === '/boss' || p === '/supervisor',
    variant: 'dashboard',
    cls: 'bottom-1 right-1 w-[250px] h-[148px] sm:w-[400px] sm:h-[236px]',
  },
  {
    match: (p) => p.includes('attendance'),
    variant: 'attendance',
    cls: 'bottom-1 right-1 w-[240px] h-[142px] sm:w-[360px] sm:h-[213px]',
  },
  {
    match: (p) => p.includes('work-feed') || p.includes('daily-updates'),
    variant: 'workfeed',
    cls: 'top-16 right-2 w-[220px] h-[130px] sm:w-[330px] sm:h-[195px]',
  },
  {
    match: (p) => p.includes('todays-plan') || p.includes('work-plan') || p.includes('team'),
    variant: 'planning',
    cls: 'bottom-1 right-1 w-[250px] h-[148px] sm:w-[390px] sm:h-[230px]',
  },
  {
    match: (p) => p.includes('advances') || p.includes('payroll'),
    variant: 'office',
    cls: 'bottom-1 right-1 w-[240px] h-[142px] sm:w-[370px] sm:h-[219px]',
  },
  {
    match: (p) => p.includes('vehicles'),
    variant: 'vehicles',
    cls: 'bottom-1 right-0 w-[260px] h-[154px] sm:w-[410px] sm:h-[242px]',
  },
  {
    match: (p) => p.includes('expenses'),
    variant: 'fuel',
    cls: 'bottom-1 right-1 w-[240px] h-[142px] sm:w-[380px] sm:h-[225px]',
  },
  {
    match: (p) => p.includes('weight'),
    variant: 'weight',
    cls: 'bottom-1 right-1 w-[240px] h-[142px] sm:w-[370px] sm:h-[219px]',
  },
  {
    match: (p) => p.includes('leave') || p.includes('approvals') || p.includes('requests'),
    variant: 'approvals',
    cls: 'bottom-1 right-1 w-[240px] h-[142px] sm:w-[370px] sm:h-[219px]',
  },
]

export default function BlueprintCanvas() {
  const { pathname } = useLocation()
  const scene = SCENE_MAP.find((s) => s.match(pathname))

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* unifying blueprint grid, ~4% ink */}
      <div className="bp-grid-light absolute inset-0" />

      {/* steel-section accent strip, top-left of the work area */}
      <IndustrialScene
        variant="beams"
        className="absolute top-16 left-3 w-[110px] h-[42px] sm:w-[150px] sm:h-[57px] text-slate-500 opacity-[0.09]"
      />

      {/* page-specific scene */}
      {scene && (
        <IndustrialScene
          variant={scene.variant}
          className={`absolute text-slate-500 opacity-[0.11] sm:opacity-[0.16] ${scene.cls}`}
        />
      )}
    </div>
  )
}
