-- ============================================================
-- FIX: Rebuild notifications table from scratch
-- Run this in Supabase SQL Editor if 14-notifications-and-flow.sql
-- left the table in a broken state.
-- ============================================================

-- 1. Drop whatever exists (cascade removes dependent indexes + policies)
DROP TABLE IF EXISTS public.notifications CASCADE;

-- 2. Recreate with correct schema
CREATE TABLE public.notifications (
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

CREATE INDEX notifications_user_idx
  ON public.notifications (user_id, is_read, created_at DESC);

-- 3. Row-Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Each user can only read their own notifications
CREATE POLICY "notif_own_select" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- Each user can mark their own notifications as read
CREATE POLICY "notif_own_update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Any authenticated user can create a notification for any user
-- (workers need to notify supervisors/boss and vice versa)
CREATE POLICY "notif_authenticated_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 4. Enable Supabase Realtime so the bell updates instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 5. Recreate the RPCs (idempotent)

CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id        uuid,
  p_title          text,
  p_message        text      DEFAULT NULL,
  p_type           text      DEFAULT 'info',
  p_reference_id   uuid      DEFAULT NULL,
  p_reference_type text      DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
  VALUES (p_user_id, p_type, p_title, p_message, p_reference_id, p_reference_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_supervisors_and_boss(
  p_title          text,
  p_message        text      DEFAULT NULL,
  p_type           text      DEFAULT 'info',
  p_reference_id   uuid      DEFAULT NULL,
  p_reference_type text      DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
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
