import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

let workersCache = null

async function loadWorkers() {
  // Sources strictly from public.workers — supervisors and directors live in
  // public.profiles and MUST NOT appear here. This is the permission boundary
  // that keeps a regular supervisor from picking another supervisor as the
  // subject of an advance request or attendance mark.
  if (workersCache) return workersCache
  const { data } = await supabase
    .from('workers')
    .select('id, full_name')
    .order('full_name')
  workersCache = data || []
  return workersCache
}

/**
 * Searchable worker picker — typing filters worker names in a dropdown;
 * clicking a suggestion resolves to that worker's id. Unlike
 * WorkerNameAutocomplete, this resolves to an id (for FK columns), not
 * free text.
 */
export default function WorkerPickerAutocomplete({ value, onChange, placeholder, required, className, disabled }) {
  const [workers, setWorkers] = useState([])
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    loadWorkers().then(setWorkers)
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
    ? workers.filter((w) => (w.full_name || '').toLowerCase().includes(query)).slice(0, 8)
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
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
              >
                {w.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
