import { supabase } from './supabase'

// ── Purchases ───────────────────────────────────────────────────

/**
 * Record a fuel purchase (diesel/petrol bought in bulk for the site).
 * `total_amount` is derived from litres × price so the fuel ledger and the
 * expenses ledger agree. Returns { data, error } with the created row.
 */
export function insertFuelPurchase({ date, totalLitres, pricePerLitre, supervisorId }) {
  const litres = Number(totalLitres)
  const price  = pricePerLitre ? Number(pricePerLitre) : null
  return supabase
    .from('fuel_purchases')
    .insert({
      date,
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
 * Site fuel balance (all-time, in litres): total purchased − total allocated.
 * Fails gracefully — returns zeroes if the tables aren't reachable, so the
 * card never crashes the page.
 */
export async function fetchFuelBalance() {
  const [{ data: purchases, error: pErr }, { data: allocations, error: aErr }] =
    await Promise.all([
      supabase.from('fuel_purchases').select('total_litres'),
      supabase.from('fuel_allocations').select('litres_allocated'),
    ])

  if (pErr || aErr) return { totalPurchased: 0, totalAllocated: 0, balance: 0 }

  const totalPurchased = (purchases || []).reduce(
    (sum, p) => sum + (Number(p.total_litres) || 0), 0,
  )
  const totalAllocated = (allocations || []).reduce(
    (sum, a) => sum + (Number(a.litres_allocated) || 0), 0,
  )
  return { totalPurchased, totalAllocated, balance: totalPurchased - totalAllocated }
}
