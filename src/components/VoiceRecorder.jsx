import { useEffect, useRef, useState } from 'react'

/**
 * Tap-to-start / tap-to-stop voice recorder.
 *
 * Props:
 *   onChange(file: File | null) — called with the recorded File, or null when discarded.
 *   disabled — disable the control while parent is submitting.
 *
 * States:
 *   idle      → tap button to start recording
 *   acquiring → requesting microphone permission (async)
 *   recording → actively recording — pulsing red button + live timer
 *   recorded  → preview playback; supervisor can Discard or keep + send
 */

const MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
]

function getBestMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of MIME_PREFERENCE) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch { /* ignore */ }
  }
  return null
}

function mimeToExt(mimeType = '') {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  return 'webm'
}

function fmtDuration(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VoiceRecorder({ onChange, disabled = false, variant = 'default' }) {
  const [phase, setPhase] = useState('idle') // idle | acquiring | recording | recorded
  const [elapsed, setElapsed] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [permError, setPermError] = useState(null)

  const mrRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startMsRef = useRef(0)

  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
  }, [])

  if (!supported) return null

  // ── Main click handler (toggle start / stop) ───────────────

  const handleClick = async () => {
    if (disabled) return

    // If recording → stop it
    if (phase === 'recording') {
      clearInterval(timerRef.current)
      if (mrRef.current?.state !== 'inactive') mrRef.current.stop()
      return
    }

    // If not idle (acquiring / recorded) → ignore
    if (phase !== 'idle') return

    // Start a new recording
    setPermError(null)
    setPhase('acquiring')

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setPhase('idle')
      setPermError(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Allow it in browser settings and try again.'
          : 'Could not access microphone.',
      )
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    const mimeType = getBestMimeType()
    const mr = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)

    mr.ondataavailable = (ev) => {
      if (ev.data?.size > 0) chunksRef.current.push(ev.data)
    }

    mr.onstop = () => {
      const usedMime = mr.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: usedMime })
      const ext = mimeToExt(usedMime)
      const file = new File([blob], `voice-message.${ext}`, { type: usedMime })
      const url = URL.createObjectURL(blob)

      setElapsed(Math.floor((Date.now() - startMsRef.current) / 1000))
      setAudioUrl(url)
      setPhase('recorded')
      stream.getTracks().forEach((t) => t.stop())
      onChange(file)
    }

    mrRef.current = mr
    mr.start(100)
    startMsRef.current = Date.now()
    setPhase('recording')

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startMsRef.current) / 1000))
    }, 500)
  }

  // ── Discard ────────────────────────────────────────────────

  const discard = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setElapsed(0)
    setPhase('idle')
    onChange(null)
  }

  // ── Render: preview after recording ───────────────────────

  if (phase === 'recorded') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full pl-2.5 pr-3 py-1">
          <RecordingDot animate={false} />
          <span className="text-xs font-medium text-slate-700">Voice</span>
          <audio
            src={audioUrl}
            controls
            className="h-7"
            style={{ maxWidth: 180 }}
          />
          <span className="text-xs text-slate-500 tabular-nums">{fmtDuration(elapsed)}</span>
        </div>
        <button
          type="button"
          onClick={discard}
          className="text-xs font-medium text-rose-600 hover:text-rose-700 underline underline-offset-2"
        >
          Discard
        </button>
      </div>
    )
  }

  // ── Render: idle / acquiring / recording button ────────────

  const isRecording = phase === 'recording'
  const isAcquiring = phase === 'acquiring'

  // Inline icon variant — small mic button meant to sit inside a textarea.
  if (variant === 'inline-icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isAcquiring}
        className={[
          'inline-flex items-center justify-center h-8 w-8 rounded-md transition focus:outline-none',
          isRecording
            ? 'bg-[#C0272D] text-white shadow-sm ring-2 ring-rose-200'
            : isAcquiring
              ? 'text-slate-400 cursor-wait'
              : 'text-slate-500 hover:text-[#C0272D] hover:bg-slate-100 disabled:opacity-50',
        ].join(' ')}
        title={isRecording ? `Recording — ${fmtDuration(elapsed)} · tap to stop` : 'Record voice'}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isRecording ? <RecordingDot animate /> : <MicIcon />}
      </button>
    )
  }

  // Outline-slate variant — dark slate outlined button with mic icon.
  if (variant === 'outline-slate') {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled || isAcquiring}
          className={[
            'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
            'transition focus:outline-none select-none',
            isRecording
              ? 'bg-[#C0272D] border-[#C0272D] text-white shadow-sm ring-2 ring-rose-200'
              : isAcquiring
                ? 'border-slate-200 text-slate-400 cursor-wait'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50',
          ].join(' ')}
          title={isRecording ? 'Tap to stop recording' : 'Tap to start recording'}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        >
          {isRecording ? (
            <>
              <RecordingDot animate />
              <span className="tabular-nums min-w-[2.5rem]">{fmtDuration(elapsed)}</span>
              <span className="text-xs opacity-80">Tap to stop</span>
            </>
          ) : isAcquiring ? (
            <>
              <MicIcon />
              <span>Requesting mic…</span>
            </>
          ) : (
            <>
              <MicIcon />
              <span>Record voice</span>
            </>
          )}
        </button>
        {permError && (
          <p className="text-xs text-rose-600 max-w-xs">{permError}</p>
        )}
      </div>
    )
  }

  // Default variant (legacy callers)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isAcquiring}
        className={[
          'inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium',
          'transition-all focus:outline-none select-none',
          isRecording
            ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-300'
            : isAcquiring
              ? 'bg-slate-200 text-slate-400 cursor-wait'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95 disabled:opacity-50',
        ].join(' ')}
        title={isRecording ? 'Tap to stop recording' : 'Tap to start recording'}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isRecording ? (
          <>
            <RecordingDot animate />
            <span className="tabular-nums min-w-[2.5rem]">{fmtDuration(elapsed)}</span>
            <span className="text-xs opacity-80">Tap to stop</span>
          </>
        ) : isAcquiring ? (
          <>
            <MicIcon />
            <span>Requesting mic…</span>
          </>
        ) : (
          <>
            <MicIcon />
            <span>Record voice</span>
          </>
        )}
      </button>
      {permError && (
        <p className="text-xs text-rose-600 max-w-xs">{permError}</p>
      )}
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="w-4 h-4 flex-shrink-0"
    >
      <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
      <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
    </svg>
  )
}

function RecordingDot({ animate = true }) {
  return (
    <span className="relative flex h-3 w-3 flex-shrink-0">
      {animate && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${animate ? 'bg-white' : 'bg-sky-500'}`} />
    </span>
  )
}
