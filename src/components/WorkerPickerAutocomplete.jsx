import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/auth-context'
import { fetchStaffIdentity, isDualRoleWorker } from '../lib/workers'

let workersCache = null
let staffCache = null

async function loadWorkers() {
  // Sources from public.workers. Some workers are also supervisors (dual-role
  // staff who do labor and are paid as workers) — they legitimately receive
  // advances, so they stay in the picker for a Site Incharge. A regular
  // supervisor cannot select them (filtered out below).
  if (workersCache) return workersCache
  const { data } = await supabase
    .from('workers')
    .select('id, full_name, designation_name')
    .order('full_name')
  workersCache = data || []
  return workersCache
}

async function loadStaff() {
  if (staffCache) return staffCache
  staffCache = await fetchStaffIdentity()
  return staffCache
}

/**
 * Searchable worker picker — typing filters worker names in a dropdown;
 * clicking a suggestion resolves to that worker's id. Unlike
 * WorkerNameAutocomplete, this resolves to an id (for FK columns), not
 * free text.
 */
export default function WorkerPickerAutocomplete({ value, onChange, placeholder, required, className, disabled }) {
  const { profile } = useAuth()
  // A regular supervisor (not Site Incharge, not Director) cannot raise an
  // advance for dual-role staff.
  const restrictedRole = profile?.role === 'supervisor' && profile?.field_manager !== true

  const [workers, setWorkers] = useState([])
  const [staff, setStaff] = useState({ ids: new Set(), names: new Set() })
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    loadWorkers().then(setWorkers)
    loadStaff().then(setStaff)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const query = text.trim().toLowerCase()
  const matches = query
    ? workers
        .filter((w) => (w.full_name || '').toLowerCase().includes(query))
        // Regular supervisors cannot pick dual-role staff; Site Incharge can.
        .filter((w) => !(restrictedRole && isDualRoleWorker(w, staff)))
        .slice(0, 8)
    : []

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        required={required}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          if (value) onChange('')
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {matches.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(w.id)
                  setText(w.full_name || '')
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {w.full_name}
                  {w.designation_name && (
                    <span className="text-slate-400"> ({w.designation_name})</span>
                  )}
                </span>
                {isDualRoleWorker(w, staff) && (
                  <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
                    Supervisor
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
