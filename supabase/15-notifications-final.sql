-- ============================================================
-- FINAL notifications fix — run ONLY this file.
-- Your table already has the right columns (type, is_read).
-- This just adds RLS policies + the 2 RPC functions.
-- Safe to run multiple times.
-- ============================================================

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_own_select"           ON public.notifications;
DROP POLICY IF EXISTS "notif_own_update"           ON public.notifications;
DROP POLICY IF EXISTS "notif_authenticated_insert" ON public.notifications;

CREATE POLICY "notif_own_select" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notif_own_update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "notif_authenticated_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- RPC 1: notify a single user
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
  INSERT INTO public.notifications
    (user_id, type, title, message, reference_id, reference_type)
  VALUES
    (p_user_id, p_type, p_title, p_message, p_reference_id, p_reference_type);
END;
$$;

-- RPC 2: notify all supervisors + boss
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
    INSERT INTO public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    VALUES
      (v_uid, p_type, p_title, p_message, p_reference_id, p_reference_type);
  END LOOP;
END;
$$;
