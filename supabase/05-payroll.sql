-- ============================================================
-- Sasec Engineering — Step 5: Payroll
-- Run AFTER 04-work-plans.sql. Safe to re-run.
-- ============================================================

-- 1. Daily rate column on profiles ---------------------------
alter table public.profiles
  add column if not exists daily_rate numeric(10,2) not null default 0;

-- 2. Extend the self-escalation guard ------------------------
-- The existing trigger (from setup.sql) already blocks non-boss
-- users from changing their own `role`. We extend the function to
-- also block them from changing their own `daily_rate`. The
-- BEFORE UPDATE trigger itself was created in setup.sql; replacing
-- the function definition is enough.
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
  if new.daily_rate is distinct from old.daily_rate and not public.is_boss() then
    raise exception 'Only a boss can change a daily rate';
  end if;
  return new;
end;
$$;
