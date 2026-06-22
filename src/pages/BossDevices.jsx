import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import {
  ATTENDANCE_MODE,
  getAttendanceMode,
  setAttendanceMode,
  relativeTime,
} from '../lib/settings'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const PUSH_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/biometric-push`
  : ''

export default function BossDevices() {
  const [mode, setMode] = useState(ATTENDANCE_MODE.MANUAL)
  const [modeSaving, setModeSaving] = useState(false)
  const [modeError, setModeError] = useState(null)

  const [devices, setDevices] = useState([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [devicesError, setDevicesError] = useState(null)

  const [newSerial, setNewSerial] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)

  const [refreshTick, setRefreshTick] = useState(0)

  // Load mode
  useEffect(() => {
    let isMounted = true
    getAttendanceMode().then((m) => {
      if (isMounted) setMode(m)
    })
    return () => { isMounted = false }
  }, [refreshTick])

  // Load devices — initial devicesLoading=true covers the first fetch;
  // subsequent refreshes via refreshTick re-enter with whatever was last shown.
  useEffect(() => {
    let isMounted = true
    supabase
      .from('biometric_devices')
      .select('id, serial_number, location, active, last_sync_at, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!isMounted) return
        if (error) {
          setDevicesError(error.message)
          setDevices([])
        } else {
          setDevicesError(null)
          setDevices(data || [])
        }
        setDevicesLoading(false)
      })
    return () => { isMounted = false }
  }, [refreshTick])

  // Poll device sync status every 15s so the boss sees fresh "last sync" values
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const toggleMode = async () => {
    const next =
      mode === ATTENDANCE_MODE.BIOMETRIC
        ? ATTENDANCE_MODE.MANUAL
        : ATTENDANCE_MODE.BIOMETRIC
    setModeSaving(true)
    setModeError(null)
    const { error } = await setAttendanceMode(next)
    setModeSaving(false)
    if (error) {
      setModeError(error.message)
      return
    }
    setMode(next)
  }

  const addDevice = async (e) => {
    e.preventDefault()
    if (!newSerial.trim() || !newLocation.trim()) {
      setAddError('Both serial number and location are required.')
      return
    }
    setAdding(true)
    setAddError(null)
    const { error } = await supabase.from('biometric_devices').insert({
      serial_number: newSerial.trim(),
      location: newLocation.trim(),
      active: true,
    })
    setAdding(false)
    if (error) {
      setAddError(error.message)
      return
    }
    setNewSerial('')
    setNewLocation('')
    setRefreshTick((t) => t + 1)
  }

  const toggleActive = async (device) => {
    const { error } = await supabase
      .from('biometric_devices')
      .update({ active: !device.active })
      .eq('id', device.id)
    if (!error) setRefreshTick((t) => t + 1)
  }

  const removeDevice = async (device) => {
    if (!window.confirm(`Remove "${device.location}" (${device.serial_number})?`)) {
      return
    }
    const { error } = await supabase
      .from('biometric_devices')
      .delete()
      .eq('id', device.id)
    if (!error) setRefreshTick((t) => t + 1)
  }

  const isBio = mode === ATTENDANCE_MODE.BIOMETRIC

  return (
    <DashboardShell title="Biometric devices" accent="bg-amber-500">
      <div className="space-y-6">
        {/* Mode toggle card */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Attendance source
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Manual mode is the safe fallback. Switch to biometric only
              after the device is online and workers are mapped.
            </p>
          </div>
          <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span
                className={
                  'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ' +
                  (isBio
                    ? 'bg-violet-100 text-violet-800 ring-violet-200'
                    : 'bg-slate-100 text-slate-700 ring-slate-200')
                }
              >
                {isBio ? 'Biometric mode' : 'Manual mode'}
              </span>
              <span className="text-xs text-slate-500">
                {isBio
                  ? 'Attendance is auto-populated from device punches.'
                  : 'Supervisors mark attendance manually.'}
              </span>
            </div>
            <button
              onClick={toggleMode}
              disabled={modeSaving}
              className={
                'text-sm font-medium px-4 py-2 rounded-md transition disabled:opacity-60 ' +
                (isBio
                  ? 'border border-slate-300 text-slate-700 hover:bg-slate-100'
                  : 'bg-violet-600 hover:bg-violet-700 text-white')
              }
            >
              {modeSaving
                ? 'Saving…'
                : isBio
                  ? 'Switch to Manual'
                  : 'Switch to Biometric'}
            </button>
          </div>
          {modeError && (
            <div className="px-6 pb-4 text-xs text-rose-600">{modeError}</div>
          )}
        </div>

        {/* Add device card */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Register a device
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              The serial number is printed on a sticker on the back of the
              K40. It must match exactly for the device's punches to be
              accepted.
            </p>
          </div>
          <form onSubmit={addDevice} className="px-6 py-5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Serial number
              </label>
              <input
                type="text"
                value={newSerial}
                onChange={(e) => setNewSerial(e.target.value)}
                placeholder="e.g. CJ7K204360001"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Location
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="e.g. Main Gate"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <button
              type="submit"
              disabled={adding}
              className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md transition"
            >
              {adding ? 'Adding…' : 'Add device'}
            </button>
            {addError && (
              <p className="sm:col-span-3 text-xs text-rose-600">{addError}</p>
            )}
          </form>
        </div>

        {/* Registered devices card */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Registered devices
            </h3>
            <span className="text-xs text-slate-400">
              {devices.length} total
            </span>
          </div>
          {devicesLoading ? (
            <div className="px-6 py-6 text-sm text-slate-500">Loading…</div>
          ) : devicesError ? (
            <div className="px-6 py-6 text-sm text-rose-600">{devicesError}</div>
          ) : devices.length === 0 ? (
            <div className="px-6 py-6 text-sm text-slate-500">
              No devices yet. Register one above when the K40 arrives.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {devices.map((d) => (
                <DeviceRow
                  key={d.id}
                  device={d}
                  onToggle={() => toggleActive(d)}
                  onRemove={() => removeDevice(d)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Endpoint URL card — copy this into the K40 menu */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Endpoint URL
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Use this in the K40's ADMS menu (Server Address + URL Path).
            </p>
          </div>
          <div className="px-6 py-5">
            <code className="block break-all text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-800">
              {PUSH_URL || '<set VITE_SUPABASE_URL in .env.local>'}
            </code>
            <ul className="text-xs text-slate-500 mt-3 space-y-1 list-disc list-inside">
              <li>Server Address: <span className="font-mono">{SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '') || '—'}</span></li>
              <li>Server Port: <span className="font-mono">443</span></li>
              <li>HTTPS: <span className="font-mono">Yes</span></li>
              <li>URL Path: <span className="font-mono">/functions/v1/biometric-push</span></li>
            </ul>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}

function DeviceRow({ device, onToggle, onRemove }) {
  const synced = device.last_sync_at
  // Compute age once per render. Date.now() is intentionally called here
  // inside a stable useMemo so the value doesn't change mid-render.
  const ageMs = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => (synced ? Date.now() - new Date(synced).getTime() : null),
    [synced]
  )
  // Green if seen in last 5 min, amber up to 1h, red older / never
  const dot =
    ageMs == null
      ? 'bg-rose-400'
      : ageMs < 5 * 60_000
        ? 'bg-emerald-500'
        : ageMs < 60 * 60_000
          ? 'bg-amber-400'
          : 'bg-rose-400'

  return (
    <li className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-slate-900">{device.location}</p>
          {!device.active && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
              disabled
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 font-mono">
          {device.serial_number}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className={'inline-block w-2 h-2 rounded-full ' + dot} />
        <span className="text-xs text-slate-600">
          Last sync: <span className="font-medium">{relativeTime(synced)}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="text-xs font-medium px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 transition"
        >
          {device.active ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={onRemove}
          className="text-xs font-medium px-2.5 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 transition"
        >
          Remove
        </button>
      </div>
    </li>
  )
}
