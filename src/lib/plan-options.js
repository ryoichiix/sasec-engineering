// Shared dropdown / chip options for the daily work plan, used by both the
// single-team form (TodaysPlan) and the Batch-Mode builder so the predefined
// choices stay identical across both flows.

export const PROJECT_OPTIONS = [
  'SGP - EAST - TOWER HOUSE',
  'SGP - WEST - TOWER HOUSE',
  'SGP - EAST - GB001',
  'SGP - EAST - GB01/A',
  'SGP - WEST - GB002',
  'SGP - WEST - GB02/A',
]

export const LOCATION_OPTIONS = ['BF#3', 'BF#4', 'BF#5', 'COKE#1', 'MRP', 'SINTER PLANT #3']

export const TASK_CHIPS = [
  'Erection of columns', 'Welding of Base Plates', 'Fabrication',
  'Dismantling', 'Welding', 'Shifting', 'Scrap Shifting',
  'Loading', 'Painting', 'Inspection', 'Grouting',
  'Punch Points', 'Attending Punch Points',
]

export const OT_TIMES = [
  '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM',
  '10:00 PM', '11:00 PM', '12:00 AM', '1:00 AM', '2:00 AM',
  '3:00 AM', '4:00 AM', '5:00 AM', '6:00 AM', '7:00 AM', '8:00 AM',
]

// ── Dynamic work timing + OT slots (Feature 1) ───────────────────────────────
// Default work start/end depend on the DAY OF WEEK of the selected date:
//   • Mon–Sat → 08:00 – 17:00
//   • Sunday  → 08:00 – 13:00
// These are DEFAULTS only — the supervisor can still override either field.
//
// `dateStr` is a local YYYY-MM-DD string (as produced by todayLocal / the date
// picker). We build the Date from its parts at LOCAL midnight — never
// `new Date(dateStr)`, which parses as UTC and can land on the wrong weekday
// for viewers behind UTC. Mirrors the parsing already used in dates.js.
export function defaultWorkTimes(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number)
  const isSunday = y && m && d ? new Date(y, m - 1, d).getDay() === 0 : false
  return { from: '08:00', to: isSunday ? '13:00' : '17:00' }
}

// Format a 24-hour hour (any integer; wraps past midnight) as a 12-hour display
// string matching the OT_TIMES style exactly, e.g. 17 → "5:00 PM", 0 → "12:00 AM".
function toDisplayHour(hour24) {
  const h = ((Math.trunc(hour24) % 24) + 24) % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}

// OT chip options, generated to START from the (possibly overridden) work end
// time instead of a fixed 5 PM. `endTime` is a 24-hour "HH:MM" string. Produces
// the same 16 hourly slots the app has always shown — so a weekday end of 17:00
// reproduces the old 5 PM … 8 AM list exactly, while Sunday's 13:00 end yields
// 1 PM … 4 AM. Returned as 12-hour display strings (the format the planned-OT
// approval chain stores and reads — do not change it).
export function generateOtTimes(endTime, count = 16) {
  const startHour = Number(String(endTime || '17:00').split(':')[0])
  const base = Number.isFinite(startHour) ? startHour : 17
  return Array.from({ length: count }, (_, i) => toDisplayHour(base + i))
}
