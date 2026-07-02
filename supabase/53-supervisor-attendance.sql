-- ============================================================
-- Sasec Engineering — Step 53: Supervisor attendance
--
-- Site Incharge (profiles.field_manager = true) marks daily
-- attendance for OTHER supervisors: Present / Absent / Leave / OD.
--
-- Stored in a dedicated table so the worker `attendance` table
-- (FK'd to public.workers) stays untouched.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Enum ─────────────────────────────────────────────────
do $$ begin
  create type public.supervisor_attendance_status as enum
    ('present', 'absent', 'leave', 'on_duty');
exception when duplicate_object then null;
end $$;

-- ── 2. Table ────────────────────────────────────────────────
create table if not exists public.supervisor_attendance (
  id              uuid primary key default gen_random_uuid(),
  supervisor_id   uuid not null references public.profiles(id) on delete cascade,   -- subject (the supervisor being marked)
  marked_by       uuid not null references public.profiles(id) on delete set null,  -- Site Incharge who did the marking
  attendance_date date not null,
  status          public.supervisor_attendance_status not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (supervisor_id, attendance_date)
);

create index if not exists sup_att_date_idx
  on public.supervisor_attendance (attendance_date desc);
create index if not exists sup_att_supervisor_date_idx
  on public.supervisor_attendance (supervisor_id, attendance_date desc);
create index if not exists sup_att_marked_by_idx
  on public.supervisor_attendance (marked_by);

-- Keep updated_at fresh (reuses touch_updated_at from step 2)
drop trigger if exists sup_att_touch_updated_at on public.supervisor_attendance;
create trigger sup_att_touch_updated_at
  before update on public.supervisor_attendance
  for each row execute function public.touch_updated_at();

-- ── 3. RLS ──────────────────────────────────────────────────
alter table public.supervisor_attendance enable row level security;

drop policy if exists "sup_att_select"     on public.supervisor_attendance;
drop policy if exists "sup_att_fm_insert"  on public.supervisor_attendance;
drop policy if exists "sup_att_fm_update"  on public.supervisor_attendance;

-- Read: subject supervisor sees their own; every Site Incharge and every Boss sees all.
create policy "sup_att_select"
  on public.supervisor_attendance
  for select
  using (
    supervisor_id = auth.uid()
    or public.is_field_manager()
    or public.is_boss()
  );

-- Insert: only Site Incharge, and they must attribute themselves as marked_by.
create policy "sup_att_fm_insert"
  on public.supervisor_attendance
  for insert
  with check (
    marked_by = auth.uid()
    and public.is_field_manager()
  );

-- Update: only Site Incharge.
create policy "sup_att_fm_update"
  on public.supervisor_attendance
  for update
  using (public.is_field_manager())
  with check (
    marked_by = auth.uid()
    and public.is_field_manager()
  );
