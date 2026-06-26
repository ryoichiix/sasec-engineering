import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, Plus, Pencil } from 'lucide-react'
import Toast from './Toast'
import { fetchSiteReport, saveSiteReport } from '../lib/work-plans'
import { formatDate } from '../lib/dates'
import { supabase } from '../lib/supabase'

function to12hr(time24) {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// ── Pre-loaded combobox options ────────────────────────────
const PROJECT_OPTIONS = [
  'SGP - EAST - TOWER HOUSE',
  'SGP - WEST - TOWER HOUSE',
  'SGP - EAST - GB001',
  'SGP - EAST - GB01/A',
  'SGP - WEST - GB002',
  'SGP - WEST - GB02/A',
]
const LOCATION_OPTIONS = ['BF#3', 'BF#4', 'BF#5', 'COKE#1', 'MRP', 'SINTER PLANT #3']
const TASK_SUGGESTIONS = [
  'Erection of columns',
  'Welding of Base Plates',
  'Fabrication',
  'Dismantling',
  'Welding',
  'Shifting',
  'Scrap Shifting',
  'Loading',
  'Painting',
  'Inspection',
  'Grouting',
  'Punch Points',
  'Attending Punch Points',
]
const OT_TIMES = [
  '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM',
  '10:00 PM', '11:00 PM', '12:00 AM', '1:00 AM', '2:00 AM',
  '3:00 AM', '4:00 AM', '5:00 AM', '6:00 AM', '7:00 AM', '8:00 AM',
]

/**
 * Structured daily site report. Persisted as JSON in the existing
 * work_plans.morning_plan text column (no schema change). Parent passes
 * key={date} so it remounts with fresh state when the date changes.
 *
 * Shows a read-only summary when a plan already exists for the date (with an
 * Edit button), and the editable form otherwise — this prevents accidental
 * re-saves overwriting a submitted plan.
 *
 * Props:
 *   date                 'YYYY-MM-DD'
 *   supervisorId         uuid
 *   permitHolderDefault  supervisor's name (pre-fills Permit Holder)
 *   team                 [{ id, full_name, designations?: { name } }]
 *   teamLoading          bool
 */
export default function DailySiteReport({ date, supervisorId, permitHolderDefault, team, teamLoading }) {
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState('edit') // 'view' | 'edit'

  // Section 1 — Project details
  const [projectDescription, setProjectDescription] = useState('')
  const [projectLocation, setProjectLocation] = useState('')
  // Section 2 — Permit & timing
  const [permitHolder, setPermitHolder] = useState(permitHolderDefault || '')
  const [workFrom, setWorkFrom] = useState('09:00')
  const [workTo, setWorkTo] = useState('18:00')
  const [overtime, setOvertime] = useState(false)
  const [otFrom, setOtFrom] = useState('')
  const [otTo, setOtTo] = useState('')
  // Section 3 — Equipment
  const [crane, setCrane] = useState('')
  const [hydra, setHydra] = useState('')
  const [cherryPicker, setCherryPicker] = useState('')
  const [trawler, setTrawler] = useState('')
  const [trawlerNotRequired, setTrawlerNotRequired] = useState(false)
  // Section 4 — Tasks
  const [tasks, setTasks] = useState(['', ''])

  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  // ── Vehicles (for equipment dropdowns) ─────────────────────
  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    supabase.from('vehicles').select('id, vehicle_no, vehicle_type, driver_name')
      .order('vehicle_type').then(({ data }) => setVehicles(data || []))
  }, [])
  const getVehiclesByType = (keyword) =>
    vehicles.filter((v) => v.vehicle_type?.toLowerCase().includes(keyword.toLowerCase()))

  // Load + pre-fill any previously saved report for this date.
  useEffect(() => {
    let active = true
    fetchSiteReport(supervisorId, date).then(({ data }) => {
      if (!active) return
      if (data) {
        setProjectDescription(data.project_description ?? '')
        setProjectLocation(data.project_location ?? '')
        setPermitHolder(data.permit_holder ?? permitHolderDefault ?? '')
        setWorkFrom(data.work_from ?? '09:00')
        setWorkTo(data.work_to ?? '18:00')
        setOvertime(!!data.overtime)
        setOtFrom(data.ot_from ?? '')
        setOtTo(data.ot_to ?? '')
        setCrane(data.equipment?.crane ?? '')
        setHydra(data.equipment?.hydra ?? '')
        setCherryPicker(data.equipment?.cherry_picker ?? '')
        setTrawler(data.equipment?.trawler ?? '')
        setTrawlerNotRequired(!!data.equipment?.trawler_not_required)
        const t = Array.isArray(data.tasks) ? data.tasks : []
        setTasks(t.length ? t : ['', ''])
        setMode('view') // already submitted → show summary first
      }
      setLoaded(true)
    })
    return () => { active = false }
  }, [supervisorId, date, permitHolderDefault])

  // ── Task helpers ──────────────────────────────────────────
  const setTask = (idx, value) => setTasks((prev) => prev.map((t, i) => (i === idx ? value : t)))
  const removeTask = (idx) => setTasks((prev) => prev.filter((_, i) => i !== idx))
  const addTask = () => setTasks((prev) => [...prev, ''])
  const addTaskFromChip = (text) =>
    setTasks((prev) => {
      const firstEmpty = prev.findIndex((t) => !t.trim())
      if (firstEmpty !== -1) return prev.map((t, i) => (i === firstEmpty ? text : t))
      return [...prev, text]
    })

  const cleanTasks = tasks.map((t) => t.trim()).filter(Boolean)

  // ── Save ──────────────────────────────────────────────────
  const save = async () => {
    const nextErrors = {}
    if (!projectDescription.trim()) nextErrors.project = 'Project description is required.'
    if (cleanTasks.length === 0) nextErrors.tasks = '⚠️ Please select at least one task from the list above, or add one manually.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    const report = {
      project_description: projectDescription.trim(),
      project_location: projectLocation.trim(),
      permit_holder: permitHolder.trim(),
      work_from: workFrom,
      work_to: workTo,
      overtime,
      ot_from: overtime ? otFrom : '',
      ot_to: overtime ? otTo : '',
      equipment: {
        crane: crane.trim(),
        hydra: hydra.trim(),
        cherry_picker: cherryPicker.trim(),
        trawler: trawlerNotRequired ? '' : trawler.trim(),
        trawler_not_required: trawlerNotRequired,
      },
      tasks: cleanTasks,
    }
    const { error } = await saveSiteReport(supervisorId, date, report)
    setSaving(false)
    if (error) {
      setToast({ type: 'error', message: error.message })
      return
    }
    setTasks(cleanTasks.length ? cleanTasks : ['', ''])
    setMode('view')
    setToast({ type: 'success', message: `Work plan saved for ${formatDate(date)}` })
  }

  if (!loaded) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4 text-sm text-slate-500">
        Loading work plan…
      </div>
    )
  }

  // ── Read-only summary ─────────────────────────────────────
  if (mode === 'view') {
    const equipmentRows = [
      ['Crane', crane],
      ['Hydra', hydra],
      ['Cherry Picker', cherryPicker],
      ['Trawler', trawlerNotRequired ? 'Not Required' : trawler],
    ].filter(([, v]) => v)

    return (
      <>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Work plan — {formatDate(date)}</h2>
          <button
            type="button"
            onClick={() => setMode('edit')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#C0272D] hover:text-red-800 border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>

        {/* Project & timing */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <SectionHeader>Project &amp; Timing</SectionHeader>
          <div className="space-y-2">
            <SummaryRow label="Description" value={projectDescription} />
            <SummaryRow label="Location" value={projectLocation} />
            <SummaryRow label="Permit holder" value={permitHolder} />
            <SummaryRow label="Timing" value={workFrom && workTo ? `${to12hr(workFrom)} – ${to12hr(workTo)}` : ''} />
            {overtime && (
              <div className="flex justify-between text-sm gap-4">
                <span className="text-amber-600">OT timing</span>
                <span className="font-medium text-amber-700 text-right">{otFrom || '—'} – {otTo || '—'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tasks */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <SectionHeader>Today&apos;s Work Plan</SectionHeader>
          {cleanTasks.length ? (
            <ul className="space-y-2">
              {cleanTasks.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full bg-green-50 text-green-600 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-400">No tasks listed.</p>}
        </div>

        {/* Equipment */}
        {equipmentRows.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
            <SectionHeader>Equipment</SectionHeader>
            <div className="space-y-2">
              {equipmentRows.map(([label, value]) => (
                <SummaryRow key={label} label={label} value={value} />
              ))}
            </div>
          </div>
        )}

        {/* Workmen */}
        <WorkmenSection team={team} teamLoading={teamLoading} />

        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    )
  }

  // ── Editable form ─────────────────────────────────────────
  return (
    <>
      {/* Section 1 — Project Details */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <SectionHeader>Project Details</SectionHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project description</label>
            <Combobox
              options={PROJECT_OPTIONS}
              value={projectDescription}
              onChange={setProjectDescription}
              placeholder="Search or type a project…"
            />
            {errors.project && <p className="text-xs text-rose-600 mt-1">{errors.project}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project location</label>
            <Combobox
              options={LOCATION_OPTIONS}
              value={projectLocation}
              onChange={setProjectLocation}
              placeholder="Search or type a location…"
            />
          </div>
        </div>
      </div>

      {/* Section 2 — Permit & Timing */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <SectionHeader>Permit &amp; Timing</SectionHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Permit holder</label>
            <input
              type="text"
              value={permitHolder}
              onChange={(e) => setPermitHolder(e.target.value)}
              placeholder="Permit holder name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Work timing</label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <span className="block text-xs text-gray-500 mb-1">From</span>
                <input
                  type="time"
                  value={workFrom}
                  onChange={(e) => setWorkFrom(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex-1">
                <span className="block text-xs text-gray-500 mb-1">To</span>
                <input
                  type="time"
                  value={workTo}
                  onChange={(e) => setWorkTo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Overtime toggle */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => setOvertime((v) => !v)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${overtime ? 'bg-[#C0272D]' : 'bg-gray-300'}`}
                aria-pressed={overtime}
              >
                <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transform transition-transform ${overtime ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm font-medium text-gray-700">Overtime planned?</span>
            </label>

            {overtime && (
              <div className="mt-3 space-y-3">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                  OT requires prior Director approval. Food &amp; consumables must be planned. Crane/Hydra/Trawler bookings needed.
                </div>
                <TimeChipPicker label="OT From" value={otFrom} onChange={setOtFrom} />
                <TimeChipPicker label="OT To" value={otTo} onChange={setOtTo} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 3 — Equipment */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <SectionHeader>Equipment</SectionHeader>
        <div className="space-y-4">
          <EquipmentSelect
            label="Crane"
            value={crane}
            onChange={setCrane}
            vehicles={[...getVehiclesByType('CRANE'), ...getVehiclesByType('BOOM LIFT')]}
          />
          <EquipmentSelect
            label="Hydra"
            value={hydra}
            onChange={setHydra}
            vehicles={getVehiclesByType('HYDRA')}
          />
          <EquipmentSelect
            label="Cherry Picker"
            value={cherryPicker}
            onChange={setCherryPicker}
            vehicles={vehicles.filter((v) => !['HYDRA', 'CRANE', 'LORRY', 'BOOM'].some((k) => v.vehicle_type?.toUpperCase().includes(k)))}
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-medium text-gray-700 w-full sm:w-28 flex-shrink-0">Trawler</span>
            <div className="flex-1 w-full">
              {trawlerNotRequired ? (
                <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-400 font-medium">
                  NOT REQUIRED
                </div>
              ) : (
                <select
                  value={trawler}
                  onChange={(e) => setTrawler(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                >
                  <option value="">Not required</option>
                  {getVehiclesByType('LORRY').map((v) => (
                    <option key={v.id} value={`${v.vehicle_type} — ${v.vehicle_no}`}>
                      {v.vehicle_type} — {v.vehicle_no} ({v.driver_name})
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-500 mt-1.5">
                <input
                  type="checkbox"
                  checked={trawlerNotRequired}
                  onChange={(e) => setTrawlerNotRequired(e.target.checked)}
                  className="accent-[#C0272D]"
                />
                Not required
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4 — Today's Work Plan */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <SectionHeader>Today&apos;s Work Plan</SectionHeader>

        {/* Quick-add chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {TASK_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTaskFromChip(s)}
              className="bg-gray-100 hover:bg-red-50 hover:text-red-700 text-gray-600 text-xs px-3 py-1 rounded-full cursor-pointer border border-gray-200"
            >
              + {s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {tasks.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-sm text-gray-400 w-5 flex-shrink-0 text-right">{idx + 1}.</span>
              <input
                type="text"
                value={t}
                onChange={(e) => setTask(idx, e.target.value)}
                placeholder="Describe a task…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {tasks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTask(idx)}
                  className="p-2 text-gray-300 hover:text-rose-600 transition flex-shrink-0"
                  aria-label="Remove task"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {errors.tasks && <p className="text-xs text-rose-600 mt-2">{errors.tasks}</p>}

        <button
          type="button"
          onClick={addTask}
          className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-[#C0272D] hover:text-red-800"
        >
          <Plus className="h-4 w-4" /> Add task
        </button>
      </div>

      {/* Section 5 — Workmen (read-only) */}
      <WorkmenSection team={team} teamLoading={teamLoading} />

      {/* Save */}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="bg-[#C0272D] hover:bg-red-800 disabled:opacity-60 text-white font-medium py-3 px-6 rounded-lg w-full mb-8 transition"
      >
        {saving ? 'Saving…' : 'Save Work Plan'}
      </button>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  )
}

// ── Local components ───────────────────────────────────────

function SectionHeader({ children }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-700 border-l-4 border-red-700 pl-3 mb-4">
      {children}
    </h3>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm gap-4">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value || '—'}</span>
    </div>
  )
}

function WorkmenSection({ team, teamLoading }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
      <SectionHeader>Workmen</SectionHeader>
      {teamLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !team?.length ? (
        <p className="text-sm text-gray-500">
          No team assigned yet.{' '}
          <Link to="/supervisor/team" className="text-[#C0272D] font-medium hover:underline">
            Go to Today&apos;s Team to pick workers.
          </Link>
        </p>
      ) : (
        <ol className="space-y-1">
          {team.map((w, idx) => (
            <li key={w.id} className="text-sm text-gray-700">
              <span className="text-gray-400">{idx + 1}.</span>{' '}
              {w.full_name || 'Unnamed'}
              {w.designations?.name && (
                <span className="text-gray-500"> ({w.designations.name})</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function TimeChipPicker({ label, value, onChange }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {OT_TIMES.map((time) => (
          <button
            key={time}
            type="button"
            onClick={() => onChange(time === value ? '' : time)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              value === time
                ? 'bg-[#C0272D] text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {time}
          </button>
        ))}
      </div>
      {value && <p className="text-xs text-gray-400 mt-1.5">Selected: {value}</p>}
    </div>
  )
}

function EquipmentSelect({ label, value, onChange, vehicles }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <span className="text-sm font-medium text-gray-700 w-full sm:w-28 flex-shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
      >
        <option value="">Not required</option>
        {vehicles.map((v) => (
          <option key={v.id} value={`${v.vehicle_type} — ${v.vehicle_no}`}>
            {v.vehicle_type} — {v.vehicle_no} ({v.driver_name})
          </option>
        ))}
      </select>
    </div>
  )
}

function Combobox({ options, value, onChange, placeholder }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const filtered = query === ''
    ? options
    : options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query || value}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={() => { onChange(opt); setQuery(''); setOpen(false) }}
              className="px-3 py-2 text-sm hover:bg-red-50 hover:text-red-700 cursor-pointer"
            >
              {opt}
            </div>
          ))}
          {query && !filtered.includes(query) && (
            <div
              onMouseDown={() => { onChange(query); setQuery(''); setOpen(false) }}
              className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer border-t"
            >
              + Use &quot;{query}&quot; as new entry
            </div>
          )}
        </div>
      )}
    </div>
  )
}
