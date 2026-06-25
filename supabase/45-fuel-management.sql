-- ============================================================
-- Sasec Engineering — Step 45: Fuel Management
-- Diesel/petrol bulk purchase + per-vehicle allocation + running balance.
-- Safe to re-run (all idempotent).
-- ============================================================

-- ── Fuel purchases (when diesel/petrol is bought) ──────────────
CREATE TABLE IF NOT EXISTS public.fuel_purchases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL DEFAULT CURRENT_DATE,
  total_litres numeric NOT NULL,
  price_per_litre numeric,
  total_amount numeric,
  supplier text,
  supervisor_id uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ── Fuel allocations (distribution to vehicles) ────────────────
CREATE TABLE IF NOT EXISTS public.fuel_allocations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_id uuid REFERENCES fuel_purchases(id),
  date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES vehicles(id),
  vehicle_no text,
  litres_allocated numeric NOT NULL,
  supervisor_id uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ── Row level security ─────────────────────────────────────────
ALTER TABLE public.fuel_purchases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users read fuel_purchases"   ON public.fuel_purchases;
DROP POLICY IF EXISTS "Auth users read fuel_allocations" ON public.fuel_allocations;

CREATE POLICY "Auth users read fuel_purchases"   ON public.fuel_purchases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth users read fuel_allocations" ON public.fuel_allocations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
