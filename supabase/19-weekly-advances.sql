-- ============================================================
-- Sasec Engineering — Step 19: Weekly Advances (Attendance-based)
--
-- Removes the worker advance-request / approval-chain flow entirely
-- and replaces it with a single per-worker, per-week advance amount
-- that the supervisor enters while marking attendance.
--
-- Payroll reads directly from weekly_advances and deducts the
-- amount(s) whose week_start falls inside the pay period.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Drop the old advance-request flow ─────────────────────
-- (advances referenced advance_requests via request_id; cascade
--  cleans up policies + FKs. No production data depends on these.)
drop table if exists public.advances cascade;
drop table if exists public.advance_requests cascade;

-- ── 2. weekly_advances table ─────────────────────────────────
create table if not exists public.weekly_advances (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.profiles(id) on delete cascade,
  week_start    date not null,                     -- Monday of the pay week
  amount        numeric(10,2) not null default 0 check (amount >= 0),
  supervisor_id uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (worker_id, week_start)
);

create index if not exists weekly_advances_worker_week
  on public.weekly_advances (worker_id, week_start);
create index if not exists weekly_advances_week
  on public.weekly_advances (week_start);

alter table public.weekly_advances enable row level security;

-- updated_at touch (reuses touch_updated_at from step 2)
drop trigger if exists weekly_advances_touch_updated_at on public.weekly_advances;
create trigger weekly_advances_touch_updated_at
  before update on public.weekly_advances
  for each row execute function public.touch_updated_at();

-- ── 3. RLS policies ──────────────────────────────────────────
drop policy if exists "wa_worker_select"     on public.weekly_advances;
drop policy if exists "wa_supervisor_select" on public.weekly_advances;
drop policy if exists "wa_supervisor_insert" on public.weekly_advances;
drop policy if exists "wa_supervisor_update" on public.weekly_advances;
drop policy if exists "wa_boss_all"          on public.weekly_advances;

-- Workers: read their own advances (for My Payroll)
create policy "wa_worker_select" on public.weekly_advances
  for select using (worker_id = auth.uid());

-- Supervisors: read advances for workers assigned to them
create policy "wa_supervisor_select" on public.weekly_advances
  for select using (
    worker_id in (
      select id from public.profiles where supervisor_id = auth.uid()
    )
  );

-- Supervisors: create an advance for a worker on their team
create policy "wa_supervisor_insert" on public.weekly_advances
  for insert with check (
    supervisor_id = auth.uid()
    and worker_id in (
      select id from public.profiles where supervisor_id = auth.uid()
    )
  );

-- Supervisors: edit an advance for a worker on their team
create policy "wa_supervisor_update" on public.weekly_advances
  for update using (
    worker_id in (
      select id from public.profiles where supervisor_id = auth.uid()
    )
  ) with check (
    worker_id in (
      select id from public.profiles where supervisor_id = auth.uid()
    )
  );

-- Boss: full access (payroll totals, oversight)
create policy "wa_boss_all" on public.weekly_advances
  for all using (public.is_boss());
