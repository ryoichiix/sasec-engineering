import { useState } from 'react'
import { formatTime } from '../lib/dates'
import MicButton from './MicButton'

/**
 * A single editable field on the supervisor's work-plan page.
 *
 * Local state is initialised from `value` on mount only. The parent passes
 * `key={date}` so changing the date remounts the panel with fresh state —
 * no need for an effect to reset local state when props change.
 *
 * Props:
 *   label     "Morning plan" | "Evening update"
 *   value     current saved text (may be null)
 *   postedAt  ISO timestamp the field first became non-null, or null
 *   onSave    async (newValue: string) => { error?: { message } }
 *   placeholder
 */
export default function WorkPlanPanel({
  label,
  value,
  postedAt,
  onSave,
  placeholder,
}) {
  const [text, setText] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)

  const trimmed = text.trim()
  const dirty = trimmed !== (value ?? '').trim()
  const postedLabel = formatTime(postedAt)

  const save = async () => {
    if (!trimmed) {
      setError('Add some text before saving.')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await onSave(trimmed)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setSavedAt(Date.now())
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        <span className="text-xs text-slate-400">
          {postedLabel ? `Posted at ${postedLabel}` : 'Not posted yet'}
        </span>
      </div>
      <div className="px-6 py-5 space-y-3">
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <div className="flex items-center justify-between">
          <MicButton
            onTranscript={(t) =>
              setText((prev) => (prev.trim() ? prev.trimEnd() + ' ' + t : t))
            }
          />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && !dirty && (
            <span className="text-xs text-emerald-600">Saved ✓</span>
          )}
        </div>
      </div>
    </div>
  )
}
