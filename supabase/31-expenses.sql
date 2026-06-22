-- ============================================================
-- Sasec Engineering — Step 31: Expense Tracker
-- Safe to re-run (all idempotent).
-- ============================================================

-- ── expenses table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  category      text          NOT NULL
    CHECK (category IN ('Petrol','Diesel','Food','Materials','Travel','Other')),
  expense_date  date          NOT NULL DEFAULT CURRENT_DATE,
  description   text,
  receipt_path  text,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_supervisor_date_idx
  ON public.expenses (supervisor_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS expenses_date_idx
  ON public.expenses (expense_date DESC);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_supervisor_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_supervisor_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_boss_select"       ON public.expenses;

CREATE POLICY "expenses_supervisor_insert" ON public.expenses
  FOR INSERT WITH CHECK (supervisor_id = auth.uid() AND public.is_supervisor());

CREATE POLICY "expenses_supervisor_select" ON public.expenses
  FOR SELECT USING (supervisor_id = auth.uid());

CREATE POLICY "expenses_boss_select" ON public.expenses
  FOR SELECT USING (public.is_boss());

-- ── Storage bucket for receipts ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_supervisor_upload" ON storage.objects;
DROP POLICY IF EXISTS "receipts_supervisor_read"   ON storage.objects;

CREATE POLICY "receipts_supervisor_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'expense-receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "receipts_supervisor_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'expense-receipts'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.is_boss()
    )
  );
