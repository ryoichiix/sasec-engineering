-- ============================================================
-- Sasec Engineering — Step 16: DEFINITIVE notifications fix
-- Run ONLY this file in the Supabase SQL Editor. Safe to re-run.
--
-- Why: the table had two conflicting schemas (old: kind/body/payload,
-- new: type/title/message/is_read) and leftover triggers kept inserting
-- the OLD column names on leave/work-plan/attendance writes. This script
-- makes ONE canonical schema and rewrites every writer to match it.
-- ============================================================

-- ── 0. Kill the legacy triggers that insert kind/body/payload ──
-- These are the real source of the "column ... does not exist" and
-- "null value in column title" errors on leave submit.
drop trigger if exists trg_notify_leave     on public.leave_requests;
drop function if exists public.notify_leave_event() cascade;

drop trigger if exists trg_notify_work_plan on public.work_plans;
drop trigger if exists trg_notify_absent    on public.attendance;

-- ── 1. Rebuild the notifications table with the canonical schema ──
-- (matches src/lib/notifications.js + NotificationBell + NotificationsCard)
drop table if exists public.notifications cascade;

create table public.notifications (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  type           text        not null default 'info',
  title          text        not null,
  message        text,
  is_read        boolean     not null default false,
  reference_id   uuid,
  reference_type text,
  created_at     timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

-- ── 2. RLS policies ──────────────────────────────────────────
drop policy if exists "notif_own_select"           on public.notifications;
drop policy if exists "notif_own_update"           on public.notifications;
drop policy if exists "notif_authenticated_insert" on public.notifications;

create policy "notif_own_select" on public.notifications
  for select using (user_id = auth.uid());

create policy "notif_own_update" on public.notifications
  for update using (user_id = auth.uid());

-- Any authenticated user can insert (workers notify supervisors/boss, etc.)
create policy "notif_authenticated_insert" on public.notifications
  for insert with check (auth.uid() is not null);

-- ── 3. Realtime (ignore error if already added) ──────────────
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- ── 4. RPCs used by the app (canonical columns) ──────────────
create or replace function public.notify_user(
  p_user_id        uuid,
  p_title          text,
  p_message        text default null,
  p_type           text default 'info',
  p_reference_id   uuid default null,
  p_reference_type text default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications
    (user_id, type, title, message, reference_id, reference_type)
  values
    (p_user_id,
     coalesce(p_type, 'info'),
     coalesce(p_title, 'Notification'),
     p_message, p_reference_id, p_reference_type);
end;
$$;

create or replace function public.notify_supervisors_and_boss(
  p_title          text,
  p_message        text default null,
  p_type           text default 'info',
  p_reference_id   uuid default null,
  p_reference_type text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid;
begin
  for v_uid in (
    select id from public.profiles where role in ('supervisor', 'boss')
  ) loop
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values
      (v_uid,
       coalesce(p_type, 'info'),
       coalesce(p_title, 'Notification'),
       p_message, p_reference_id, p_reference_type);
  end loop;
end;
$$;

-- ── 5. Rewrite the remaining server-side notifiers to the new
--      schema so they NEVER touch kind/body/payload again. ─────

-- 5a. Attendance: notify worker when marked absent
create or replace function public.notify_absent_worker()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'absent'
     and (tg_op = 'INSERT' or old.status is distinct from 'absent') then
    insert into public.notifications
      (user_id, type, title, message, reference_type)
    values (
      new.worker_id,
      'attendance_absent',
      'Marked absent',
      'You were marked absent on '
        || to_char(new.attendance_date, 'FMMon FMDD, YYYY') || '.',
      'attendance'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_absent on public.attendance;
create trigger trg_notify_absent
  after insert or update on public.attendance
  for each row execute function public.notify_absent_worker();

-- 5b. Work plans: notify boss when a plan/update is posted
create or replace function public.notify_work_plan_posted()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_supervisor_name text;
  v_date_str        text;
  v_morning_new     boolean := false;
  v_evening_new     boolean := false;
  v_boss            record;
begin
  if tg_op = 'INSERT' then
    v_morning_new := new.morning_plan is not null;
    v_evening_new := new.evening_update is not null;
  elsif tg_op = 'UPDATE' then
    v_morning_new := old.morning_plan is null and new.morning_plan is not null;
    v_evening_new := old.evening_update is null and new.evening_update is not null;
  end if;

  if not v_morning_new and not v_evening_new then
    return new;
  end if;

  select full_name into v_supervisor_name
    from public.profiles where id = new.supervisor_id;

  v_date_str := to_char(new.plan_date, 'FMMon FMDD, YYYY');

  for v_boss in select id from public.profiles where role = 'boss' loop
    if v_morning_new then
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_boss.id, 'work_plan', 'Morning plan posted',
        coalesce(v_supervisor_name, 'A supervisor')
          || ' posted the morning plan for ' || v_date_str || '.',
        new.id, 'work_plan'
      );
    end if;
    if v_evening_new then
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_boss.id, 'work_plan', 'Evening update posted',
        coalesce(v_supervisor_name, 'A supervisor')
          || ' posted the evening update for ' || v_date_str || '.',
        new.id, 'work_plan'
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_work_plan on public.work_plans;
create trigger trg_notify_work_plan
  after insert or update on public.work_plans
  for each row execute function public.notify_work_plan_posted();
