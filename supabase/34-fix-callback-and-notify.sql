-- ============================================================
-- Sasec Engineering — Step 34: Fix callback approval bug +
-- all-supervisor notifications (Fix 2 + Fix 4).
--
-- Root cause of Fix 2:
--   In the BEFORE UPDATE trigger, the branch at line 122 checked
--   `new.status = 'callback_requested'` before checking
--   `new.boss_decision IS NOT NULL`. When boss sent
--   { boss_decision: 'approved' } from callback_requested state,
--   `new.status` was still 'callback_requested' (the client only
--   sent boss_decision, not a new status), so the trigger entered
--   the wrong branch and nullified boss_decision. The status never
--   changed, so the AFTER trigger never fired notifications either.
--
-- Fix: check boss_decision IS NOT NULL first (final decision) before
-- checking whether new.status = 'callback_requested' (new callback).
--
-- Also adds duplicate-prevention to the AFTER notification trigger
-- (guards against the same notification being inserted twice within
-- 30 seconds for the same leave_request + user + type).
--
-- Safe to re-run.
-- ============================================================

-- ── 1. BEFORE UPDATE trigger: correct branch ordering ────────
CREATE OR REPLACE FUNCTION public.leave_requests_before_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Field Manager stage ───────────────────────────────────
  IF old.status = 'pending_field_manager' THEN
    IF NOT public.is_field_manager() THEN
      RAISE EXCEPTION 'Only a Field Manager can decide on this request';
    END IF;
    IF new.field_manager_decision IS NULL THEN
      RAISE EXCEPTION 'field_manager_decision is required';
    END IF;

    new.field_manager_id         := auth.uid();
    new.field_manager_decided_at := now();
    new.status := CASE new.field_manager_decision
      WHEN 'approved' THEN 'pending_boss'::public.leave_status
      WHEN 'rejected' THEN 'rejected'::public.leave_status
    END;

    -- Freeze immutable fields
    new.supervisor_id       := old.supervisor_id;
    new.start_date          := old.start_date;
    new.end_date            := old.end_date;
    new.reason              := old.reason;
    new.boss_id             := NULL;
    new.boss_decision       := NULL;
    new.boss_note           := NULL;
    new.boss_decided_at     := NULL;

  -- ── Boss stage ────────────────────────────────────────────
  ELSIF old.status IN ('pending_boss', 'callback_requested') THEN
    IF NOT public.is_boss() THEN
      RAISE EXCEPTION 'Only the boss can decide on this request';
    END IF;

    -- *** KEY FIX: check boss_decision FIRST ***
    -- If boss_decision is not null → this is a FINAL decision.
    -- This works from both 'pending_boss' AND 'callback_requested' states.
    -- The old bug: checking `new.status = 'callback_requested'` first meant
    -- that when boss sent boss_decision='approved' from callback_requested
    -- state, new.status was still 'callback_requested' (unchanged), so the
    -- trigger incorrectly entered the callback branch and nullified the decision.
    IF new.boss_decision IS NOT NULL THEN
      new.status          := CASE new.boss_decision
        WHEN 'approved' THEN 'approved'::public.leave_status
        WHEN 'rejected' THEN 'rejected'::public.leave_status
      END;
      new.boss_id         := auth.uid();
      new.boss_decided_at := now();

    -- Only if boss_decision is null AND status is being set to callback_requested
    -- is this actually a new callback request.
    ELSIF new.status = 'callback_requested' THEN
      new.boss_id         := auth.uid();
      new.boss_decided_at := now();
      new.boss_decision   := NULL;

    ELSE
      RAISE EXCEPTION 'boss_decision is required to make a final decision';
    END IF;

    -- Freeze immutable fields
    new.supervisor_id            := old.supervisor_id;
    new.start_date               := old.start_date;
    new.end_date                 := old.end_date;
    new.reason                   := old.reason;
    new.field_manager_id         := old.field_manager_id;
    new.field_manager_decision   := old.field_manager_decision;
    new.field_manager_note       := old.field_manager_note;
    new.field_manager_decided_at := old.field_manager_decided_at;

  ELSE
    RAISE EXCEPTION 'Cannot update a leave request with status ''%''', old.status;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS leave_requests_before_update ON public.leave_requests;
CREATE TRIGGER leave_requests_before_update
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_before_update();


