-- ============================================================
-- Sasec Engineering — Step 6: Designations
-- Run AFTER 05-payroll.sql. Safe to re-run.
--
-- NOTE: this migration is the new canonical state for the
-- profiles table. It DROPS profiles.daily_rate. If you re-run
-- 05-payroll.sql after this, it will re-add the column — that's
-- harmless (the column will be unused) but ideally just leave 05
-- alone and let 06 be the latest state.
-- ============================================================

-- 1. designations table --------------------------------------
create table if not exists public.designations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  daily_wage  numeric(10,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (daily_wage >= 0)
);

alter table public.designations enable row level security;

-- updated_at touch (reuses touch_updated_at from step 2)
drop trigger if exists designations_touch_updated_at on public.designations;
create trigger designations_touch_updated_at
  before update on public.designations
  for each row execute function public.touch_updated_at();

-- 2. RLS -----------------------------------------------------
-- Any signed-in user can READ designations (workers need to see
-- their own designation's wage on /worker/payroll).
-- Only bosses can INSERT/UPDATE/DELETE.
drop policy if exists "designations_select_all" on public.designations;
drop policy if exists "designations_boss_ins"   on public.designations;
drop policy if exists "designations_boss_upd"   on public.designations;
drop policy if exists "designations_boss_del"   on public.designations;

create policy "designations_select_all"
  on public.designations
  for select
  using (auth.uid() is not null);

create policy "designations_boss_ins"
  on public.designations
  for insert
  with check (public.is_boss());

create policy "designations_boss_upd"
  on public.designations
  for update
  using (public.is_boss())
  with check (public.is_boss());

create policy "designations_boss_del"
  on public.designations
  for delete
  using (public.is_boss());

-- 3. Add designation_id to profiles --------------------------
-- ON DELETE RESTRICT enforces the user's choice: a designation
-- with workers assigned cannot be deleted.
alter table public.profiles
  add column if not exists designation_id uuid
    references public.designations(id) on delete restrict;

create index if not exists profiles_designation_id_idx
  on public.profiles(designation_id);

-- 4. Replace the self-escalation guard -----------------------
-- daily_rate is being removed (step 4 below); the new lock is
-- on designation_id so workers can't reassign themselves to a
-- higher-paying designation.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_boss() then
    raise exception 'Only a boss can change a user role';
  end if;
  if new.designation_id is distinct from old.designation_id and not public.is_boss() then
    raise exception 'Only a boss can change a designation';
  end if;
  return new;
end;
$$;

-- 5. Drop the now-unused profiles.daily_rate column ----------
-- Designation is the only source of truth for wages going forward.
alter table public.profiles drop column if exists daily_rate;
