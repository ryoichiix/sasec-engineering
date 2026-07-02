-- ============================================================
-- Sasec Engineering — Step 54: Track marked_by on attendance
--
-- Adds a dedicated `marked_by` column so `supervisor_id` on the
-- attendance row can carry its intended meaning (the worker's
-- assigned team supervisor) while `marked_by` records the actual
-- supervisor who did the marking (audit trail).
--
-- Historically `supervisor_id` was populated with `auth.uid()`
-- (the marker), so we backfill marked_by = supervisor_id for
-- existing rows to preserve the audit history.
--
-- RLS is updated to enforce `marked_by = auth.uid()` instead of
-- `supervisor_id = auth.uid()`. This keeps the attendance OT flow
-- untouched (OT approval only reads supervisor_id / display names).
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Column ───────────────────────────────────────────────
alter table public.attendance
  add column if not exists marked_by uuid
    references public.profiles(id) on delete set null;

-- ── 2. Backfill: historical supervisor_id WAS the marker ────
update public.attendance
   set marked_by = supervisor_id
 where marked_by is null;

create index if not exists attendance_marked_by_idx
  on public.attendance (marked_by);

-- ── 3. Replace RLS to check marked_by = auth.uid() ──────────
drop policy if exists "attendance_supervisor_ins" on public.attendance;
drop policy if exists "attendance_supervisor_upd" on public.attendance;

create policy "attendance_supervisor_ins"
  on public.attendance
  for insert
  with check (
    marked_by = auth.uid()
    and public.is_supervisor()
  );

create policy "attendance_supervisor_upd"
  on public.attendance
  for update
  using (public.is_supervisor())
  with check (
    marked_by = auth.uid()
    and public.is_supervisor()
  );
