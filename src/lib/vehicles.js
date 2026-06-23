import { supabase } from './supabase'
import { notifyUser } from './notifications'

/**
 * Document-validity fields tracked per vehicle, with display labels.
 * Used by the Director Vehicles page and the expiry-notification check.
 */
export const VEHICLE_DOC_FIELDS = [
  { key: 'insurance_valid',    label: 'Insurance' },
  { key: 'pollution_valid',    label: 'Pollution Certificate' },
  { key: 'fitness_valid',      label: 'Fitness Certificate' },
  { key: 'tax_valid',          label: 'Tax' },
  { key: 'permit_valid',       label: 'Permit' },
  { key: 'gate_pass_validity', label: 'Gate Pass' },
  { key: 'agreement_valid',    label: 'Agreement' },
  { key: 'licence_valid',      label: 'Licence' },
]

// Subset that drives Director expiry notifications (mirrors the spec list —
// Agreement is shown on the page but not alerted on).
const NOTIFY_DOC_FIELDS = VEHICLE_DOC_FIELDS.filter((d) => d.key !== 'agreement_valid')

/** 'expired' | 'expiring' (≤30 days) | 'valid' | 'unknown' (no date). */
export function getExpiryStatus(dateStr) {
  if (!dateStr) return 'unknown'
  const expiry = new Date(dateStr)
  const today = new Date()
  const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
  if (diff < 0) return 'expired'
  if (diff <= 30) return 'expiring'
  return 'valid'
}

/**
 * Fetch all vehicles. Fails gracefully — returns [] if the table is missing
 * or any error occurs, so callers never have to handle the error case.
 */
export async function fetchVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .order('s_no', { ascending: true })
  if (error) return []
  return data || []
}

/**
 * Director-only: scan every vehicle's documents and create a notification
 * for each one that has expired or expires within 30 days. A once-per-day
 * dedupe (by title) prevents spam across repeated dashboard loads/logins.
 *
 * Notifications are written through the SECURITY DEFINER `notify_user` RPC
 * (same path the rest of the app uses), targeting the Director's own id.
 */
export async function checkVehicleExpiry(userId) {
  if (!userId) return

  const { data: vehicles, error } = await supabase.from('vehicles').select('*')
  if (error || !vehicles) return // table not seeded yet → silently skip

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const thirtyDaysLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  const expiringDocs = []
  for (const vehicle of vehicles) {
    for (const doc of NOTIFY_DOC_FIELDS) {
      if (!vehicle[doc.key]) continue
      const expiry = new Date(vehicle[doc.key])
      if (expiry < today) {
        expiringDocs.push({
          vehicle_no: vehicle.vehicle_no,
          vehicle_type: vehicle.vehicle_type,
          doc: doc.label,
          expiry: vehicle[doc.key],
          daysLeft: 0,
          expired: true,
        })
      } else if (expiry <= thirtyDaysLater) {
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
        expiringDocs.push({
          vehicle_no: vehicle.vehicle_no,
          vehicle_type: vehicle.vehicle_type,
          doc: doc.label,
          expiry: vehicle[doc.key],
          daysLeft,
          expired: false,
        })
      }
    }
  }
  if (expiringDocs.length === 0) return

  // Single query for today's existing vehicle-expiry titles → dedupe set.
  const { data: existing } = await supabase
    .from('notifications')
    .select('title')
    .eq('user_id', userId)
    .eq('type', 'vehicle_expiry')
    .gte('created_at', todayStr)
  const seen = new Set((existing || []).map((n) => n.title))

  for (const item of expiringDocs) {
    const title = item.expired
      ? `Vehicle document EXPIRED — ${item.vehicle_no}`
      : `Vehicle document expiring in ${item.daysLeft} day${item.daysLeft !== 1 ? 's' : ''} — ${item.vehicle_no}`
    if (seen.has(title)) continue

    const message = `${item.doc} for ${item.vehicle_type} (${item.vehicle_no}) ${
      item.expired
        ? 'has expired'
        : `expires on ${new Date(item.expiry).toLocaleDateString('en-IN')}`
    }.`

    await notifyUser({ userId, title, message, type: 'vehicle_expiry' })
    seen.add(title)
  }
}
