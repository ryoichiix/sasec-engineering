-- ============================================================
-- Sasec Engineering — Step 12: Worker individual wage
-- Run AFTER 11-designations-update.sql. Safe to re-run.
-- ============================================================

-- 1. Add individual_wage column to profiles --------------------
alter table public.profiles
  add column if not exists individual_wage numeric(10,2) not null default 0;

-- 2. Add wage_type column to profiles -------------------------
alter table public.profiles
  add column if not exists wage_type text not null default 'daily_rate';

-- Add the check constraint only if it doesn't already exist
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name    = 'profiles_wage_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_wage_type_check
        check (wage_type in ('daily_rate', 'monthly_fixed'));
  end if;
end;
$$;

-- 3. Backfill: for workers already assigned a designation, copy
--    that designation's daily_wage + wage_type into their profile ----
update public.profiles p
set
  individual_wage = coalesce(d.daily_wage, 0),
  wage_type       = coalesce(d.wage_type, 'daily_rate')
from public.designations d
where p.designation_id = d.id
  and p.role = 'worker'
  and p.individual_wage = 0;  -- only touch rows not yet set

-- 4. Fix the trigger function: remove the daily_rate reference
--    that causes "record new has no field daily_rate" when that
--    column is absent from the profiles table. -----------------
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
  if new.individual_wage is distinct from old.individual_wage and not public.is_boss() then
    raise exception 'Only a boss can change individual wage';
  end if;
  if new.wage_type is distinct from old.wage_type and not public.is_boss() then
    raise exception 'Only a boss can change wage type';
  end if;
  return new;
end;
$$;
