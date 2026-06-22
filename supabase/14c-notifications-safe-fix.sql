-- ============================================================
-- SAFE FIX v3 — matches actual DB schema (type column, is_read column)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ── STEP 1: Ensure table exists (already exists, so this is a no-op) ──
CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type           text        NOT NULL DEFAULT 'info',
  title          text        NOT NULL,
  message        text,
  is_read        boolean     NOT NULL DEFAULT false,
  reference_id   uuid,
  reference_type text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── STEP 2: Fix column names if table has old names ────────
DO $$
BEGIN
  -- rename "read" → "is_read" if old version exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='read'
  ) THEN
    ALTER TABLE public.notifications RENAME COLUMN "read" TO is_read;
  END IF;

  -- add is_read if missing entirely
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='is_read'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN is_read boolean NOT NULL DEFAULT false;
  END IF;

  -- add type if missing entirely
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='type'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN type text NOT NULL DEFAULT 'info';
  END IF;
END $$;

-- ── STEP 3: Enable RLS ────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ── STEP 4: Policies (drop first so re-running is safe) ───────
DROP POLICY IF EXISTS "notif_own_select"            ON public.notifications;
DROP POLICY IF EXISTS "notif_own_update"            ON public.notifications;
DROP POLICY IF EXISTS "notif_authenticated_insert"  ON public.notifications;

CREATE POLICY "notif_own_select" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notif_own_update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "notif_authenticated_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── STEP 5: RPCs ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id        uuid,
  p_title          text,
  p_message        text    DEFAULT NULL,
  p_type           text    DEFAULT 'info',
  p_reference_id   uuid    DEFAULT NULL,
  p_reference_type text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
  VALUES (p_user_id, p_type, p_title, p_message, p_reference_id, p_reference_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_supervisors_and_boss(
  p_title          text,
  p_message        text    DEFAULT NULL,
  p_type           text    DEFAULT 'info',
  p_reference_id   uuid    DEFAULT NULL,
  p_reference_type text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  FOR v_uid IN (
    SELECT id FROM public.profiles WHERE role IN ('supervisor', 'boss')
  ) LOOP
    INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
    VALUES (v_uid, p_type, p_title, p_message, p_reference_id, p_reference_type);
  END LOOP;
END;
$$;
