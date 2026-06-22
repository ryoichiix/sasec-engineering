-- ============================================================
-- Step 35: OT approval — Field Manager intermediary layer
--
-- New ot_status flow:
--   OT > 3 hrs → 'pending_field_manager'
--   FM approves → 'pending_boss'
--   FM rejects  → 'rejected' (ot_hours reset to 0)
--   Boss approves → 'approved'
--   Boss rejects  → 'rejected' (ot_hours reset to 0)
--
-- Also adds:
--   • ot_fm_decided_by / ot_fm_decided_at columns
--   • notification_ot_decided() AFTER trigger
--
-- Safe to re-run.
-- ============================================================

-- 1. Widen the ot_status check constraint to include new values ─
alter table public.attendance
  drop constraint if exists attendance_ot_status_check;

alter table public.attendance
  add constraint attendance_ot_status_check
  check (ot_status in (
    'pending',                  -- legacy value (treated as pending_field_manager)
    'pending_field_manager',
    'pending_boss',
    'approved',
    'rejected'
  ));

-- 2. FM decision columns ──────────────────────────────────────
alter table public.attendance
  add column if not exists ot_fm_decided_by  uuid references public.profiles(id),
  add column if not exists ot_fm_decided_at  timestamptz;

-- 3. Update BEFORE trigger: set pending_field_manager on new OT ─
create or replace function public.attendance_set_ot_status()
returns trigger
language plpgsql
as $$
begin
  -- Zeroed OT → wipe everything
  if new.ot_hours = 0 or new.ot_hours is null then
    new.ot_status        := null;
    new.ot_decided_at    := null;
    new.ot_decided_by    := null;
    new.ot_fm_decided_by := null;
    new.ot_fm_decided_at := null;
    return new;
  end if;

  -- OT ≤ 3 → auto-approved (no status)
  if new.ot_hours <= 3 then
    if new.ot_status is not null then
      new.ot_status        := null;
      new.ot_decided_at    := null;
      new.ot_decided_by    := null;
      new.ot_fm_decided_by := null;
      new.ot_fm_decided_at := null;
    end if;
    return new;
  end if;

  -- OT > 3 ──────────────────────────────────────────────────
  if tg_op = 'INSERT' then
    new.ot_status        := 'pending_field_manager';
    new.ot_decided_at    := null;
    new.ot_decided_by    := null;
    new.ot_fm_decided_by := null;
    new.ot_fm_decided_at := null;

  elsif tg_op = 'UPDATE' then
    -- FM or Boss is submitting a decision — detect by new.ot_status being
    -- explicitly set to one of the decision values.
    if new.ot_status in ('pending_boss', 'approved', 'rejected')
       and old.ot_status is distinct from new.ot_status then
      -- Timestamp FM decision
      if new.ot_status = 'pending_boss' then
        new.ot_fm_decided_at := coalesce(new.ot_fm_decided_at, now());
      end if;
      -- Timestamp boss decision
      if new.ot_status in ('approved', 'rejected') then
        new.ot_decided_at := coalesce(new.ot_decided_at, now());
      end if;
      -- Reject → zero out OT hours
      if new.ot_status = 'rejected' then
        new.ot_hours := 0;
      end if;

    -- Supervisor increased OT past the 3-hr threshold on this update
    elsif old.ot_hours is distinct from new.ot_hours
          and (old.ot_hours is null or old.ot_hours <= 3)
          and new.ot_hours > 3 then
      new.ot_status        := 'pending_field_manager';
      new.ot_decided_at    := null;
      new.ot_decided_by    := null;
      new.ot_fm_decided_by := null;
      new.ot_fm_decided_at := null;

    -- Still > 3 but status got cleared — re-pend
    elsif new.ot_status is null then
      new.ot_status := 'pending_field_manager';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attendance_ot_status on public.attendance;
create trigger trg_attendance_ot_status
  before insert or update on public.attendance
  for each row execute function public.attendance_set_ot_status();

-- 4. AFTER trigger: notify supervisor when OT is decided ──────
create or replace function public.notify_ot_decision()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_worker_name text;
  v_sup_id      uuid;
begin
  -- Only fire on status transitions that matter
  if tg_op <> 'UPDATE' then return new; end if;
  if old.ot_status is not distinct from new.ot_status then return new; end if;

  -- Get supervisor (who entered the OT) — they should be notified
  v_sup_id := new.supervisor_id;
  if v_sup_id is null then return new; end if;

  select full_name into v_worker_name
    from public.workers where id = new.worker_table_id;
  if v_worker_name is null then
    select full_name into v_worker_name
      from public.workers where id = new.worker_id;
  end if;

  -- FM approved → goes to Boss; notify supervisor
  if old.ot_status in ('pending', 'pending_field_manager')
     and new.ot_status = 'pending_boss' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'ot_decision',
      '✅ OT forwarded to Boss',
      coalesce(v_worker_name, 'Worker') || '''s OT on ' ||
        to_char(new.attendance_date, 'FMMon FMDD') ||
        ' was reviewed by the Field Manager and sent to the Boss.',
      new.id,
      'attendance'
    );

  -- Boss final approval
  elsif new.ot_status = 'approved' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'ot_decision',
      '✅ OT Approved',
      'Your OT request for ' || coalesce(v_worker_name, 'Worker') || ' on ' ||
        to_char(new.attendance_date, 'FMMon FMDD') ||
        ' has been approved by Boss.',
      new.id,
      'attendance'
    );

  -- Rejected by Boss (final decision) → ot_hours already zeroed by BEFORE trigger
  elsif new.ot_status = 'rejected' and old.ot_status = 'pending_boss' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'ot_decision',
      '❌ OT Rejected',
      'Your OT request for ' || coalesce(v_worker_name, 'Worker') || ' on ' ||
        to_char(new.attendance_date, 'FMMon FMDD') ||
        ' has been rejected by Boss.',
      new.id,
      'attendance'
    );

  -- Rejected by Field Manager → ot_hours already zeroed by BEFORE trigger
  elsif new.ot_status = 'rejected' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'ot_decision',
      '❌ OT Rejected',
      coalesce(v_worker_name, 'Worker') || '''s OT on ' ||
        to_char(new.attendance_date, 'FMMon FMDD') ||
        ' was rejected by the Field Manager. OT hours have been reset to 0.',
      new.id,
      'attendance'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_ot_decision on public.attendance;
create trigger trg_notify_ot_decision
  after update on public.attendance
  for each row execute function public.notify_ot_decision();

-- 5. Migrate any legacy 'pending' rows to 'pending_field_manager' ─
update public.attendance
  set ot_status = 'pending_field_manager'
  where ot_status = 'pending';
