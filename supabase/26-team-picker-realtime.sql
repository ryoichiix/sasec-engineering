-- ============================================================
-- Sasec Engineering — Step 26: Open team picker + realtime
--
-- Fixes the daily team picker so a supervisor sees EVERY worker
-- marked present today (not just their permanent batch), and adds
-- realtime broadcasts so picks update instantly across screens.
--
-- Changes:
--   1. is_supervisor() helper (mirrors is_boss(), avoids RLS recursion)
--   2. New SELECT policy on attendance for supervisors → can see
--      attendance for any worker (read-only)
--   3. New SELECT policy on profiles for supervisors → can see all
--      worker profiles + other supervisor profiles (name + basics)
--   4. Realtime: add daily_assignments + attendance to the
--      supabase_realtime publication so postgres_changes events fire
--
-- Safe to re-run.
-- ============================================================

-- ── 1. is_supervisor() helper ────────────────────────────────
create or replace function public.is_supervisor()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'supervisor'
  );
$$;

-- ── 2. Supervisor can read all attendance ────────────────────
drop policy if exists "attendance_supervisor_select_all" on public.attendance;
create policy "attendance_supervisor_select_all"
  on public.attendance
  for select
  using (public.is_supervisor());

-- ── 3. Supervisor can read worker + supervisor profiles ──────
drop policy if exists "profiles_supervisor_read_team" on public.profiles;
create policy "profiles_supervisor_read_team"
  on public.profiles
  for select
  using (
    role in ('worker', 'supervisor')
    and public.is_supervisor()
  );

-- ── 4. Enable realtime broadcasts ────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.daily_assignments;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object then null;
end $$;
