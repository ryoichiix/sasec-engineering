-- ============================================================
-- Sasec Engineering — Step 58: Per-type fuel tracking
--
-- The fuel ledger previously stored only litres, with no record of
-- WHICH fuel (petrol vs diesel). So the "Fuel Balance at Site" widget
-- summed petrol + diesel into one combined number, and allocations
-- debited a single shared pool. This adds a `fuel_type` column to both
-- fuel_purchases and fuel_allocations so balances can be computed and
-- debited SEPARATELY per fuel type (Diesel / Petrol / Hydraulic Oil / …).
--
-- Allowed values are enforced in the app via the FUEL_TYPES constant
-- (src/lib/fuel.js) — deliberately NOT a DB CHECK constraint, so new
-- types (e.g. a future "Grease") can be added by editing that array
-- without another migration.
--
-- Existing rows (which predate type tracking and have no recoverable
-- type — there is no FK back to the expense category) are backfilled to
-- 'Unknown', surfaced as its own legacy line in the balance widget.
--
-- Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.fuel_purchases   ADD COLUMN IF NOT EXISTS fuel_type text;
ALTER TABLE public.fuel_allocations ADD COLUMN IF NOT EXISTS fuel_type text;

-- Backfill legacy rows that predate type tracking.
UPDATE public.fuel_purchases   SET fuel_type = 'Unknown' WHERE fuel_type IS NULL;
UPDATE public.fuel_allocations SET fuel_type = 'Unknown' WHERE fuel_type IS NULL;

-- Default + NOT NULL as a safety net so no future row can be untyped.
ALTER TABLE public.fuel_purchases   ALTER COLUMN fuel_type SET DEFAULT 'Unknown';
ALTER TABLE public.fuel_allocations ALTER COLUMN fuel_type SET DEFAULT 'Unknown';
ALTER TABLE public.fuel_purchases   ALTER COLUMN fuel_type SET NOT NULL;
ALTER TABLE public.fuel_allocations ALTER COLUMN fuel_type SET NOT NULL;
