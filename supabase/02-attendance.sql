-- ============================================================
-- Sasec Engineering — Step 2: Attendance module
-- Run AFTER setup.sql. Safe to re-run.
-- ============================================================

-- 1. profiles.supervisor_id ----------------------------------
alter table public.profiles
  add column if not exists supervisor_id uuid
    references public.profiles(id) on delete set null;

create index if not exists profiles_supervisor_id_idx
  on public.profiles(supervisor_id);

-- 2. Helper: is the given worker assigned to me? -------------
-- security definer so it bypasses caller RLS (no recursion).
create or replace function public.is_my_worker(p_worker_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_worker_id
      and supervisor_id = auth.uid()
  );
$$;

-- 3. Supervisor can read their assigned workers --------------
drop policy if exists "profiles_supervisor_select" on public.profiles;
create policy "profiles_supervisor_select"
  on public.profiles
  for select
  using (supervisor_id = auth.uid());

-- 4. attendance ----------------------------------------------
do $$ begin
  create type public.attendance_status as enum ('present', 'absent', 'half_day');
exception when duplicate_object then null;
end $$;

create table if not exists public.attendance (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references public.profiles(id) on delete cascade,
  supervisor_id   uuid not null references public.profiles(id) on delete set null,
  attendance_date date not null,
  status          public.attendance_status not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (worker_id, attendance_date)
);

create index if not exists attendance_date_idx
  on public.attendance (attendance_date desc);
create index if not exists attendance_supervisor_date_idx
  on public.attendance (supervisor_id, attendance_date desc);
create index if not exists attendance_worker_date_idx
  on public.attendance (worker_id, attendance_date desc);

alter table public.attendance enable row level security;

-- Keep updated_at fresh on updates
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists attendance_touch_updated_at on public.attendance;
create trigger attendance_touch_updated_at
  before update on public.attendance
  for each row execute function public.touch_updated_at();

-- attendance policies
drop policy if exists "attendance_select"           on public.attendance;
drop policy if exists "attendance_supervisor_ins"   on public.attendance;
drop policy if exists "attendance_supervisor_upd"   on public.attendance;

create policy "attendance_select"
  on public.attendance
  for select
  using (
    auth.uid() = worker_id
    or public.is_my_worker(worker_id)
    or public.is_boss()
  );

create policy "attendance_supervisor_ins"
  on public.attendance
  for insert
  with check (
    supervisor_id = auth.uid()
    and public.is_my_worker(worker_id)
  );

create policy "attendance_supervisor_upd"
  on public.attendance
  for update
  using (
    supervisor_id = auth.uid()
    and public.is_my_worker(worker_id)
  )
  with check (
    supervisor_id = auth.uid()
    and public.is_my_worker(worker_id)
  );

-- 5. notifications -------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  body       text not null,
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select" on public.notifications;
drop policy if exists "notifications_update" on public.notifications;

create policy "notifications_select"
  on public.notifications
  for select
  using (user_id = auth.uid());

create policy "notifications_update"
  on public.notifications
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No INSERT policy: rows are created by the security-definer trigger only.

