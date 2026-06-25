// ============================================================
// Payroll engine — pure functions. Source of truth = attendance
// rows × profiles.daily_rate. Nothing is written to the database
// by the payroll view (read-only).
// ============================================================

export const PAYROLL_CONFIG = {
  PF_RATE: 0.12, // Provident Fund — employee share
  ESI_RATE: 0.0075, // Employee State Insurance — employee share
  PT_MONTHLY: 200, // Professional Tax flat, per month
  PT_WEEKLY: 50, // Apportioned PT for weekly runs (₹200 / 4 weeks)
}

export const PAYROLL_MODE = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
}

// --- Date helpers (all use local timezone) ------------------

function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocal(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Monday=0, Tuesday=1, ..., Sunday=6
function isoDayIndex(date) {
  const d = date.getDay() // JS: 0=Sun..6=Sat
  return d === 0 ? 6 : d - 1
}

// Monday → Sunday week containing `ref` (Date or YYYY-MM-DD)
export function weekRange(ref) {
  const d = ref instanceof Date ? new Date(ref) : parseLocal(ref)
  d.setHours(0, 0, 0, 0)
  const offset = isoDayIndex(d)
  const start = new Date(d)
  start.setDate(d.getDate() - offset)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: toISO(start), end: toISO(end) }
}

// Calendar month containing `ref`
export function monthRange(ref) {
  const d = ref instanceof Date ? new Date(ref) : parseLocal(ref)
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { start: toISO(start), end: toISO(end) }
}

export function shiftWeek(periodStartISO, weeks) {
  const d = parseLocal(periodStartISO)
  d.setDate(d.getDate() + weeks * 7)
  return weekRange(d)
}

export function shiftMonth(periodStartISO, months) {
  const d = parseLocal(periodStartISO)
  d.setMonth(d.getMonth() + months)
  return monthRange(d)
}

export function formatRangeLabel(range, mode) {
  const start = parseLocal(range.start)
  const end = parseLocal(range.end)
  if (mode === PAYROLL_MODE.MONTHLY) {
    return start.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    })
  }
  const sameYear = start.getFullYear() === end.getFullYear()
  const startStr = start.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  )
  const endStr = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startStr} – ${endStr}`
}

// --- Currency -----------------------------------------------

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

export function formatCurrency(n) {
  return inrFormatter.format(Number(n) || 0)
}

// --- Computation --------------------------------------------

/**
 * Standard working days used to convert a monthly-fixed salary to a daily rate.
 * (26 days = Indian statutory norm for monthly-to-daily conversion.)
 */
export const MONTHLY_WORKING_DAYS = 26

/**
 * Return the effective daily rate given a designation's wage and type.
 *
 * - 'daily_rate'    → wage is already per day; returned as-is.
 * - 'monthly_fixed' → wage is a monthly salary; divide by 26 to get
 *                     an equivalent daily rate so attendance-based
 *                     deductions (LOP) still apply correctly.
 */
export function effectiveDailyRate(wage, wageType) {
  const w = Number(wage) || 0
  if (wageType === 'monthly_fixed') return w / MONTHLY_WORKING_DAYS
  return w
}

/**
 * @param {Object}  opts
 * @param {number}  opts.dailyRate       — raw wage value from the worker's profile
 * @param {string}  [opts.wageType]      — 'daily_rate' (default) | 'monthly_fixed'
 * @param {Object<string,string>} opts.attendanceByDate  — { 'YYYY-MM-DD': 'present'|'absent'|'half_day' }
 * @param {Object<string,number>} [opts.otByDate]        — { 'YYYY-MM-DD': otHours }
 * @param {Object<string,string|null>} [opts.otStatusByDate] — { 'YYYY-MM-DD': 'pending'|'approved'|'rejected'|null }
 *                                                            null/undefined means auto-approved (OT ≤ 3).
 * @param {string}  opts.mode            — PAYROLL_MODE.WEEKLY | MONTHLY
 * @param {number}  [opts.advanceDeduction] — total advances taken in this period (deducted from net)
 *
 * OT formula:
 *   hourly_rate  = effective_daily / 8
 *   ot_pay       = total_ot_hours × 2 × hourly_rate
 *
 * Only OT with status NULL (auto-approved ≤3 hrs) or 'approved' counts.
 * Pending and rejected OT are excluded from payroll.
 *
 * Net = gross + OT pay − PF − ESI − PT − advance deductions
 */
export function computePayroll({
  dailyRate,
  wageType = 'daily_rate',
  attendanceByDate,
  otByDate = {},
  otStatusByDate = {},
  mode,
  advanceDeduction = 0,
}) {
  let present = 0
  let half = 0
  let absent = 0
  for (const status of Object.values(attendanceByDate || {})) {
    // On Duty is a paid full working day — counted alongside present.
    if (status === 'present' || status === 'on_duty') present += 1
    else if (status === 'half_day') half += 1
    else if (status === 'absent') absent += 1
  }
  const daysPaid = present + 0.5 * half
  const rate = effectiveDailyRate(dailyRate, wageType)
  const gross = daysPaid * rate

  // OT: 2× rate, computed on top of regular gross.
  // Only count OT that is auto-approved (NULL, i.e. ≤ 3 hrs) or boss-approved.
  // Pending and rejected OT contribute 0.
  const hourlyRate = rate / 8
  let totalOtHours = 0
  let pendingOtHours = 0
  for (const [date, hours] of Object.entries(otByDate || {})) {
    const h = Number(hours) || 0
    if (h <= 0) continue
    const status = otStatusByDate?.[date] ?? null
    if (status === null || status === 'approved') {
      totalOtHours += h
    } else if (status === 'pending' || status === 'pending_field_manager' || status === 'pending_boss') {
      pendingOtHours += h
    }
    // rejected → contributes nothing
  }
  const otPay = totalOtHours * 2 * hourlyRate

  const pf = gross * PAYROLL_CONFIG.PF_RATE
  const esi = gross * PAYROLL_CONFIG.ESI_RATE
  // PT only applies to monthly-wage workers. No PT when gross is zero —
  // avoids negative-net rows for non-working weeks.
  const pt =
    gross > 0 && wageType === 'monthly_fixed'
      ? mode === PAYROLL_MODE.MONTHLY
        ? PAYROLL_CONFIG.PT_MONTHLY
        : PAYROLL_CONFIG.PT_WEEKLY
      : 0
  const adv = Number(advanceDeduction) || 0
  const net = gross + otPay - pf - esi - pt - adv
  return {
    present,
    half,
    absent,
    daysPaid,
    gross,
    otPay,
    totalOtHours,
    pendingOtHours,
    pf,
    esi,
    pt,
    advanceDeduction: adv,
    net,
  }
}
