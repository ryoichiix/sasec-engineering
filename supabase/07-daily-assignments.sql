-- ============================================================
-- Sasec Engineering — Step 7: Daily supervisor↔worker assignments
-- Run AFTER 06-designations.sql. Safe to re-run.
--
-- Overlay on top of permanent `profiles.supervisor_id`:
--   - permanent assignment still owns attendance + leave routing
--   - daily_assignments is who the worker actually worked under
--     on a given day (for work-plan visibility, headcount, etc.)
-- ============================================================

create table if not exists public.daily_assignments (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references public.profiles(id) on delete cascade,
  supervisor_id   uuid not null references public.profiles(id) on delete cascade,
  assignment_date date not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (worker_id, assignment_date)
);

create index if not exists daily_assignments_date_idx
  on public.daily_assignments (assignment_date);
create index if not exists daily_assignments_supervisor_date_idx
  on public.daily_assignments (supervisor_id, assignment_date);

alter table public.daily_assignments enable row level security;

-- updated_at touch (reuses touch_updated_at from step 2)
drop trigger if exists daily_assignments_touch_updated_at on public.daily_assignments;
create trigger daily_assignments_touch_updated_at
  before update on public.daily_assignments
  for each row execute function public.touch_updated_at();

-- RLS --------------------------------------------------------
-- Any signed-in user can read. Construction-site context: everyone
-- knows who's on whose crew. This is also what powers the "already
-- on Aisha's team" badge for other supervisors.
drop policy if exists "daily_assignments_select_all" on public.daily_assignments;
drop policy if exists "daily_assignments_supervisor_ins" on public.daily_assignments;
drop policy if exists "daily_assignments_supervisor_upd" on public.daily_assignments;
drop policy if exists "daily_assignments_del"           on public.daily_assignments;

create policy "daily_assignments_select_all"
  on public.daily_assignments
  for select
  using (auth.uid() is not null);

-- INSERT: caller must be picking themselves as supervisor
create policy "daily_assignments_supervisor_ins"
  on public.daily_assignments
  for insert
  with check (supervisor_id = auth.uid());

-- UPDATE: anyone (USING true) can "steal" — but the new owner must
-- be the caller. This is how the override flow works.
create policy "daily_assignments_supervisor_upd"
  on public.daily_assignments
  for update
  using (true)
  with check (supervisor_id = auth.uid());

-- DELETE: only the current owning supervisor, or a boss
create policy "daily_assignments_del"
  on public.daily_assignments
  for delete
  using (supervisor_id = auth.uid() or public.is_boss());
