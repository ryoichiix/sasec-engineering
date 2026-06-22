-- ============================================================
-- Sasec Engineering — Step 18: Fix leave request queue
--
-- Problems fixed:
--   1. Existing leave_requests stuck in 'pending_supervisor' status
--      are invisible to the boss (UI queries 'pending_boss' only).
--   2. The BEFORE UPDATE trigger blocks the boss from deciding on
--      any row that still has 'pending_supervisor' status.
--   3. The BEFORE INSERT trigger may not have been updated to write
--      'pending_boss' (migration 14 dependency).
--   4. The UPDATE RLS policy also blocks boss on pending_supervisor rows.
--   5. Supervisors can't read other workers' profiles → worker names
--      show as "Unnamed worker" in the leave queue.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Migrate any stuck rows to pending_boss ─────────────────
UPDATE public.leave_requests
  SET status = 'pending_boss'
  WHERE status = 'pending_supervisor';

-- ── 2. Ensure INSERT trigger always sets pending_boss ─────────
CREATE OR REPLACE FUNCTION public.leave_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supervisor uuid;
BEGIN
  -- Always attribute the request to the calling authenticated user
  new.worker_id := auth.uid();

  -- Record supervisor for reference; null is acceptable
  SELECT supervisor_id INTO v_supervisor
    FROM public.profiles WHERE id = new.worker_id;

  new.supervisor_id         := v_supervisor;
  new.status                := 'pending_boss';  -- skip supervisor step
  new.supervisor_decision   := null;
  new.supervisor_note       := null;
  new.supervisor_decided_at := null;
  new.boss_id               := null;
  new.boss_decision         := null;
  new.boss_note             := null;
  new.boss_decided_at       := null;

  RETURN new;
END;
$$;

-- Re-bind (idempotent)
DROP TRIGGER IF EXISTS leave_requests_before_insert ON public.leave_requests;
CREATE TRIGGER leave_requests_before_insert
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_before_insert();

-- ── 3. Rewrite UPDATE trigger: boss decides on any pending row ─
--  Old logic had separate branches for pending_supervisor (supervisor only)
--  and pending_boss (boss only). Now all pending requests go to boss.
CREATE OR REPLACE FUNCTION public.leave_requests_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF old.status IN ('pending_supervisor', 'pending_boss') THEN
    -- Only the boss can approve or reject
    IF NOT public.is_boss() THEN
      RAISE EXCEPTION 'Only the boss can decide on a pending leave request';
    END IF;
    IF new.boss_decision IS NULL THEN
      RAISE EXCEPTION 'boss_decision is required';
    END IF;

    -- Derive final status from decision
    new.status := CASE new.boss_decision
      WHEN 'approved' THEN 'approved'::public.leave_status
      WHEN 'rejected' THEN 'rejected'::public.leave_status
    END;
    new.boss_decided_at := now();
    new.boss_id         := auth.uid();

    -- Freeze immutable fields
    new.worker_id             := old.worker_id;
    new.supervisor_id         := old.supervisor_id;
    new.start_date            := old.start_date;
    new.end_date              := old.end_date;
    new.reason                := old.reason;
    new.supervisor_decision   := old.supervisor_decision;
    new.supervisor_note       := old.supervisor_note;
    new.supervisor_decided_at := old.supervisor_decided_at;

  ELSE
    RAISE EXCEPTION 'Cannot update a leave request with status ''%''', old.status;
  END IF;

  RETURN new;
END;
$$;

-- Re-bind
DROP TRIGGER IF EXISTS leave_requests_before_update ON public.leave_requests;
CREATE TRIGGER leave_requests_before_update
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_before_update();

-- ── 4. Fix UPDATE RLS: allow boss to update pending_supervisor rows too ─
DROP POLICY IF EXISTS "leave_boss_upd" ON public.leave_requests;
CREATE POLICY "leave_boss_upd"
  ON public.leave_requests
  FOR UPDATE
  USING (
    status IN ('pending_supervisor', 'pending_boss') AND public.is_boss()
  )
  WITH CHECK (public.is_boss());

-- ── 5. Allow supervisors to read all worker profiles ──────────
--  Without this, the leave queue shows "Unnamed worker" for
--  everyone except the viewer's own profile.
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_boss()
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p2
      WHERE p2.id = auth.uid() AND p2.role = 'supervisor'
    )
  );
