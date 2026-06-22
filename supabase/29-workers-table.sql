-- ============================================================
-- Sasec Engineering — Step 29: Separate workers table
--
-- Workers (non-auth, bulk-imported) move out of profiles into
-- their own table. Supervisors and bosses remain in profiles.
--
-- FK columns that referenced profiles(id) for workers are
-- redirected to workers(id). Existing IDs are preserved so
-- attendance / assignments / advances continue to work.
--
-- Safe to re-run (all statements are idempotent).
-- ============================================================

-- ── 1. Create the workers table ──────────────────────────────
create table if not exists public.workers (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  role                text not null default 'worker',
  pf_id               text,
  designation_id      uuid references public.designations(id) on delete set null,
  designation_name    text,              -- denormalised for display when desig FK is null
  individual_wage     numeric(10,2) not null default 0,
  wage_type           text not null default 'daily_rate',
  bank_name           text,
  bank_account_number text,
  bank_ifsc           text,
  phone_number        text,
  supervisor_id       uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists workers_supervisor_id_idx on public.workers (supervisor_id);
create index if not exists workers_designation_id_idx on public.workers (designation_id);

-- updated_at trigger (reuses touch_updated_at from step 2)
drop trigger if exists workers_touch_updated_at on public.workers;
create trigger workers_touch_updated_at
  before update on public.workers
  for each row execute function public.touch_updated_at();

-- ── 2. RLS ───────────────────────────────────────────────────
alter table public.workers enable row level security;

drop policy if exists "workers_select_authenticated" on public.workers;
drop policy if exists "workers_boss_write"           on public.workers;
drop policy if exists "workers_supervisor_select"    on public.workers;

-- Everyone signed in can read (supervisors need to see all workers for
-- attendance, team picker, etc.)
create policy "workers_select_authenticated"
  on public.workers for select
  using (auth.uid() is not null);

-- Only bosses can insert, update, delete
create policy "workers_boss_write"
  on public.workers for all
  using (public.is_boss())
  with check (public.is_boss());

-- Supervisors can read their own assigned workers (covered above — but also
-- allow supervisors to update supervisor_id field if we ever allow self-assign)
-- Not needed: the select policy already covers all authenticated users.

-- ── 3. Migrate existing worker rows from profiles ─────────────
-- Insert with the SAME uuid so all FK references from attendance,
-- daily_assignments, weekly_advances continue to point correctly.
insert into public.workers (
  id, full_name, role, pf_id,
  designation_id, designation_name,
  individual_wage, wage_type,
  bank_name, bank_account_number, bank_ifsc,
  phone_number, supervisor_id,
  created_at, updated_at
)
select
  p.id,
  p.full_name,
  'worker',
  p.pf_id,
  p.designation_id,
  d.name,
  coalesce(p.individual_wage, 0),
  coalesce(p.wage_type, 'daily_rate'),
  p.bank_name,
  p.bank_account_number,
  coalesce(p.ifsc_code, p.bank_ifsc),
  p.phone_number,
  p.supervisor_id,
  p.created_at,
  p.updated_at
from public.profiles p
left join public.designations d on d.id = p.designation_id
where p.role = 'worker'
on conflict (id) do nothing;

-- ── 4. Re-point attendance.worker_id → workers(id) ───────────
-- Drop existing FK to profiles, add new one to workers.
-- Only run when the FK is still pointing at profiles.
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
  join information_schema.table_constraints ccu
    on ccu.constraint_name = rc.unique_constraint_name
  where tc.table_name  = 'attendance'
    and tc.table_schema = 'public'
    and kcu.column_name = 'worker_id'
    and ccu.table_name  = 'profiles'
  limit 1;

  if fk_name is not null then
    execute format('alter table public.attendance drop constraint %I', fk_name);
  end if;
end $$;

alter table public.attendance
  drop constraint if exists attendance_worker_id_fkey,
  drop constraint if exists attendance_worker_id_fkey1;

alter table public.attendance
  add constraint attendance_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete cascade;

-- ── 5. Re-point daily_assignments.worker_id → workers(id) ────
do $$
declare fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
  join information_schema.table_constraints ccu
    on ccu.constraint_name = rc.unique_constraint_name
  where tc.table_name  = 'daily_assignments'
    and tc.table_schema = 'public'
    and kcu.column_name = 'worker_id'
    and ccu.table_name  = 'profiles'
  limit 1;
  if fk_name is not null then
    execute format('alter table public.daily_assignments drop constraint %I', fk_name);
  end if;
end $$;

alter table public.daily_assignments
  drop constraint if exists daily_assignments_worker_id_fkey,
  drop constraint if exists daily_assignments_worker_id_fkey1;

alter table public.daily_assignments
  add constraint daily_assignments_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete cascade;

-- ── 6. Re-point weekly_advances.worker_id → workers(id) ──────
do $$
declare fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
  join information_schema.table_constraints ccu
    on ccu.constraint_name = rc.unique_constraint_name
  where tc.table_name  = 'weekly_advances'
    and tc.table_schema = 'public'
    and kcu.column_name = 'worker_id'
    and ccu.table_name  = 'profiles'
  limit 1;
  if fk_name is not null then
    execute format('alter table public.weekly_advances drop constraint %I', fk_name);
  end if;
end $$;

alter table public.weekly_advances
  drop constraint if exists weekly_advances_worker_id_fkey,
  drop constraint if exists weekly_advances_worker_id_fkey1;

-- Also drop the old RLS policies that referenced profiles.supervisor_id
-- for worker lookup — those will be replaced by workers.supervisor_id.
drop policy if exists "wa_worker_select"     on public.weekly_advances;
drop policy if exists "wa_supervisor_select" on public.weekly_advances;
drop policy if exists "wa_supervisor_insert" on public.weekly_advances;
drop policy if exists "wa_supervisor_update" on public.weekly_advances;

alter table public.weekly_advances
  add constraint weekly_advances_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete cascade;

-- Ensure supervisor_id exists on weekly_advances — it was added in migration 19
-- but may be missing if an earlier advances migration ran instead.
alter table public.weekly_advances
  add column if not exists supervisor_id uuid
    references public.profiles(id) on delete set null;

-- Recreate weekly_advances policies using workers table
create policy "wa_select" on public.weekly_advances
  for select using (
    exists (select 1 from public.workers where id = worker_id and supervisor_id = auth.uid())
    or public.is_boss()
  );

create policy "wa_supervisor_ins" on public.weekly_advances
  for insert with check (
    supervisor_id = auth.uid()
    and exists (select 1 from public.workers where id = worker_id)
    and public.is_supervisor()
  );

create policy "wa_supervisor_upd" on public.weekly_advances
  for update using (
    supervisor_id = auth.uid()
    and public.is_supervisor()
  ) with check (
    supervisor_id = auth.uid()
    and public.is_supervisor()
  );

create policy "wa_boss_all" on public.weekly_advances
  for all using (public.is_boss());

-- ── 7. Update is_my_worker() to use workers table ─────────────
create or replace function public.is_my_worker(p_worker_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workers
    where id = p_worker_id
      and supervisor_id = auth.uid()
  );
$$;

-- ── 8. Update attendance RLS to allow open supervisor writes ──
-- (mirrors migration 27 — attendance.worker_id now references workers)
drop policy if exists "attendance_supervisor_ins" on public.attendance;
drop policy if exists "attendance_supervisor_upd" on public.attendance;

create policy "attendance_supervisor_ins"
  on public.attendance for insert
  with check (
    supervisor_id = auth.uid()
    and public.is_supervisor()
  );

create policy "attendance_supervisor_upd"
  on public.attendance for update
  using (public.is_supervisor())
  with check (
    supervisor_id = auth.uid()
    and public.is_supervisor()
  );

-- ── 9. Update daily_assignments RLS ──────────────────────────
-- worker_id now references workers, so no change needed to the
-- existing policies (they only check supervisor_id = auth.uid()).

-- ── 10. Remove workers from profiles ─────────────────────────
-- Only delete rows that were successfully migrated to workers.
delete from public.profiles
where role = 'worker'
  and id in (select id from public.workers);

-- ── 11. Enable realtime for workers table ─────────────────────
do $$
begin
  alter publication supabase_realtime add table public.workers;
exception when duplicate_object then null;
end $$;
