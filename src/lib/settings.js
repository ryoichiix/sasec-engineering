import { supabase } from './supabase'

export const ATTENDANCE_MODE = {
  MANUAL: 'manual',
  BIOMETRIC: 'biometric',
}

/**
 * Read the current attendance mode. Returns 'manual' as a safe default
 * when the row is missing or unreadable, so the system always falls
 * back to the manual-marking flow.
 */
export async function getAttendanceMode() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'attendance_mode')
    .maybeSingle()
  if (error || !data) return ATTENDANCE_MODE.MANUAL
  const v = typeof data.value === 'string' ? data.value : data.value
  return v === ATTENDANCE_MODE.BIOMETRIC
    ? ATTENDANCE_MODE.BIOMETRIC
    : ATTENDANCE_MODE.MANUAL
}

/**
 * Boss-only: switch mode. Writes the JSON scalar (e.g. "biometric")
 * directly into app_settings.value (jsonb).
 */
export async function setAttendanceMode(mode) {
  const value =
    mode === ATTENDANCE_MODE.BIOMETRIC
      ? ATTENDANCE_MODE.BIOMETRIC
      : ATTENDANCE_MODE.MANUAL
  return await supabase
    .from('app_settings')
    .upsert({ key: 'attendance_mode', value }, { onConflict: 'key' })
}

/** Pretty "x minutes ago" for the sync indicator. */
export function relativeTime(iso) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
