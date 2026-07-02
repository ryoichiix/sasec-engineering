import { useEffect, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { useAuth } from '../contexts/auth-context'
import { todayLocal } from '../lib/dates'
import { formatCurrency } from '../lib/payroll'
import { fetchVehicles } from '../lib/vehicles'
import {
  EXPENSE_CATEGORIES,
  CATEGORY_COLORS,
  fetchMyExpenses,
  insertExpense,
  uploadReceipt,
  getReceiptUrl,
  formatExpenseDetail,
} from '../lib/expenses'
import { insertFuelPurchase, insertFuelAllocations, fetchFuelBalance, FUEL_TYPES } from '../lib/fuel'

// Categories that capture structured detail instead of a free-text description.
const STRUCTURED_CATEGORIES = ['Vehicle Repairs', 'Machinery Repairs']
// Fuel categories use the dedicated Fuel Manager (purchase + allocation) below.
// The fuel type list lives in src/lib/fuel.js (FUEL_TYPES) so the category
// trigger stays in sync with the per-type balance + allocation logic.
const FUEL_CATEGORIES = FUEL_TYPES

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

  // ── Vehicles (for Petrol / Vehicle Repairs dropdowns) ───────
  // Fails gracefully — empty list if the table doesn't exist yet.
  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    fetchVehicles().then(setVehicles)
  }, [])

  // ── Fuel manager (Diesel / Petrol) ──────────────────────────
  const [fuelPurchaseLitres, setFuelPurchaseLitres] = useState('')
  const [fuelPricePerLitre, setFuelPricePerLitre] = useState('')
  const [fuelAllocations, setFuelAllocations] = useState([{ vehicle_id: '', litres: '' }])
  const [fuelBalance, setFuelBalance] = useState(null)

  const addAllocationRow = () =>
    setFuelAllocations((prev) => [...prev, { vehicle_id: '', litres: '' }])
  const removeAllocation = (idx) =>
    setFuelAllocations((prev) => prev.filter((_, i) => i !== idx))
  const updateAllocation = (idx, field, val) =>
    setFuelAllocations((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: val } : a)))
  const resetFuel = () => {
    setFuelPurchaseLitres('')
    setFuelPricePerLitre('')
    setFuelAllocations([{ vehicle_id: '', litres: '' }])
  }

  const loadFuelBalance = () => fetchFuelBalance().then(setFuelBalance)
  useEffect(() => { loadFuelBalance() }, [])

  // ── History ────────────────────────────────────────────────
  const [expenses, setExpenses] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState(null)
  const [receiptUrls, setReceiptUrls] = useState({}) // id -> url

  // ── Filters ────────────────────────────────────────────────
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

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

  // Client-side filtering on the loaded month's rows.
  const filteredExpenses = expenses.filter((e) => {
    if (filterFrom && e.expense_date < filterFrom) return false
    if (filterTo && e.expense_date > filterTo) return false
    if (filterCategory && e.category !== filterCategory) return false
    return true
  })
  const filtersActive = Boolean(filterFrom || filterTo || filterCategory)
  const filteredTotal = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0)

  // ── Submit form ────────────────────────────────────────────
  const receiptFileRef = useRef(null)
  const receiptCameraRef = useRef(null)
  const [form, setForm] = useState({
    amount: '',
    category: 'Petrol',
    date: today,
    description: '',
    vehicleId: '',
    machinery: '',
    repair: '',
  })
  const [receiptFile, setReceiptFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const isStructured = STRUCTURED_CATEGORIES.includes(form.category)
  const isFuel = FUEL_CATEGORIES.includes(form.category)

  const setField = (k) => (e) => setForm((p) => {
    const next = { ...p, [k]: e.target.value }
    if (k === 'category') {
      // Leaving "Other" clears its required description.
      if (p.category === 'Other' && e.target.value !== 'Other') next.description = ''
      // Structured fields are category-specific — reset on switch.
      next.vehicleId = ''
      next.machinery = ''
      next.repair = ''
    }
    return next
  })

  // Category change also resets the (separately-held) Fuel Manager state.
  const onCategoryChange = (e) => { setField('category')(e); resetFuel() }

  // VehicleCombobox hands back a raw id (not an event) — separate setter.
  const setVehicleId = (id) => setForm((p) => ({ ...p, vehicleId: id }))

  // Derived fuel figures (recomputed each render from the inputs above).
  const fuelTotalAmount = (Number(fuelPurchaseLitres) || 0) * (Number(fuelPricePerLitre) || 0)
  const fuelAllocated = fuelAllocations.reduce((sum, a) => sum + (Number(a.litres) || 0), 0)

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] ?? null
    setReceiptFile(file)
    e.target.value = '' // allow re-selecting same file
  }

  // Build the value stored in `description`: a JSON payload for structured
  // categories, otherwise the plain free-text description.
  const buildDescription = () => {
    if (isFuel) {
      // Fuel detail lives in the fuel_* tables; store a summary in the
      // expense row so the history line still reads "X L @ ₹Y/L".
      return JSON.stringify({
        litres: fuelPurchaseLitres ? Number(fuelPurchaseLitres) : null,
        rate:   fuelPricePerLitre ? Number(fuelPricePerLitre) : null,
      })
    }
    const vehicleNo = vehicles.find((v) => v.id === form.vehicleId)?.vehicle_no || null
    if (form.category === 'Vehicle Repairs') {
      return JSON.stringify({
        vehicle_no: vehicleNo,
        repair: form.repair.trim() || null,
      })
    }
    if (form.category === 'Machinery Repairs') {
      return JSON.stringify({
        machinery: form.machinery.trim() || null,
        repair:    form.repair.trim() || null,
      })
    }
    return form.description
  }

  const submit = async () => {
    // Amount: entered directly, or derived from litres × rate for fuel.
    let amt
    if (isFuel) {
      const litres = parseFloat(fuelPurchaseLitres)
      const price  = parseFloat(fuelPricePerLitre)
      if (!litres || litres <= 0) { setSubmitError('Enter total litres purchased.'); return }
      if (!price  || price  <= 0) { setSubmitError('Enter the price per litre.'); return }
      amt = litres * price
    } else {
      amt = parseFloat(form.amount)
      if (!amt || amt <= 0) { setSubmitError('Enter a valid amount.'); return }
      if (form.category === 'Other' && !form.description.trim()) {
        setSubmitError('Please describe the expense when selecting "Other".')
        return
      }
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
      description:  buildDescription(),
      receiptPath,
    })

    if (error) { setSubmitting(false); setSubmitError(error.message); return }

    // Fuel side-effect: mirror the purchase + allocations into the fuel ledger.
    if (isFuel) {
      const { data: purchase, error: pErr } = await insertFuelPurchase({
        date:          form.date,
        totalLitres:   fuelPurchaseLitres,
        pricePerLitre: fuelPricePerLitre,
        supervisorId:  user.id,
        // The selected expense category (Diesel / Petrol / Hydraulic Oil) IS
        // the fuel type — stored so the balance debits only this type's pool.
        fuelType:      form.category,
      })
      if (pErr) {
        setSubmitting(false)
        setSubmitError('Expense saved, but fuel purchase failed: ' + pErr.message)
        return
      }
      const allocs = fuelAllocations
        .filter((a) => a.vehicle_id && a.litres)
        .map((a) => ({
          purchase_id:      purchase.id,
          date:             form.date,
          vehicle_id:       a.vehicle_id,
          vehicle_no:       vehicles.find((v) => v.id === a.vehicle_id)?.vehicle_no || null,
          litres_allocated: Number(a.litres),
          supervisor_id:    user.id,
          // Allocation debits ONLY this fuel type's balance (Fix 2).
          fuel_type:        form.category,
        }))
      if (allocs.length > 0) {
        const { error: aErr } = await insertFuelAllocations(allocs)
        if (aErr) {
          setSubmitting(false)
          setSubmitError('Purchase saved, but allocation failed: ' + aErr.message)
          return
        }
      }
      loadFuelBalance()
    }

    setSubmitting(false)

    setForm({
      amount: '', category: 'Petrol', date: today, description: '',
      vehicleId: '', machinery: '', repair: '',
    })
    resetFuel()
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

      {/* ── Fuel balance at site (running, all-time) — per fuel type ─── */}
      {fuelBalance?.byType?.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">⛽ Fuel Balance at Site</p>
          <div className="space-y-3">
            {fuelBalance.byType.map((t) => (
              <div key={t.type}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <p className="text-sm font-semibold text-gray-900">{t.type}</p>
                  <p className={`text-lg font-bold ${t.balance > 50 ? 'text-green-600' : 'text-red-600'}`}>
                    {t.balance.toFixed(0)} L <span className="text-xs font-medium text-gray-400">remaining</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <p className="text-xs text-gray-400">
                    Purchased <span className="font-semibold text-gray-700">{t.totalPurchased.toFixed(0)} L</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    Allocated <span className="font-semibold text-orange-600">{t.totalAllocated.toFixed(0)} L</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Submit form (div + onClick — no <form> tag) ──────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-5">Record Expense</h2>

        {/* Row 1: Amount + Category */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Amount (₹) *
            </label>
            {isFuel ? (
              <div className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm">
                {fuelTotalAmount > 0
                  ? <span className="font-semibold text-gray-800">{formatCurrency(fuelTotalAmount)}</span>
                  : <span className="text-gray-400">Auto — litres × rate</span>}
              </div>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={setField('amount')}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
              />
            )}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Category *
            </label>
            <select
              value={form.category}
              onChange={onCategoryChange}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Date + Receipt */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Date
            </label>
            <input
              type="date"
              value={form.date}
              max={today}
              onChange={setField('date')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Receipt (optional)
            </label>

            {/* Hidden inputs */}
            <input
              ref={receiptFileRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={receiptCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Two buttons side by side */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => receiptFileRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Upload file
              </button>
              <button
                type="button"
                onClick={() => receiptCameraRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Take photo
              </button>
            </div>

            {/* Show selected file name */}
            {receiptFile && (
              <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <span className="flex-1 truncate">{receiptFile.name}</span>
                <button
                  type="button"
                  onClick={() => setReceiptFile(null)}
                  className="text-gray-400 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Dynamic, category-specific fields ─────────────── */}
        {form.category === 'Vehicle Repairs' && (
          <div className="mb-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Vehicle *
            </label>
            <VehicleCombobox vehicles={vehicles} value={form.vehicleId} onChange={setVehicleId} />
            {vehicles.length === 0 && (
              <p className="mt-1 text-[11px] text-gray-400">No vehicles available yet.</p>
            )}
          </div>
        )}

        {/* ── Fuel Manager: bulk purchase + per-vehicle allocation ── */}
        {isFuel && (
          <div className="space-y-4 mb-4">
            {/* Purchase section */}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-3">Today's {form.category} Purchase</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Total litres purchased</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={fuelPurchaseLitres}
                    onChange={(e) => setFuelPurchaseLitres(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Price per litre (₹)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={fuelPricePerLitre}
                    onChange={(e) => setFuelPricePerLitre(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
            </div>

            {/* Allocation section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Allocate {form.category} to vehicles</p>
                <button
                  type="button"
                  onClick={addAllocationRow}
                  className="text-xs text-[#C0272D] font-semibold hover:text-red-800"
                >
                  + Add vehicle
                </button>
              </div>
              {fuelAllocations.map((alloc, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-2">
                  <div className="flex-1">
                    <VehicleCombobox
                      vehicles={vehicles}
                      value={alloc.vehicle_id}
                      onChange={(val) => updateAllocation(idx, 'vehicle_id', val)}
                    />
                  </div>
                  <div className="w-24">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="Litres"
                      value={alloc.litres}
                      onChange={(e) => updateAllocation(idx, 'litres', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAllocation(idx)}
                    disabled={fuelAllocations.length === 1}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-40 disabled:hover:text-gray-300 flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {/* Balance summary for today's purchase */}
              {fuelPurchaseLitres && (
                <div className="mt-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Purchased today</span>
                    <span className="font-semibold">{Number(fuelPurchaseLitres)} L</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Allocated</span>
                    <span className="font-semibold text-orange-600">{fuelAllocated} L</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold border-t border-gray-200 pt-1 mt-1">
                    <span>Unallocated today</span>
                    <span className="text-green-600">{Number(fuelPurchaseLitres) - fuelAllocated} L</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {form.category === 'Machinery Repairs' && (
          <div className="mb-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Machinery / Equipment
            </label>
            <input
              type="text"
              placeholder="e.g. Welding Machine, Grinder, Generator…"
              value={form.machinery}
              onChange={setField('machinery')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
            />
          </div>
        )}

        {(form.category === 'Vehicle Repairs' || form.category === 'Machinery Repairs') && (
          <div className="mb-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Repair description
            </label>
            <textarea
              rows={2}
              placeholder="Describe the repair…"
              value={form.repair}
              onChange={setField('repair')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
            />
          </div>
        )}

        {/* Description — only for non-structured, non-fuel categories.
            Required when "Other", optional otherwise. */}
        {!isStructured && !isFuel && (
          form.category === 'Other' ? (
            <div className="mb-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
                Describe the expense *
              </label>
              <input
                type="text"
                autoFocus
                value={form.description}
                onChange={setField('description')}
                placeholder="What was this expense for?"
                className="w-full border border-rose-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 bg-rose-50 placeholder-rose-300"
              />
              <p className="mt-1 text-[11px] text-rose-600">
                Required — you must describe the expense when selecting "Other".
              </p>
            </div>
          ) : (
            <div className="mb-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5 block">
                Description (optional)
              </label>
              <input
                type="text"
                value={form.description}
                onChange={setField('description')}
                placeholder="e.g. Site visit fuel — Plot 4"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
              />
            </div>
          )
        )}

        {submitError && (
          <p className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {submitError}
          </p>
        )}
        {submitSuccess && (
          <p className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            ✓ Expense recorded successfully.
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="w-full bg-[#C0272D] hover:bg-red-800 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors mt-2"
        >
          {submitting ? 'Saving…' : 'Save Expense'}
        </button>
      </div>

      {/* ── Filter bar ───────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-400">From</span>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="text-sm text-slate-700 outline-none bg-transparent"
          />
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-400">To</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="text-sm text-slate-700 outline-none bg-transparent"
          />
        </div>

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none"
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <button
          onClick={() => {
            const now = new Date()
            const start = new Date(now.getFullYear(), now.getMonth(), 1)
            setFilterFrom(start.toISOString().split('T')[0])
            setFilterTo(now.toISOString().split('T')[0])
          }}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 transition-colors"
        >
          This month
        </button>

        {filtersActive && (
          <button
            onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterCategory('') }}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Expense history ──────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            My expenses — {month.label}
          </h3>
          <span className="text-xs text-slate-400">
            {loadingList ? '' : `${filteredExpenses.length} record${filteredExpenses.length === 1 ? '' : 's'}`}
            {!loadingList && filtersActive && ` · ${formatCurrency(filteredTotal)}`}
          </span>
        </div>

        {loadingList ? (
          <div className="px-5 py-8 text-sm text-slate-500">Loading…</div>
        ) : listError ? (
          <div className="px-5 py-6 text-sm text-rose-600">{listError}</div>
        ) : filteredExpenses.length === 0 ? (
          <div className="px-5 py-10 text-sm text-slate-500 text-center">
            {filtersActive
              ? 'No expenses match the current filters.'
              : `No expenses for ${month.label}. Submit one above.`}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredExpenses.map((e) => {
              const detail = formatExpenseDetail(e.description)
              return (
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
                    {detail && (
                      <p className="text-xs text-slate-600 mt-0.5 truncate">{detail}</p>
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
              )
            })}
          </ul>
        )}
      </div>
    </DashboardShell>
  )
}

// Searchable vehicle combobox for Petrol / Vehicle Repairs — filters by
// vehicle number, type, or driver name as the user types. No new packages.
function VehicleCombobox({ vehicles, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = vehicles.filter((v) =>
    `${v.vehicle_no} ${v.vehicle_type} ${v.driver_name}`.toLowerCase().includes(query.toLowerCase())
  )

  const selected = vehicles.find((v) => v.id === value)

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query || (selected ? `${selected.vehicle_no} — ${selected.vehicle_type}` : '')}
        onChange={(e) => { setQuery(e.target.value); onChange(''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search by vehicle number, type, or driver…"
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C0272D] bg-white"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.map((v) => (
            <div
              key={v.id}
              onMouseDown={() => { onChange(v.id); setQuery(''); setOpen(false) }}
              className="px-4 py-3 hover:bg-red-50 cursor-pointer border-b border-gray-50 last:border-0"
            >
              <p className="text-sm font-semibold text-gray-900">{v.vehicle_no}</p>
              <p className="text-xs text-gray-400">{v.vehicle_type} · {v.driver_name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
