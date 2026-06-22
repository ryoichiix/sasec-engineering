import { useEffect, useState } from 'react'
import { ATTENDANCE_MODE, getAttendanceMode } from '../lib/settings'

/**
 * Shows a banner at the top of attendance pages so the supervisor /
 * boss always knows where today's data is coming from.
 *
 * - In biometric mode: a violet banner says attendance is auto-populated.
 *   Pass `supervisorOverride` to add a "manual override still works"
 *   note for the supervisor view.
 * - In manual mode: renders nothing (current behavior is the default).
 */
export default function AttendanceModeBanner({ supervisorOverride = false }) {
  const [mode, setMode] = useState(null)

  useEffect(() => {
    let isMounted = true
    getAttendanceMode().then((m) => { if (isMounted) setMode(m) })
    return () => { isMounted = false }
  }, [])

  if (mode !== ATTENDANCE_MODE.BIOMETRIC) return null

  return (
    <div className="mb-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 flex items-start gap-3">
      <span className="inline-flex h-2 w-2 mt-1.5 rounded-full bg-violet-500" />
      <div className="flex-1">
        <p className="font-medium">Biometric mode is active</p>
        <p className="text-xs text-violet-700 mt-0.5">
          Attendance is auto-populated from device punches.
          {supervisorOverride
            ? ' You can still manually override individual entries below if a worker punched at the wrong device or missed a punch.'
            : ''}
        </p>
      </div>
    </div>
  )
}
