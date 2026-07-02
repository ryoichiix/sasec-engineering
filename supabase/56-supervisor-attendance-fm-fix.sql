-- ============================================================
-- Sasec Engineering — Step 56: Fix supervisor_attendance RLS
--
-- BUG: migration 53 gated writes on public.is_field_manager(),
-- which checks the LEGACY `is_field_manager` column. The live
-- Site Incharge flag used by the app (and migrations 44/50/51)
-- is `profiles.field_manager`. The two columns are never synced,
-- so a real Site Incharge (field_manager = true, is_field_manager
-- = false) was DENIED every insert/update into supervisor_attendance
-- — which in turn silently skipped the Director "supervisor absent"
-- notification and left the "On leave today" widget empty.
--
-- FIX: rewrite the three policies to read profiles.field_manager
-- inline, matching the canonical pattern in migrations 44/50/51.
-- Leave/OT RLS (which still uses is_field_manager()) is NOT touched.
--
-- Safe to re-run.
-- ============================================================

-- Helper mirrors the app's live flag. SECURITY DEFINER + stable so
-- it can be used inside policies without recursive RLS on profiles.
create or replace function public.is_site_incharge()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'supervisor'
      and field_manager = true
  );
$$;

-- Re-create the three supervisor_attendance policies using the live flag.
drop policy if exists "sup_att_select"    on public.supervisor_attendance;
drop policy if exists "sup_att_fm_insert" on public.supervisor_attendance;
drop policy if exists "sup_att_fm_update" on public.supervisor_attendance;

-- Read: subject supervisor sees their own; every Site Incharge and every Boss sees all.
create policy "sup_att_select"
  on public.supervisor_attendance
  for select
  using (
    supervisor_id = auth.uid()
    or public.is_site_incharge()
    or public.is_boss()
  );

-- Insert: only a Site Incharge, attributing themselves as marked_by.
create policy "sup_att_fm_insert"
  on public.supervisor_attendance
  for insert
  with check (
    marked_by = auth.uid()
    and public.is_site_incharge()
  );

-- Update: only a Site Incharge.
create policy "sup_att_fm_update"
  on public.supervisor_attendance
  for update
  using (public.is_site_incharge())
  with check (
    marked_by = auth.uid()
    and public.is_site_incharge()
  );
