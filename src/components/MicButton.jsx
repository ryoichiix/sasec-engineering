import { useRef, useState } from 'react'

const LANGS = [
  { code: 'en-IN', label: 'EN' },
  { code: 'te-IN', label: 'TE' },
]

/**
 * Self-contained voice-input button — English + Telugu.
 *
 * Props:
 *   onTranscript(text: string) — called with each new chunk of committed text.
 *                                Caller appends it to their text state.
 *
 * Telugu-specific fixes applied here:
 *   1. Any interim text that was never finalized by the engine (common in Telugu
 *      due to longer processing time) is committed to onTranscript before each
 *      recognition restart so it is never lost.
 *   2. The interim preview is NOT cleared between restarts — the user sees a
 *      continuous stream with no visible gap.
 *   3. We use a ref (interimRef) to track unfinalized text across restarts;
 *      state (interim) is only for display.
 *
 * Renders nothing if the browser doesn't support SpeechRecognition.
 */
export default function MicButton({ onTranscript }) {
  const [langIdx, setLangIdx] = useState(0)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')   // display-only live preview
  const [error, setError] = useState(null)

  // Whether the user wants to keep listening (vs browser stopping on silence)
  const shouldContinueRef = useRef(false)
  // Current unfinalized text inside the active recognition session.
  // Saved here so onend can commit it before restarting.
  const interimRef = useRef('')
  const recRef = useRef(null)

  const SR =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null

  if (!SR) return null

  const lang = LANGS[langIdx]

  const cycleLang = (e) => {
    e.stopPropagation()
    if (listening) return
    setLangIdx((i) => (i + 1) % LANGS.length)
  }

  const startRecognition = () => {
    const rec = new SR()
    rec.lang = lang.code
    rec.continuous = true        // don't stop after one utterance
    rec.interimResults = true    // fire onresult while the user is still speaking
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setListening(true)
      setError(null)
    }

    rec.onresult = (e) => {
      // e.resultIndex = first result that is new in this event.
      // Iterate only from there to avoid re-processing already-committed finals.
      let newFinals = ''
      let currentInterim = ''

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          newFinals += r[0].transcript
        } else {
          currentInterim += r[0].transcript
        }
      }

      if (newFinals) {
        // Commit finalized text to the text box immediately
        onTranscript(newFinals)
        // Clear the interimRef since finals have now replaced it
        interimRef.current = ''
      }

      // Always overwrite interimRef with the current session's interim.
      // This is correct within a session — each onresult gives us the full
      // current interim for the in-progress utterance.
      interimRef.current = currentInterim
      setInterim(currentInterim)
    }

    rec.onend = () => {
      if (shouldContinueRef.current) {
        // ── Telugu fix: commit any unfinalized interim before restarting ──
        // The engine ended the session (silence timeout) without finalizing
        // the last utterance. If we don't commit it here it is lost forever.
        const pending = interimRef.current.trim()
        if (pending) {
          onTranscript(pending + ' ')
          interimRef.current = ''
          setInterim('')
        }
        // If nothing pending, keep the interim display as-is so the user
        // sees no blank gap during the restart handoff.

        // Auto-restart
        try {
          rec.start()
        } catch {
          // start() can throw synchronously on some browsers if called
          // too quickly after onend — retry after a brief pause.
          setTimeout(() => {
            if (shouldContinueRef.current) {
              try { rec.start() } catch { /* ignore */ }
            }
          }, 150)
        }
      } else {
        // User tapped stop (or fatal error set shouldContinue = false).
        // Commit any remaining interim so nothing is lost.
        const pending = interimRef.current.trim()
        if (pending) {
          onTranscript(pending)
        }
        interimRef.current = ''
        setInterim('')
        setListening(false)
      }
    }

    rec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        // Fatal — user denied mic; don't attempt to restart
        shouldContinueRef.current = false
        setError('Microphone access denied.')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        // 'no-speech' and 'aborted' are benign; onend will handle the restart.
        // For any other error, show a message but still let onend decide.
        setError(`Voice error: ${e.error}`)
      }
    }

    recRef.current = rec
    rec.start()
  }

  const toggleListen = () => {
    if (listening) {
      // User wants to stop — prevent onend from restarting
      shouldContinueRef.current = false
      recRef.current?.stop()
      return
    }
    // Start fresh session
    interimRef.current = ''
    setInterim('')
    setError(null)
    shouldContinueRef.current = true
    startRecognition()
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        {/* Language toggle pill */}
        <button
          type="button"
          onClick={cycleLang}
          disabled={listening}
          title="Switch language (EN / TE)"
          className="text-xs font-medium px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition select-none"
        >
          {lang.label}
        </button>

        {/* Mic button */}
        <button
          type="button"
          onClick={toggleListen}
          title={listening ? 'Tap to stop' : `Speak in ${lang.label}`}
          className={
            'relative flex items-center justify-center w-9 h-9 rounded-full border transition-all ' +
            (listening
              ? 'bg-rose-500 border-rose-500 text-white shadow-md'
              : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100')
          }
        >
          {listening && (
            <span className="absolute inset-0 rounded-full bg-rose-400 animate-ping opacity-50" />
          )}
          <MicIcon />
        </button>
      </div>

      {/* Live interim preview — stays visible across restarts */}
      {interim && (
        <p className="text-xs text-slate-400 italic max-w-xs text-right leading-snug">
          {interim}
        </p>
      )}

      {error && (
        <p className="text-xs text-rose-600 text-right">{error}</p>
      )}
    </div>
  )
}

function MicIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="relative z-10 w-4 h-4"
      aria-hidden="true"
    >
      <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z" />
      <path d="M19 10a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 10Z" />
    </svg>
  )
}
