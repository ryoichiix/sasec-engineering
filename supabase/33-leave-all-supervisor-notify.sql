-- ============================================================
-- Sasec Engineering — Step 33: Notify ALL supervisors on every
-- leave status change (Fix 4).
--
-- Also ensures the callback → approve/reject path fires exactly
-- ONE notification (Fix 2 — server side).
--
-- Replaces the notify_leave_event() trigger function.
-- Safe to re-run.
-- ============================================================

create or replace function public.notify_leave_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates          text;
  v_applicant_name text;
  v_fm_name        text;
  v_payload        jsonb;
  v_boss           record;
  v_fm             record;
  v_sup            record;
begin
  -- ── Date range string ────────────────────────────────────
  if new.start_date = new.end_date then
    v_dates := to_char(new.start_date, 'FMMon FMDD, YYYY');
  else
    v_dates := to_char(new.start_date, 'FMMon FMDD')
            || ' – ' || to_char(new.end_date, 'FMMon FMDD, YYYY');
  end if;

  select full_name into v_applicant_name
    from public.profiles where id = new.supervisor_id;

  if new.field_manager_id is not null then
    select full_name into v_fm_name
      from public.profiles where id = new.field_manager_id;
  end if;

  v_payload := jsonb_build_object(
    'leave_request_id', new.id,
    'start_date',       new.start_date,
    'end_date',         new.end_date
  );

  -- ── INSERT: notify all field managers ────────────────────
  if tg_op = 'INSERT' then
    for v_fm in (
      select id from public.profiles
      where role = 'supervisor' and is_field_manager = true
        and id <> new.supervisor_id
    ) loop
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        v_fm.id, 'leave_request',
        '📋 Leave Request — ' || coalesce(v_applicant_name, 'A supervisor'),
        coalesce(v_applicant_name, 'A supervisor')
          || ' requested leave for ' || v_dates || '. Awaiting your review.',
        new.id, 'leave_request'
      );
    end loop;

    -- Also notify all OTHER supervisors (read-only awareness)
    for v_sup in (
      select id from public.profiles
      where role = 'supervisor'
        and id <> new.supervisor_id
        and (is_field_manager = false or is_field_manager is null)
    ) loop
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        v_sup.id, 'leave_request',
        '📋 New leave — ' || coalesce(v_applicant_name, 'A supervisor'),
        coalesce(v_applicant_name, 'A supervisor')
          || ' applied for leave: ' || v_dates || '.',
        new.id, 'leave_request'
      );
    end loop;

  -- ── UPDATE: status transition notifications ───────────────
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then

    -- Helper: notify ALL supervisors except the applicant themselves
    -- (used as a broadcast after every final decision)
    -- We use a nested block to avoid repeating the loop.

    -- 1. FM approved → applicant + every boss + all other supervisors
    if old.status = 'pending_field_manager' and new.status = 'pending_boss' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '✅ Leave forwarded to Boss',
        'Your leave for ' || v_dates
          || ' was reviewed by the Field Manager and sent to the Boss.',
        new.id, 'leave_request'
      );
      for v_boss in select id from public.profiles where role = 'boss' loop
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          v_boss.id, 'leave_request',
          '📋 Leave awaiting your decision — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || ' requested leave for ' || v_dates
            || ' (Field Manager approved).',
          new.id, 'leave_request'
        );
      end loop;
      -- Notify all other supervisors
      for v_sup in (
        select id from public.profiles
        where role = 'supervisor' and id <> new.supervisor_id
      ) loop
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          v_sup.id, 'leave_decision',
          '📋 Leave update — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || '''s leave (' || v_dates || ') approved by Field Manager — awaiting Boss.',
          new.id, 'leave_request'
        );
      end loop;

    -- 2. FM rejected → applicant + all other supervisors
    elsif old.status = 'pending_field_manager' and new.status = 'rejected' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '❌ Leave rejected by Field Manager',
        'Your leave for ' || v_dates || ' was rejected by the Field Manager.',
        new.id, 'leave_request'
      );
      for v_sup in (
        select id from public.profiles
        where role = 'supervisor' and id <> new.supervisor_id
      ) loop
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          v_sup.id, 'leave_decision',
          '❌ Leave rejected — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || '''s leave (' || v_dates || ') was rejected by Field Manager.',
          new.id, 'leave_request'
        );
      end loop;

    -- 3. Boss approved (from pending_boss OR callback_requested)
    elsif old.status in ('pending_boss', 'callback_requested') and new.status = 'approved' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '✅ Leave approved',
        'Your leave for ' || v_dates || ' has been approved by the Boss.',
        new.id, 'leave_request'
      );
      -- FM gets a separate personal notification
      if new.field_manager_id is not null then
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          new.field_manager_id, 'leave_decision',
          '✅ Leave approved by Boss',
          'Boss approved ' || coalesce(v_applicant_name, 'a supervisor')
            || '''s leave for ' || v_dates || '.',
          new.id, 'leave_request'
        );
      end if;
      -- Notify all other supervisors (awareness broadcast)
      for v_sup in (
        select id from public.profiles
        where role = 'supervisor'
          and id <> new.supervisor_id
          and (new.field_manager_id is null or id <> new.field_manager_id)
      ) loop
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          v_sup.id, 'leave_decision',
          '✅ Leave approved — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || '''s leave (' || v_dates || ') approved by Boss.',
          new.id, 'leave_request'
        );
      end loop;

    -- 4. Boss rejected (from pending_boss OR callback_requested)
    elsif old.status in ('pending_boss', 'callback_requested') and new.status = 'rejected' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '❌ Leave rejected',
        'Your leave for ' || v_dates || ' has been rejected by the Boss.',
        new.id, 'leave_request'
      );
      if new.field_manager_id is not null then
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          new.field_manager_id, 'leave_decision',
          '❌ Leave rejected by Boss',
          'Boss rejected ' || coalesce(v_applicant_name, 'a supervisor')
            || '''s leave for ' || v_dates || '.',
          new.id, 'leave_request'
        );
      end if;
      -- Notify all other supervisors
      for v_sup in (
        select id from public.profiles
        where role = 'supervisor'
          and id <> new.supervisor_id
          and (new.field_manager_id is null or id <> new.field_manager_id)
      ) loop
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          v_sup.id, 'leave_decision',
          '❌ Leave rejected — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || '''s leave (' || v_dates || ') was rejected by Boss.',
          new.id, 'leave_request'
        );
      end loop;

    -- 5. Boss requested callback → applicant only (not a final decision)
    elsif new.status = 'callback_requested' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_request',
        '📞 Callback requested by Boss',
        'Boss has requested a callback regarding your leave for ' || v_dates
          || '. Please contact them before a decision is made.',
        new.id, 'leave_request'
      );
    end if;
  end if;

  return new;
end;
$$;

-- Re-attach the trigger (idempotent)
drop trigger if exists trg_notify_leave on public.leave_requests;
create trigger trg_notify_leave
  after insert or update on public.leave_requests
  for each row execute function public.notify_leave_event();
