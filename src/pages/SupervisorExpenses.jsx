import { useEffect, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { useAuth } from '../contexts/auth-context'
import { todayLocal } from '../lib/dates'
import { formatCurrency } from '../lib/payroll'
import {
  EXPENSE_CATEGORIES,
  CATEGORY_COLORS,
  fetchMyExpenses,
  insertExpense,
  uploadReceipt,
  getReceiptUrl,
} from '../lib/expenses'

// Calendar-month helpers
function monthBounds(ref) {
  const d = ref instanceof Date ? ref : new Date(ref + 'T00:00:00')
  const y = d.getFullYear(), m = d.getMonth()
  const pad = (n) => String(n).padStart(2, '0')
  const start = `${y}-${pad(m + 1)}-01`
  const last  = new Date(y, m + 1, 0).getDate()
  const end   = `${y}-${pad(m + 1)}-${pad(last)}`
  return { start, end, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
}

function shiftMonth(isoStart, delta) {
  const d = new Date(isoStart + 'T00:00:00')
  d.setMonth(d.getMonth() + delta)
  return monthBounds(d)
}

export default function SupervisorExpenses() {
  const { user } = useAuth()
  const today = todayLocal()
  const [month, setMonth] = useState(() => monthBounds(today))

  // ── History ────────────────────────────────────────────────
  const [expenses, setExpenses] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState(null)
  const [receiptUrls, setReceiptUrls] = useState({}) // id -> url

  const loadExpenses = async () => {
    if (!user?.id) return
    setLoadingList(true)
    const { data, error } = await fetchMyExpenses(user.id, month.start, month.end)
    setLoadingList(false)
    if (error) { setListError(error.message); return }
    setListError(null)
    setExpenses(data || [])
    // Fetch receipt URLs asynchronously
    for (const e of data || []) {
      if (e.receipt_path && !receiptUrls[e.id]) {
        getReceiptUrl(e.receipt_path).then((url) => {
          if (url) setReceiptUrls((p) => ({ ...p, [e.id]: url }))
        })
      }
    }
  }

  useEffect(() => { loadExpenses() }, [user?.id, month.start]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthlyTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

  // ── Submit form ────────────────────────────────────────────
  const fileRef = useRef(null)
  const [form, setForm] = useState({
    amount: '',
    category: 'Petrol',
    date: today,
    description: '',
  })
  const [receiptFile, setReceiptFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const setField = (k) => (e) => setForm((p) => {
    const next = { ...p, [k]: e.target.value }
    // Clear description when switching away from "Other" so
    // the user isn't left with stale text in the optional field.
    if (k === 'category' && p.category === 'Other' && e.target.value !== 'Other') {
      next.description = ''
    }
    return next
  })

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] ?? null
    setReceiptFile(file)
    e.target.value = '' // allow re-selecting same file
  }

  const submit = async (e) => {
    e.preventDefault()
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) { setSubmitError('Enter a valid amount.'); return }
    if (form.category === 'Other' && !form.description.trim()) {
      setSubmitError('Please describe the expense when selecting "Other".')
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(false)

    // Upload receipt first if provided
    let receiptPath = null
    if (receiptFile) {
      const { error: upErr, path } = await uploadReceipt(user.id, receiptFile)
      if (upErr) {
        setSubmitError('Receipt upload failed: ' + upErr.message)
        setSubmitting(false)
        return
      }
      receiptPath = path
    }

    const { data: created, error } = await insertExpense({
      supervisorId: user.id,
      amount:       amt,
      category:     form.category,
      date:         form.date,
      description:  form.description,
      receiptPath,
    })

    setSubmitting(false)
    if (error) { setSubmitError(error.message); return }

    setForm({ amount: '', category: 'Petrol', date: today, description: '' })
    setReceiptFile(null)
    setSubmitSuccess(true)
    setTimeout(() => setSubmitSuccess(false), 3000)

    // Fetch receipt URL for the new row and prepend to list
    let newUrl = null
    if (created.receipt_path) {
      newUrl = await getReceiptUrl(created.receipt_path)
    }

    const isSameMonth =
      created.expense_date >= month.start && created.expense_date <= month.end
    if (isSameMonth) {
      setExpenses((p) => [created, ...p])
      if (newUrl) setReceiptUrls((p) => ({ ...p, [created.id]: newUrl }))
    }
  }

  return (
    <DashboardShell title="Expenses">
      {/* ── Month navigator ─────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setMonth((m) => shiftMonth(m.start, -1))}
          className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100 transition text-slate-600 text-sm"
        >
          ← Prev
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-900">{month.label}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Monthly total: <span className="font-semibold text-slate-800">{formatCurrency(monthlyTotal)}</span>
          </p>
        </div>
        <button
          onClick={() => setMonth((m) => shiftMonth(m.start, +1))}
          className="p-2 rounded-lg border border-slate-300 hover:bg-slate-100 transition text-slate-600 text-sm"
        >
          Next →
        </button>
      </div>

      {/* ── Submit form ─────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Record expense</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Amount (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                placeholder="0.00"
                value={form.amount}
                onChange={setField('amount')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand transition"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Category <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.category}
                onChange={setField('category')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand transition"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                max={today}
                onChange={setField('date')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand transition"
              />
            </div>

            {/* Receipt */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Receipt photo <span className="text-slate-400">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 text-left px-3 py-2.5 border border-slate-300 border-dashed rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition truncate"
                >
                  {receiptFile ? receiptFile.name : '📷 Choose image or PDF…'}
                </button>
                {receiptFile && (
                  <button
                    type="button"
                    onClick={() => setReceiptFile(null)}
                    className="text-slate-400 hover:text-rose-600 text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* Description — required when "Other", optional otherwise */}
          {form.category === 'Other' ? (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Describe the expense <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                value={form.description}
                onChange={setField('description')}
                placeholder="What was this expense for?"
                className="w-full px-3 py-2.5 border border-rose-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 transition bg-rose-50 placeholder-rose-300"
              />
              <p className="mt-1 text-[11px] text-rose-600">
                Required — you must describe the expense when selecting "Other".
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Description <span className="text-slate-400">(optional)</span>
              </label>
              <input
                type="text"
                value={form.description}
                onChange={setField('description')}
                placeholder="e.g. Site visit fuel — Plot 4"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand transition"
              />
            </div>
          )}

          {submitError && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}
          {submitSuccess && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              ✓ Expense recorded successfully.
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {submitting ? 'Saving…' : 'Save expense'}
          </button>
        </form>
      </div>

      {/* ── Expense history ──────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            My expenses — {month.label}
          </h3>
          <span className="text-xs text-slate-400">
            {loadingList ? '' : `${expenses.length} record${expenses.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loadingList ? (
          <div className="px-5 py-8 text-sm text-slate-500">Loading…</div>
        ) : listError ? (
          <div className="px-5 py-6 text-sm text-rose-600">{listError}</div>
        ) : expenses.length === 0 ? (
          <div className="px-5 py-10 text-sm text-slate-500 text-center">
            No expenses for {month.label}. Submit one above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {expenses.map((e) => (
              <li key={e.id} className="px-5 py-4 flex items-start gap-3">
                {/* Category pill */}
                <span
                  className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset mt-0.5 flex-shrink-0 ${CATEGORY_COLORS[e.category] || CATEGORY_COLORS.Other}`}
                >
                  {e.category}
                </span>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCurrency(Number(e.amount))}
                    </p>
                    <p className="text-xs text-slate-400 flex-shrink-0">{e.expense_date}</p>
                  </div>
                  {e.description && (
                    <p className="text-xs text-slate-600 mt-0.5 truncate">{e.description}</p>
                  )}
                  {/* Receipt thumbnail */}
                  {receiptUrls[e.id] && (
                    <a
                      href={receiptUrls[e.id]}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                    >
                      📎 View receipt
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  )
}
