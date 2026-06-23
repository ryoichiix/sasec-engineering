import { supabase } from './supabase'

export const EXPENSE_CATEGORIES = [
  'Petrol',
  'Diesel',
  'Vehicle Repairs',
  'Machinery Repairs',
  'Tools & Equipment',
  'Site Expenses',
  'Food',
  'Materials',
  'Travel',
  'Other',
]

export const CATEGORY_COLORS = {
  Petrol:              'bg-amber-100 text-amber-800 ring-amber-200',
  Diesel:             'bg-orange-100 text-orange-800 ring-orange-200',
  'Vehicle Repairs':   'bg-red-100 text-red-800 ring-red-200',
  'Machinery Repairs': 'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200',
  'Tools & Equipment': 'bg-cyan-100 text-cyan-800 ring-cyan-200',
  'Site Expenses':     'bg-teal-100 text-teal-800 ring-teal-200',
  Food:               'bg-emerald-100 text-emerald-800 ring-emerald-200',
  Materials:          'bg-blue-100 text-blue-800 ring-blue-200',
  Travel:             'bg-violet-100 text-violet-800 ring-violet-200',
  Other:              'bg-slate-100 text-slate-700 ring-slate-200',
}

/**
 * Some categories (Petrol, Vehicle/Machinery Repairs) store structured
 * detail in the `description` column as a JSON string. This turns that —
 * or a plain description — into a short human-readable line for display.
 */
export function formatExpenseDetail(description) {
  if (!description) return null
  let parsed
  try { parsed = JSON.parse(description) } catch { return description }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return description

  const parts = []
  if (parsed.litres != null && parsed.rate != null) {
    parts.push(`${parsed.litres} L @ ₹${parsed.rate}/L`)
  } else if (parsed.litres != null) {
    parts.push(`${parsed.litres} L`)
  }
  if (parsed.machinery) parts.push(parsed.machinery)
  if (parsed.vehicle_no) parts.push(parsed.vehicle_no)
  if (parsed.repair) parts.push(parsed.repair)
  if (parsed.note) parts.push(parsed.note)
  // It was a structured payload — if every field was blank, show nothing
  // rather than leaking the raw JSON string.
  return parts.length ? parts.join(' · ') : null
}

// ── Fetch ──────────────────────────────────────────────────────

/** Supervisor: own expenses for a given month (YYYY-MM-DD range). */
export function fetchMyExpenses(supervisorId, startDate, endDate) {
  return supabase
    .from('expenses')
    .select('id, amount, category, expense_date, description, receipt_path, created_at')
    .eq('supervisor_id', supervisorId)
    .gte('expense_date', startDate)
    .lte('expense_date', endDate)
    .order('expense_date', { ascending: false })
}

/** Boss: all expenses with supervisor name, for a given month. */
export async function fetchAllExpenses(startDate, endDate) {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, supervisor_id, amount, category, expense_date, description, receipt_path, created_at')
    .gte('expense_date', startDate)
    .lte('expense_date', endDate)
    .order('expense_date', { ascending: false })

  if (error) return { data: null, error }

  // Batch-fetch supervisor names
  const ids = [...new Set((data || []).map((e) => e.supervisor_id))]
  let nameById = {}
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids)
    for (const p of profs || []) nameById[p.id] = p.full_name
  }

  return {
    error: null,
    data: (data || []).map((e) => ({
      ...e,
      supervisor_name: nameById[e.supervisor_id] || 'Supervisor',
    })),
  }
}

/** Insert a new expense row. Returns the created row. */
export function insertExpense({ supervisorId, amount, category, date, description, receiptPath }) {
  return supabase
    .from('expenses')
    .insert({
      supervisor_id: supervisorId,
      amount:        Number(amount),
      category,
      expense_date:  date,
      description:   description?.trim() || null,
      receipt_path:  receiptPath || null,
    })
    .select('id, amount, category, expense_date, description, receipt_path, created_at')
    .single()
}

// ── Storage ─────────────────────────────────────────────────────

const BUCKET = 'expense-receipts'

/**
 * Upload a receipt image. Path: {supervisorId}/{timestamp}.{ext}
 * Returns { path, signedUrl } on success.
 */
export async function uploadReceipt(supervisorId, file) {
  const ext   = file.name.split('.').pop().toLowerCase() || 'jpg'
  const path  = `${supervisorId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) return { error, path: null, signedUrl: null }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60) // 1-hour URL

  return { error: null, path, signedUrl: signed?.signedUrl ?? null }
}

/**
 * Get a 1-hour signed URL for an existing receipt path.
 * Returns null if path is null/empty.
 */
export async function getReceiptUrl(path) {
  if (!path) return null
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60)
  return data?.signedUrl ?? null
}
