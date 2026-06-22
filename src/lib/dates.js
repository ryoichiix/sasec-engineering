// Return today's date as YYYY-MM-DD in the user's local timezone.
export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Pretty-print a full ISO timestamp as "7:42 AM · May 28" (omits year if same year).
export function formatDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const date = d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${time} · ${date}`
}

// Pretty-print just the time portion of an ISO timestamp (e.g. "7:42 AM").
export function formatTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Pretty-print a YYYY-MM-DD string (or ISO timestamp's date part).
export function formatDate(input) {
  if (!input) return ''
  const iso = String(input).slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
