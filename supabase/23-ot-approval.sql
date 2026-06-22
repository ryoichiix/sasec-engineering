-- ============================================================
-- Step 23: OT approval workflow
--
-- When a supervisor records ot_hours > 3 on an attendance row,
-- the system flips ot_status to 'pending' and notifies every boss.
-- Boss approves → 'approved' → payroll counts the OT.
-- Boss rejects → 'rejected' AND ot_hours is forced back to 0.
--
-- OT ≤ 3 hours never needs approval (ot_status stays NULL).
-- Safe to re-run.
-- ============================================================

-- 1. New columns ----------------------------------------------
alter table public.attendance
  add column if not exists ot_status      text
    check (ot_status in ('pending', 'approved', 'rejected')),
  add column if not exists ot_decided_at  timestamptz,
  add column if not exists ot_decided_by  uuid references public.profiles(id);

create index if not exists attendance_ot_status_idx
  on public.attendance (ot_status) where ot_status is not null;

-- 2. BEFORE trigger: derive ot_status from ot_hours -----------
create or replace function public.attendance_set_ot_status()
returns trigger
language plpgsql
as $$
begin
  -- If OT got zeroed (e.g. supervisor marked absent or cleared the OT input)
  -- wipe approval metadata too.
  if new.ot_hours = 0 or new.ot_hours is null then
    new.ot_status     := null;
    new.ot_decided_at := null;
    new.ot_decided_by := null;
    return new;
  end if;

  -- OT ≤ 3 → auto-approved (status stays NULL, treated as approved by payroll).
  if new.ot_hours <= 3 then
    -- If it was previously > 3 and pending/approved/rejected, clear
    if new.ot_status is not null then
      new.ot_status     := null;
      new.ot_decided_at := null;
      new.ot_decided_by := null;
    end if;
    return new;
  end if;

  -- OT > 3
  if tg_op = 'INSERT' then
    new.ot_status     := 'pending';
    new.ot_decided_at := null;
    new.ot_decided_by := null;
  elsif tg_op = 'UPDATE' then
    -- Boss decision in flight — preserve status set by the caller (approved/rejected).
    -- Detect a "decision" update by ot_status being explicitly set to approved/rejected.
    if new.ot_status in ('approved', 'rejected') and old.ot_status is distinct from new.ot_status then
      -- caller (boss) is deciding; keep their value
      new.ot_decided_at := coalesce(new.ot_decided_at, now());
      -- Reject → force ot_hours back to 0
      if new.ot_status = 'rejected' then
        new.ot_hours := 0;
      end if;
    elsif old.ot_hours is distinct from new.ot_hours and
          (old.ot_hours is null or old.ot_hours <= 3) and
          new.ot_hours > 3 then
      -- supervisor crossed the 3-hr threshold this update
      new.ot_status     := 'pending';
      new.ot_decided_at := null;
      new.ot_decided_by := null;
    elsif new.ot_status is null then
      -- still > 3 but somehow status got nulled by client — treat as pending
      new.ot_status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_set_ot_status on public.attendance;
create trigger attendance_set_ot_status
  before insert or update on public.attendance
  for each row execute function public.attendance_set_ot_status();

-- 3. AFTER trigger: notify every boss when OT becomes pending ----
create or replace function public.notify_ot_pending()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_worker_name text;
  v_date_str    text;
  v_boss        record;
begin
  if new.ot_status = 'pending'
     and (tg_op = 'INSERT' or old.ot_status is distinct from 'pending') then
    select full_name into v_worker_name
      from public.profiles where id = new.worker_id;
    v_date_str := to_char(new.attendance_date, 'FMMon FMDD, YYYY');

    for v_boss in select id from public.profiles where role = 'boss' loop
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_boss.id,
        'ot_request',
        'OT approval needed',
        coalesce(v_worker_name, 'A worker')
          || ' has ' || new.ot_hours || ' OT hours on ' || v_date_str
          || ' (above 3-hr threshold).',
        new.id,
        'attendance'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_ot_pending on public.attendance;
create trigger trg_notify_ot_pending
  after insert or update on public.attendance
  for each row execute function public.notify_ot_pending();
