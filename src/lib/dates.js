// Return today's date as YYYY-MM-DD in the user's local timezone.
export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Convert any Supabase UTC timestamp to a full IST date+time string,
// e.g. "23 Jun 2026, 2:30 PM" — always Asia/Kolkata regardless of the
// viewer's own device timezone.
export function toIST(utcString) {
  if (!utcString) return ''
  const d = new Date(utcString)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

// The IST calendar date (YYYY-MM-DD) for a UTC timestamp — use this instead
// of `String(iso).slice(0, 10)` when grouping/bucketing by day, since
// slicing the raw UTC string can land on the wrong day for times shortly
// after midnight IST (IST is UTC+5:30).
export function toISTDateKey(utcString) {
  if (!utcString) return ''
  const d = new Date(utcString)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // en-CA → YYYY-MM-DD
}

// Pretty-print a full ISO timestamp as "7:42 AM · May 28" (omits year if same year), in IST.
export function formatDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const date = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }),
  })
  return `${time} · ${date}`
}

// Pretty-print just the time portion of an ISO timestamp (e.g. "7:42 AM"), in IST.
export function formatTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
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
