import { supabase } from './supabase'

// ── Fuel types ──────────────────────────────────────────────────
// Single source of truth for the fuel types tracked in the fuel ledger
// (purchases, allocations, per-type balance). These are also the fuel
// expense categories in the Expenses form. Add a new type here (e.g. a
// future "Grease") and the per-type balance + allocation flow pick it up
// automatically — no other code changes and no migration needed.
//
// NOTE on units: every type here is currently measured in litres. If a
// future type uses a different unit (Grease → Kgs), give this array
// richer entries (e.g. { name, unit }) rather than assuming litres — the
// balance/allocation code groups purely by type string, so it won't need
// a rewrite to support that.
export const FUEL_TYPES = ['Diesel', 'Petrol', 'Hydraulic Oil']

// ── Purchases ───────────────────────────────────────────────────

/**
 * Record a fuel purchase (diesel/petrol bought in bulk for the site).
 * `total_amount` is derived from litres × price so the fuel ledger and the
 * expenses ledger agree. Returns { data, error } with the created row.
 */
export function insertFuelPurchase({ date, totalLitres, pricePerLitre, supervisorId, fuelType }) {
  const litres = Number(totalLitres)
  const price  = pricePerLitre ? Number(pricePerLitre) : null
  return supabase
    .from('fuel_purchases')
    .insert({
      date,
      fuel_type:       fuelType,
      total_litres:    litres,
      price_per_litre: price,
      total_amount:    price != null ? litres * price : null,
      supervisor_id:   supervisorId,
    })
    .select()
    .single()
}

// ── Allocations ─────────────────────────────────────────────────

/** Insert one or more allocation rows tied to a purchase. */
export function insertFuelAllocations(rows) {
  return supabase.from('fuel_allocations').insert(rows)
}

// ── Running balance ─────────────────────────────────────────────

/**
 * Site fuel balance (all-time, in litres) computed SEPARATELY per fuel type:
 * for each type, total purchased − total allocated. Petrol and Diesel (and
 * Hydraulic Oil, and any future type) each get their own running balance — they
 * are never merged into a combined pool.
 *
 * Returns { byType: [{ type, totalPurchased, totalAllocated, balance }, …] }
 * ordered by FUEL_TYPES (canonical order), with any other types (e.g. legacy
 * 'Unknown') appended alphabetically. Fails gracefully — returns an empty list
 * if the tables aren't reachable, so the card never crashes the page.
 */
export async function fetchFuelBalance() {
  const [{ data: purchases, error: pErr }, { data: allocations, error: aErr }] =
    await Promise.all([
      supabase.from('fuel_purchases').select('total_litres, fuel_type'),
      supabase.from('fuel_allocations').select('litres_allocated, fuel_type'),
    ])

  if (pErr || aErr) return { byType: [] }

  // Accumulate purchased/allocated litres keyed by fuel type. A row with no
  // type (shouldn't happen post-migration, but defensive) folds into 'Unknown'.
  const totals = new Map()
  const bucket = (type) => {
    const key = type || 'Unknown'
    if (!totals.has(key)) totals.set(key, { type: key, totalPurchased: 0, totalAllocated: 0 })
    return totals.get(key)
  }
  for (const p of purchases || []) bucket(p.fuel_type).totalPurchased += Number(p.total_litres) || 0
  for (const a of allocations || []) bucket(a.fuel_type).totalAllocated += Number(a.litres_allocated) || 0

  // Canonical types first (in FUEL_TYPES order), then extras (e.g. 'Unknown').
  const rank = (type) => {
    const i = FUEL_TYPES.indexOf(type)
    return i === -1 ? FUEL_TYPES.length : i
  }
  const byType = [...totals.values()]
    .map((t) => ({ ...t, balance: t.totalPurchased - t.totalAllocated }))
    .sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type))

  return { byType }
}
