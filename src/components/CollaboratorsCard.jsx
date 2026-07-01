import { useEffect, useState } from 'react'
import {
  fetchOtherSupervisors,
  fetchCollaborationsForDate,
  saveCollaborations,
} from '../lib/collaborations'
import { notifyUser } from '../lib/notifications'
import { formatDate } from '../lib/dates'

/**
 * Two supervisors can tag each other as working together on a date. Saving is
 * self-contained here (the page has no single "save plan" action); tagged
 * supervisors are notified and the link surfaces in the Director/SI work feed.
 *
 * The notification references the exact link row (referenceId/referenceType) so
 * the collaborator can Accept / Decline it straight from the notification.
 */
export default function CollaboratorsCard({ userId, userName, date }) {
  const [showCollabPicker, setShowCollabPicker] = useState(false)
  const [otherSupervisors, setOtherSupervisors] = useState([])
  const [selectedCollaborators, setSelectedCollaborators] = useState([])
  const [initialSelected, setInitialSelected] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  // Load the supervisor list + this date's existing links. Imperative prefill
  // (not derived state) keeps the set-state-in-effect lint rule happy.
  useEffect(() => {
    if (!userId) return
    let isMounted = true
    ;(async () => {
      const [supRes, linkRes] = await Promise.all([
        fetchOtherSupervisors(userId),
        fetchCollaborationsForDate(userId, date),
      ])
      if (!isMounted) return
      setOtherSupervisors(supRes.data || [])
      const ids = (linkRes.data || []).map((l) => l.collaborator_id)
      setSelectedCollaborators(ids)
      setInitialSelected(ids)
      if (ids.length) setShowCollabPicker(true)
    })()
    return () => { isMounted = false }
  }, [userId, date])

  const toggleCollaborator = (id) => {
    setSaved(false)
    setSelectedCollaborators((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
  const dirty = !sameSet(selectedCollaborators, initialSelected)

  const save = async () => {
    setSaving(true)
    setError(null)
    const { added, error: err } = await saveCollaborations(userId, date, selectedCollaborators)
    if (err) { setSaving(false); setError(err.message); return }

    // Notify only the newly-tagged supervisors. Reference the exact link row so
    // the recipient can Accept / Decline it straight from the notification.
    // Best-effort: the collaboration rows are already saved, so a notification
    // failure must never block the save — but we surface it in the console
    // (checking the RPC's returned error + a try/catch) rather than letting it
    // fail silently, the recurring notify_user gap in this app.
    for (const link of added) {
      try {
        const { error: notifyErr } = await notifyUser({
          userId: link.collaborator_id,
          type: 'collaboration_request',
          title: 'Collaboration request',
          message: `${userName || 'A supervisor'} tagged you as working together on ${formatDate(date)}. Your work plans will be linked in the feed.`,
          referenceId: link.id,
          referenceType: 'collaboration',
        })
        if (notifyErr) console.error('collaboration_request notifyUser failed for', link.collaborator_id, notifyErr)
      } catch (e) {
        console.error('collaboration_request notifyUser threw for', link.collaborator_id, e)
      }
    }
    setInitialSelected(selectedCollaborators)
    setSaved(true)
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Working with another supervisor?</p>
          <p className="text-xs text-gray-400 mt-0.5">Tag a supervisor to link your teams in the work feed</p>
        </div>
        <button
          onClick={() => setShowCollabPicker((v) => !v)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            showCollabPicker ? 'bg-[#C0272D]' : 'bg-gray-200'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
            showCollabPicker ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {showCollabPicker && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Select supervisor(s) you're working with on {formatDate(date)}:</p>
          {otherSupervisors.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No other supervisors available.</p>
          ) : (
            <div className="space-y-2">
              {otherSupervisors.map((sup) => {
                const picked = selectedCollaborators.includes(sup.id)
                return (
                  <div
                    key={sup.id}
                    onClick={() => toggleCollaborator(sup.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      picked
                        ? 'bg-[#0F172A] border-[#0F172A]'
                        : 'bg-gray-50 border-gray-100 hover:border-gray-300'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      picked ? 'bg-white text-[#0F172A]' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {sup.full_name?.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${picked ? 'text-white' : 'text-gray-900'}`}>
                        {sup.full_name}
                      </p>
                    </div>
                    {picked && <span className="text-white text-sm">✓</span>}
                  </div>
                )
              })}
            </div>
          )}

          {selectedCollaborators.length > 0 && (
            <p className="text-xs text-amber-600 mt-2 bg-amber-50 px-3 py-2 rounded-lg">
              ⚡ Newly tagged supervisors will receive a notification to confirm collaboration
            </p>
          )}

          {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="bg-[#C0272D] hover:bg-[#A01E23] disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-md transition shadow-sm"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && !dirty && <span className="text-xs text-emerald-600">Saved ✓</span>}
          </div>
        </div>
      )}
    </div>
  )
}
