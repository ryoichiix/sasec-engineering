-- ============================================================
-- Sasec Engineering — Step 14: In-app Notifications +
-- Simplified Approval Flow (Worker → Boss directly)
-- Safe to re-run.
-- ============================================================

-- ── 1. Notifications table ───────────────────────────────────
-- Drop and recreate so we start with the correct column names.
-- (Safe: the table had no production data yet.)
drop table if exists public.notifications cascade;

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  type           text not null default 'info',
  title          text not null,
  message        text,
  is_read        boolean not null default false,
  reference_id   uuid,
  reference_type text,
  created_at     timestamptz not null default now()
);

create index notifications_user_unread
  on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

-- Each user can see and mark their own notifications
drop policy if exists "notif_own_select" on public.notifications;
create policy "notif_own_select" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notif_own_update" on public.notifications;
create policy "notif_own_update" on public.notifications
  for update using (user_id = auth.uid());

-- Any authenticated user can INSERT a notification for any user
-- (needed for workers to notify supervisors/boss and vice versa)
drop policy if exists "notif_authenticated_insert" on public.notifications;
create policy "notif_authenticated_insert" on public.notifications
  for insert with check (auth.uid() is not null);

-- ── 2. RPCs to create notifications ─────────────────────────

-- Notify a single user (called by boss when deciding)
create or replace function public.notify_user(
  p_user_id        uuid,
  p_title          text,
  p_message        text      default null,
  p_type           text      default 'info',
  p_reference_id   uuid      default null,
  p_reference_type text      default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
  values (p_user_id, p_type, p_title, p_message, p_reference_id, p_reference_type);
end;
$$;

-- Notify ALL supervisors and boss (called by worker on submit)
create or replace function public.notify_supervisors_and_boss(
  p_title          text,
  p_message        text      default null,
  p_type           text      default 'info',
  p_reference_id   uuid      default null,
  p_reference_type text      default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  for v_uid in (
    select id from public.profiles where role in ('supervisor', 'boss')
  ) loop
    insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
    values (v_uid, p_type, p_title, p_message, p_reference_id, p_reference_type);
  end loop;
end;
$$;

-- ── 3. Leave workflow: skip supervisor, go straight to boss ──

-- 3a. Replace the INSERT trigger function so new requests start
--     as 'pending_boss' rather than 'pending_supervisor'.
--     Supervisor assignment is still stored for reference but is
--     no longer required.
create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor uuid;
begin
  new.worker_id := auth.uid();

  -- Record the worker's supervisor for reference (nullable now)
  select supervisor_id into v_supervisor
    from public.profiles where id = new.worker_id;

  new.supervisor_id         := v_supervisor;   -- may be null — that is fine
  new.status                := 'pending_boss'; -- goes directly to boss
  -- Clear any client-supplied decision fields
  new.supervisor_decision   := null;
  new.supervisor_note       := null;
  new.supervisor_decided_at := null;
  new.boss_id               := null;
  new.boss_decision         := null;
  new.boss_note             := null;
  new.boss_decided_at       := null;

  return new;
end;
$$;

-- Recreate the trigger (DROP first for idempotency)
drop trigger if exists leave_requests_before_insert on public.leave_requests;
create trigger leave_requests_before_insert
  before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();

-- 3b. Migrate any stuck 'pending_supervisor' requests to 'pending_boss'
update public.leave_requests
  set status = 'pending_boss'
  where status = 'pending_supervisor';

-- 3c. Update leave SELECT RLS: supervisors can read ALL requests (not just theirs)
drop policy if exists "leave_select" on public.leave_requests;
create policy "leave_select"
  on public.leave_requests
  for select
  using (
    auth.uid() = worker_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('supervisor', 'boss')
    )
  );

-- ── 4. Advance workflow: boss approves directly ──────────────

-- 4a. Widen the status check to include 'approved' (clean alias for boss_approved)
alter table public.advance_requests
  drop constraint if exists advance_requests_status_check;

alter table public.advance_requests
  add constraint advance_requests_status_check
    check (status in ('pending','supervisor_approved','boss_approved','approved','rejected'));

-- 4b. Migrate any stuck 'supervisor_approved' requests to 'pending'
--     so they appear in the boss's queue (they can re-decide)
update public.advance_requests
  set status = 'pending'
  where status = 'supervisor_approved';

-- 4c. Update advance_requests SELECT RLS: all supervisors see all requests
drop policy if exists "ar_supervisor_select" on public.advance_requests;
create policy "ar_supervisor_select" on public.advance_requests
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'supervisor'
    )
  );

-- Supervisors NO LONGER need UPDATE on advance_requests
drop policy if exists "ar_supervisor_update" on public.advance_requests;
