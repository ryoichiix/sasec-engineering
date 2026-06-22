import { useMemo, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import WorkerPickerAutocomplete from '../components/WorkerPickerAutocomplete'
import AdvancesList from '../components/AdvancesList'
import { useAuth } from '../contexts/auth-context'
import { todayLocal } from '../lib/dates'
import { weekRange } from '../lib/payroll'
import {
  upsertWeeklyAdvance,
  PAYMENT_MODES,
  ADVANCE_AUTO_THRESHOLD,
} from '../lib/advances'

export default function SupervisorAdvances() {
  const { user } = useAuth()
  const today = todayLocal()
  const week = useMemo(() => weekRange(today), [today])

  const [workerId, setWorkerId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('cash')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitMsg, setSubmitMsg] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [pickerKey, setPickerKey] = useState(0)

  const submit = async (e) => {
    e.preventDefault()
    setSubmitError(null)
    setSubmitMsg(null)
    if (!workerId) {
      setSubmitError('Please select a worker.')
      return
    }
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      setSubmitError('Please enter an amount greater than 0.')
      return
    }

    setSubmitting(true)
    const { data, error } = await upsertWeeklyAdvance({
      workerId,
      weekStart:    week.start,
      amount:       amt,
      paymentMode,
      supervisorId: user.id,
    })
    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }

    if (data?.advance_status === 'pending_site_incharge') {
      setSubmitMsg(`Advance of ₹${amt} sent to the Site Incharge for review (amount exceeds ₹${ADVANCE_AUTO_THRESHOLD}).`)
    } else {
      setSubmitMsg(`Advance of ₹${amt} recorded.`)
    }

    setWorkerId('')
    setAmount('')
    setPaymentMode('cash')
    setPickerKey((k) => k + 1)
    setRefreshTick((t) => t + 1)
  }

  return (
    <DashboardShell title="Advances" accent="bg-rose-500">
      <div className="space-y-6">
        {/* Give advance */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Give an advance</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Amounts over ₹{ADVANCE_AUTO_THRESHOLD} need Site Incharge and Boss approval before
              they're added to payroll.
            </p>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">Worker</label>
                <WorkerPickerAutocomplete
                  key={pickerKey}
                  required
                  value={workerId}
                  onChange={setWorkerId}
                  placeholder="Type a worker's name…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  required
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Payment mode</label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
            {submitMsg && <p className="text-sm text-emerald-700">{submitMsg}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md transition"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        </div>

        <AdvancesList scope="mine" supervisorId={user?.id} refreshTick={refreshTick} />
      </div>
    </DashboardShell>
  )
}
