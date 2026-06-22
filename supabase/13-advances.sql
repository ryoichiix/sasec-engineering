-- ============================================================
-- Sasec Engineering — Step 13: Advance Management
-- Run AFTER 12-worker-individual-wage.sql. Safe to re-run.
-- ============================================================

-- 1. advance_requests ----------------------------------------
create table if not exists public.advance_requests (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references public.profiles(id) on delete cascade,
  amount          numeric(10,2) not null check (amount > 0),
  reason          text not null,
  requested_date  date not null default current_date,
  status          text not null default 'pending'
    check (status in ('pending','supervisor_approved','boss_approved','rejected')),
  -- supervisor action
  supervisor_id   uuid references public.profiles(id),
  supervisor_at   timestamptz,
  supervisor_note text,
  -- boss action
  boss_id         uuid references public.profiles(id),
  boss_at         timestamptz,
  boss_note       text,
  created_at      timestamptz not null default now()
);

-- 2. advances (approved records) ----------------------------
create table if not exists public.advances (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.profiles(id) on delete cascade,
  amount        numeric(10,2) not null check (amount > 0),
  advance_date  date not null default current_date,
  source        text not null default 'direct'
    check (source in ('request','direct')),
  request_id    uuid references public.advance_requests(id),
  added_by      uuid not null references public.profiles(id),
  notes         text,
  recovered     boolean not null default false,
  recovered_at  timestamptz,
  recovered_by  uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- 3. Indexes -------------------------------------------------
create index if not exists advances_worker_date
  on public.advances(worker_id, advance_date);

create index if not exists advance_requests_worker_status
  on public.advance_requests(worker_id, status);

-- 4. RLS: advance_requests -----------------------------------
alter table public.advance_requests enable row level security;

-- Workers: view and create their own requests
create policy "ar_worker_select" on public.advance_requests
  for select using (worker_id = auth.uid());

create policy "ar_worker_insert" on public.advance_requests
  for insert with check (worker_id = auth.uid());

-- Supervisors: view requests from their assigned team
create policy "ar_supervisor_select" on public.advance_requests
  for select using (
    worker_id in (
      select id from public.profiles
      where supervisor_id = auth.uid()
    )
  );

-- Supervisors: approve/reject (status update) for their team
create policy "ar_supervisor_update" on public.advance_requests
  for update using (
    worker_id in (
      select id from public.profiles
      where supervisor_id = auth.uid()
    )
  );

-- Boss: full access
create policy "ar_boss_all" on public.advance_requests
  for all using (public.is_boss());

-- 5. RLS: advances -------------------------------------------
alter table public.advances enable row level security;

-- Workers: view their own approved advances
create policy "adv_worker_select" on public.advances
  for select using (worker_id = auth.uid());

-- Boss: full access (add direct, approve from request, mark recovered)
create policy "adv_boss_all" on public.advances
  for all using (public.is_boss());
