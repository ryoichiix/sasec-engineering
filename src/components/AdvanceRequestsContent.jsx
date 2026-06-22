import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import {
  fetchPendingAdvanceRequests,
  approveAdvance,
  rejectAdvance,
  partialApproveAdvance,
  paymentModeLabel,
} from '../lib/advances'
import { notifyUser, notifyFieldManagers } from '../lib/notifications'
import { formatCurrency } from '../lib/payroll'
import { formatDate } from '../lib/dates'

/**
 * Boss's advance review queue — pending_boss rows.
 * Mirrors the OTRequestsContent layout/visuals.
 */
export default function AdvanceRequestsContent() {
  const { user } = useAuth()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState({})

  // Partial-approval modal state
  const [partialModal, setPartialModal]   = useState(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialNote, setPartialNote]     = useState('')

  const applyResult = (data, err) => {
    if (err) { setError(err.message); setRows([]) }
    else     { setError(null); setRows(data || []) }
    setLoading(false)
  }

  const reload = async () => {
    setLoading(true)
    const { data, error: err } = await fetchPendingAdvanceRequests()
    applyResult(data, err)
  }

  useEffect(() => {
    let isMounted = true
    fetchPendingAdvanceRequests().then(({ data, error: err }) => {
      if (!isMounted) return
      applyResult(data, err)
    })
    return () => { isMounted = false }
  }, [])

  const groups = useMemo(() => {
    const byWeek = new Map()
    for (const r of rows) {
      if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, [])
      byWeek.get(r.week_start).push(r)
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([week_start, items]) => ({ week_start, items }))
  }, [rows])

  const decideOne = async (id, action) => {
    if (!user?.id) return
    const advance = rows.find((r) => r.id === id)
    setBusy((b) => ({ ...b, [id]: true }))
    const fn = action === 'approve' ? approveAdvance : rejectAdvance
    const { error: err } = await fn(id, user.id)
    if (err) {
      setBusy((b) => { const n = { ...b }; delete n[id]; return n })
      setError(err.message)
      return
    }

    // Notify the submitting supervisor + Site Incharges (RLS-safe RPCs).
    if (advance) {
      const title = action === 'approve' ? 'Advance Approved' : 'Advance Rejected'
      const verb  = action === 'approve' ? 'approved' : 'rejected'
      const type  = action === 'approve' ? 'advance_approved' : 'advance_rejected'
      const msg = `Director ${verb} the ${formatCurrency(advance.amount)} `
        + `advance for ${advance.worker_name || 'worker'}.`
      if (advance.supervisor_id) {
        await notifyUser({
          userId: advance.supervisor_id,
          title, message: msg, type, referenceId: id, referenceType: 'advance',
        })
      }
      await notifyFieldManagers({ title, message: msg, type, referenceId: id, referenceType: 'advance' })
    }

    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    setRows((p) => p.filter((r) => r.id !== id))
  }

  const openPartial = (advance) => {
    setPartialModal(advance)
    setPartialAmount('')
    setPartialNote('')
  }

  const closePartial = () => {
    setPartialModal(null)
    setPartialAmount('')
    setPartialNote('')
  }

  const handlePartialApprove = async () => {
    const advance = partialModal
    if (!advance || !user?.id) return
    const amt = Number(partialAmount)
    if (!amt || amt <= 0 || amt >= Number(advance.amount)) return

    setBusy((b) => ({ ...b, [advance.id]: true }))
    const { error: err } = await partialApproveAdvance(advance.id, user.id, amt, partialNote)
    if (err) {
      setBusy((b) => { const n = { ...b }; delete n[advance.id]; return n })
      setError(err.message)
      return
    }

    // Notify the submitting supervisor + the Site Incharges via RLS-safe RPCs.
    const msg = `Director approved ${formatCurrency(amt)} of ${formatCurrency(advance.amount)} `
      + `advance for ${advance.worker_name || 'worker'}.`
      + (partialNote ? ` Note: ${partialNote}` : '')
    if (advance.supervisor_id) {
      await notifyUser({
        userId: advance.supervisor_id,
        title: 'Advance Partially Approved',
        message: msg,
        type: 'advance_partial',
        referenceId: advance.id,
        referenceType: 'advance',
      })
    }
    await notifyFieldManagers({
      title: 'Advance Partially Approved',
      message: msg,
      type: 'advance_partial',
      referenceId: advance.id,
      referenceType: 'advance',
    })

    setBusy((b) => { const n = { ...b }; delete n[advance.id]; return n })
    closePartial()
    setRows((p) => p.filter((r) => r.id !== advance.id))
  }

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="text-sm text-[#64748B]">
          {loading ? 'Loading…' : (
            <>
              <span className="font-semibold text-[#0F172A]">{rows.length}</span>{' '}
              pending request{rows.length === 1 ? '' : 's'} ·{' '}
              <span className="text-violet-700 font-medium">{formatCurrency(totalAmount)}</span>
            </>
          )}
        </div>
        <button onClick={reload}
          className="text-xs font-medium px-3 py-1.5 border border-[#E2E8F0] rounded-md hover:bg-[#F8FAFC] min-h-[36px]">
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-[#EF4444] bg-[#FEE2E2] border border-[#FECACA] rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[#64748B]">No pending advance requests right now.</p>
          <p className="text-xs text-[#94A3B8] mt-1">Advances ≤ ₹1000 are auto-approved and won't appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.week_start} className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-[#F1F5F9] flex items-center justify-between bg-[#F8FAFC]">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Week of {formatDate(g.week_start)}
                </h3>
                <span className="text-xs text-[#64748B]">
                  {g.items.length} request{g.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="divide-y divide-[#F1F5F9]">
                {g.items.map((r) => {
                  const isBusy = !!busy[r.id]
                  return (
                    <li key={r.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F172A] truncate">{r.worker_name}</p>
                        <p className="text-xs text-[#64748B]">
                          <span className="font-semibold text-[#0F172A]">{formatCurrency(r.amount)}</span>
                          {' · '}{paymentModeLabel(r.payment_mode)}
                          {' · '}entered by {r.supervisor_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                        {isBusy && <span className="text-xs text-[#94A3B8]">Saving…</span>}
                        <button onClick={() => decideOne(r.id, 'approve')} disabled={isBusy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#10B981] hover:bg-[#059669] text-white disabled:opacity-60 min-h-[36px]">
                          Approve
                        </button>
                        <button onClick={() => openPartial(r)} disabled={isBusy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 min-h-[36px]">
                          Partial
                        </button>
                        <button onClick={() => decideOne(r.id, 'reject')} disabled={isBusy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-60 min-h-[36px]">
                          Reject
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Partial-approval modal */}
      {partialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 text-lg mb-1">Partial Approval</h3>
            <p className="text-sm text-gray-500 mb-4">
              Worker requested {formatCurrency(partialModal.amount)}. Enter the amount you will approve.
            </p>

            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1 block">
              Approved Amount (₹)
            </label>
            <input
              type="number"
              max={partialModal.amount}
              min={1}
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
              placeholder="0"
            />

            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1 block">
              Note to Supervisor (optional)
            </label>
            <textarea
              rows={2}
              value={partialNote}
              onChange={(e) => setPartialNote(e.target.value)}
              placeholder="Reason for partial approval..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
            />

            <div className="flex gap-2">
              <button
                onClick={handlePartialApprove}
                disabled={!partialAmount || Number(partialAmount) <= 0 || Number(partialAmount) >= Number(partialModal.amount)}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                Confirm Partial ({formatCurrency(Number(partialAmount || 0))})
              </button>
              <button
                onClick={closePartial}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
