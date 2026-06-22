-- ============================================================
-- Sasec Engineering — Supabase schema
-- Safe to re-run: every object is created with IF NOT EXISTS
-- or CREATE OR REPLACE, and policies/triggers are dropped first.
-- ============================================================

-- 1. Role enum -----------------------------------------------
do $$ begin
  create type public.user_role as enum ('boss', 'supervisor', 'worker');
exception when duplicate_object then null;
end $$;

-- 2. profiles table ------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text,
  role        public.user_role not null default 'worker',
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 3. Helper: am I a boss? ------------------------------------
-- IMPORTANT: security definer + stable so it runs as the function
-- owner (bypassing the caller's RLS). Without this, a policy that
-- queries `profiles` to decide access to `profiles` infinite-loops.
create or replace function public.is_boss()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'boss'
  );
$$;

-- 4. Policies ------------------------------------------------
-- Drop the old (recursive) policies if they exist from a previous run.
drop policy if exists "profiles_self_select"      on public.profiles;
drop policy if exists "profiles_self_update"      on public.profiles;
drop policy if exists "profiles_boss_select_all"  on public.profiles;
drop policy if exists "profiles_boss_update_all"  on public.profiles;
drop policy if exists "profiles_select"           on public.profiles;
drop policy if exists "profiles_update"           on public.profiles;

-- Read: own row, or any row if you're a boss
create policy "profiles_select"
  on public.profiles
  for select
  using (auth.uid() = id or public.is_boss());

-- Update: own row, or any row if you're a boss
create policy "profiles_update"
  on public.profiles
  for update
  using (auth.uid() = id or public.is_boss())
  with check (auth.uid() = id or public.is_boss());

-- 5. Prevent non-boss users from changing their own role -----
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
  return new;
end;
$$;

drop trigger if exists profiles_block_role_self_escalation on public.profiles;
create trigger profiles_block_role_self_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_role_self_escalation();

-- 6. Auto-create a profile row on signup ---------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role public.user_role;
begin
  begin
    meta_role := coalesce(
      (new.raw_user_meta_data ->> 'role')::public.user_role,
      'worker'
    );
  exception when others then
    meta_role := 'worker';
  end;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    meta_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7. Backfill profiles for any auth.users created before the trigger
insert into public.profiles (id, full_name, role)
select
  u.id,
  u.raw_user_meta_data ->> 'full_name',
  coalesce(
    nullif(u.raw_user_meta_data ->> 'role', '')::public.user_role,
    'worker'
  )
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