-- ── 2. AFTER trigger: all-supervisor notify + dedup guard ────
--
-- Every status transition notifies ALL supervisors (Fix 4).
-- A dedup guard prevents the same notification being inserted
-- twice within 30 s for the same (user_id, reference_id, type)
-- in case of any concurrent trigger execution or retry.
CREATE OR REPLACE FUNCTION public.notify_leave_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates          text;
  v_applicant_name text;
  v_fm_name        text;
  v_payload        jsonb;
  v_boss           record;
  v_sup            record;

  -- Helper: inserts a notification only if one with the same
  -- (user_id, reference_id, type) was NOT already inserted in
  -- the last 30 seconds (prevents duplicates on retries).
  -- Implemented inline via a nested block below.
BEGIN
  -- ── Date string ─────────────────────────────────────────────
  IF new.start_date = new.end_date THEN
    v_dates := to_char(new.start_date, 'FMMon FMDD, YYYY');
  ELSE
    v_dates := to_char(new.start_date, 'FMMon FMDD')
            || ' – ' || to_char(new.end_date, 'FMMon FMDD, YYYY');
  END IF;

  SELECT full_name INTO v_applicant_name
    FROM public.profiles WHERE id = new.supervisor_id;

  IF new.field_manager_id IS NOT NULL THEN
    SELECT full_name INTO v_fm_name
      FROM public.profiles WHERE id = new.field_manager_id;
  END IF;

  -- ── INSERT: supervisor just applied ─────────────────────────
  -- Notify all field managers (they need to review).
  -- Notify all other supervisors (awareness).
  IF tg_op = 'INSERT' THEN
    FOR v_sup IN (
      SELECT id FROM public.profiles
      WHERE role = 'supervisor' AND id <> new.supervisor_id
    ) LOOP
      -- Skip if already notified within 30 s (dedup guard)
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id       = v_sup.id
          AND reference_id  = new.id
          AND reference_type = 'leave_request'
          AND type          = 'leave_request'
          AND created_at    > now() - interval '30 seconds'
      ) THEN
        INSERT INTO public.notifications
          (user_id, type, title, message, reference_id, reference_type)
        VALUES (
          v_sup.id,
          'leave_request',
          CASE
            WHEN EXISTS(
              SELECT 1 FROM public.profiles
              WHERE id = v_sup.id AND is_field_manager = true
            )
            THEN '📋 Leave Request — ' || coalesce(v_applicant_name, 'A supervisor')
            ELSE '📋 New leave — '     || coalesce(v_applicant_name, 'A supervisor')
          END,
          CASE
            WHEN EXISTS(
              SELECT 1 FROM public.profiles
              WHERE id = v_sup.id AND is_field_manager = true
            )
            THEN coalesce(v_applicant_name, 'A supervisor')
              || ' requested leave for ' || v_dates || '. Awaiting your review.'
            ELSE coalesce(v_applicant_name, 'A supervisor')
              || ' applied for leave: ' || v_dates || '.'
          END,
          new.id,
          'leave_request'
        );
      END IF;
    END LOOP;

  -- ── UPDATE: status changed ────────────────────────────────────
  ELSIF tg_op = 'UPDATE' AND old.status IS DISTINCT FROM new.status THEN

    -- FM approved → pending_boss
    IF old.status = 'pending_field_manager' AND new.status = 'pending_boss' THEN

      -- Applicant
      INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
      SELECT new.supervisor_id, 'leave_decision',
        '✅ Leave forwarded to Boss',
        'Your leave for ' || v_dates || ' was reviewed by the Field Manager and sent to the Boss.',
        new.id, 'leave_request'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id=new.supervisor_id AND reference_id=new.id
          AND type='leave_decision' AND created_at > now() - interval '30 seconds'
      );

      -- Every boss
      FOR v_boss IN SELECT id FROM public.profiles WHERE role = 'boss' LOOP
        INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
        SELECT v_boss.id, 'leave_request',
          '📋 Leave awaiting your decision — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || ' requested leave for ' || v_dates
            || ' (Field Manager approved).',
          new.id, 'leave_request'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_id=v_boss.id AND reference_id=new.id
            AND type='leave_request' AND created_at > now() - interval '30 seconds'
        );
      END LOOP;

      -- All other supervisors (awareness)
      FOR v_sup IN (
        SELECT id FROM public.profiles
        WHERE role = 'supervisor' AND id <> new.supervisor_id
      ) LOOP
        INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
        SELECT v_sup.id, 'leave_decision',
          '📋 Leave update — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || '''s leave (' || v_dates || ') approved by Field Manager — awaiting Boss.',
          new.id, 'leave_request'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_id=v_sup.id AND reference_id=new.id
            AND type='leave_decision' AND created_at > now() - interval '30 seconds'
        );
      END LOOP;

    -- FM rejected
    ELSIF old.status = 'pending_field_manager' AND new.status = 'rejected' THEN

      FOR v_sup IN (
        SELECT id FROM public.profiles WHERE role = 'supervisor'
      ) LOOP
        INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
        SELECT v_sup.id, 'leave_decision',
          CASE WHEN v_sup.id = new.supervisor_id
            THEN '❌ Leave rejected by Field Manager'
            ELSE '❌ Leave rejected — ' || coalesce(v_applicant_name, 'A supervisor')
          END,
          CASE WHEN v_sup.id = new.supervisor_id
            THEN 'Your leave for ' || v_dates || ' was rejected by the Field Manager.'
            ELSE coalesce(v_applicant_name, 'A supervisor')
              || '''s leave (' || v_dates || ') was rejected by the Field Manager.'
          END,
          new.id, 'leave_request'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_id=v_sup.id AND reference_id=new.id
            AND type='leave_decision' AND created_at > now() - interval '30 seconds'
        );
      END LOOP;

    -- Boss approved (from pending_boss OR callback_requested)
    ELSIF old.status IN ('pending_boss', 'callback_requested') AND new.status = 'approved' THEN

      FOR v_sup IN (
        SELECT id FROM public.profiles WHERE role = 'supervisor'
      ) LOOP
        INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
        SELECT v_sup.id, 'leave_decision',
          CASE WHEN v_sup.id = new.supervisor_id
            THEN '✅ Leave approved'
            ELSE '✅ Leave approved — ' || coalesce(v_applicant_name, 'A supervisor')
          END,
          CASE WHEN v_sup.id = new.supervisor_id
            THEN 'Your leave for ' || v_dates || ' has been approved by the Boss.'
            ELSE coalesce(v_applicant_name, 'A supervisor')
              || '''s leave (' || v_dates || ') was approved by the Boss.'
          END,
          new.id, 'leave_request'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_id=v_sup.id AND reference_id=new.id
            AND type='leave_decision' AND created_at > now() - interval '30 seconds'
        );
      END LOOP;

    -- Boss rejected (from pending_boss OR callback_requested)
    ELSIF old.status IN ('pending_boss', 'callback_requested') AND new.status = 'rejected' THEN

      FOR v_sup IN (
        SELECT id FROM public.profiles WHERE role = 'supervisor'
      ) LOOP
        INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
        SELECT v_sup.id, 'leave_decision',
          CASE WHEN v_sup.id = new.supervisor_id
            THEN '❌ Leave rejected'
            ELSE '❌ Leave rejected — ' || coalesce(v_applicant_name, 'A supervisor')
          END,
          CASE WHEN v_sup.id = new.supervisor_id
            THEN 'Your leave for ' || v_dates || ' has been rejected by the Boss.'
            ELSE coalesce(v_applicant_name, 'A supervisor')
              || '''s leave (' || v_dates || ') was rejected by the Boss.'
          END,
          new.id, 'leave_request'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_id=v_sup.id AND reference_id=new.id
            AND type='leave_decision' AND created_at > now() - interval '30 seconds'
        );
      END LOOP;

    -- Boss requested callback — notify applicant only
    ELSIF new.status = 'callback_requested' THEN

      INSERT INTO public.notifications (user_id, type, title, message, reference_id, reference_type)
      SELECT new.supervisor_id, 'leave_request',
        '📞 Callback requested by Boss',
        'Boss has requested a callback regarding your leave for ' || v_dates
          || '. Please contact them before a decision is made.',
        new.id, 'leave_request'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id=new.supervisor_id AND reference_id=new.id
          AND type='leave_request' AND message LIKE '%Callback%'
          AND created_at > now() - interval '30 seconds'
      );

    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave ON public.leave_requests;
CREATE TRIGGER trg_notify_leave
  AFTER INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_leave_event();
