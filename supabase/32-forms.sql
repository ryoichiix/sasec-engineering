-- ============================================================
-- Sasec Engineering — Step 32: Form Templates
-- Safe to re-run.
-- ============================================================

-- ── leave_disclaimers ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_disclaimers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  worker_name     text        NOT NULL,
  worker_phone    text,
  leave_start     date        NOT NULL,
  leave_end       date        NOT NULL,
  supervisor_name text        NOT NULL,
  scan_path       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ld_supervisor_created_idx ON public.leave_disclaimers (supervisor_id, created_at DESC);
ALTER TABLE public.leave_disclaimers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ld_sup_ins"  ON public.leave_disclaimers;
DROP POLICY IF EXISTS "ld_sup_sel"  ON public.leave_disclaimers;
DROP POLICY IF EXISTS "ld_sup_upd"  ON public.leave_disclaimers;
DROP POLICY IF EXISTS "ld_boss_sel" ON public.leave_disclaimers;

CREATE POLICY "ld_sup_ins"  ON public.leave_disclaimers FOR INSERT WITH CHECK (supervisor_id = auth.uid() AND public.is_supervisor());
CREATE POLICY "ld_sup_sel"  ON public.leave_disclaimers FOR SELECT USING (supervisor_id = auth.uid());
CREATE POLICY "ld_sup_upd"  ON public.leave_disclaimers FOR UPDATE USING (supervisor_id = auth.uid()) WITH CHECK (supervisor_id = auth.uid());
CREATE POLICY "ld_boss_sel" ON public.leave_disclaimers FOR SELECT USING (public.is_boss());

-- ── onboarding_forms ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_forms (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id           uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name               text        NOT NULL,
  phone_number            text,
  address                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  previous_experience     text,
  designation             text,
  date_of_joining         date,
  supervisor_name         text,
  scan_path               text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS of_supervisor_created_idx ON public.onboarding_forms (supervisor_id, created_at DESC);
ALTER TABLE public.onboarding_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "of_sup_ins"  ON public.onboarding_forms;
DROP POLICY IF EXISTS "of_sup_sel"  ON public.onboarding_forms;
DROP POLICY IF EXISTS "of_sup_upd"  ON public.onboarding_forms;
DROP POLICY IF EXISTS "of_boss_sel" ON public.onboarding_forms;

CREATE POLICY "of_sup_ins"  ON public.onboarding_forms FOR INSERT WITH CHECK (supervisor_id = auth.uid() AND public.is_supervisor());
CREATE POLICY "of_sup_sel"  ON public.onboarding_forms FOR SELECT USING (supervisor_id = auth.uid());
CREATE POLICY "of_sup_upd"  ON public.onboarding_forms FOR UPDATE USING (supervisor_id = auth.uid()) WITH CHECK (supervisor_id = auth.uid());
CREATE POLICY "of_boss_sel" ON public.onboarding_forms FOR SELECT USING (public.is_boss());

-- ── Storage bucket for scanned signed copies ──────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('form-scans','form-scans',false,10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "fs_sup_upload" ON storage.objects;
DROP POLICY IF EXISTS "fs_read"       ON storage.objects;

CREATE POLICY "fs_sup_upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id='form-scans' AND auth.uid()::text=(storage.foldername(name))[1]);

CREATE POLICY "fs_read" ON storage.objects FOR SELECT
  USING (bucket_id='form-scans' AND
    (auth.uid()::text=(storage.foldername(name))[1] OR public.is_boss()));
