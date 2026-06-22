-- ============================================================
-- Sasec Engineering — Step 27: Open attendance marking
--
-- Any supervisor can mark attendance for any worker on any day.
-- The supervisor_id column is kept as the audit trail (who marked whom).
-- The is_my_worker() restriction is removed from INSERT/UPDATE policies.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Drop the old restricted policies ──────────────────────
drop policy if exists "attendance_supervisor_ins" on public.attendance;
drop policy if exists "attendance_supervisor_upd" on public.attendance;

-- ── 2. Any supervisor can INSERT an attendance row ───────────
-- They must identify themselves as the supervisor on the row
-- (audit trail) and they must actually be a supervisor.
create policy "attendance_supervisor_ins"
  on public.attendance
  for insert
  with check (
    supervisor_id = auth.uid()
    and public.is_supervisor()
  );

-- ── 3. Any supervisor can UPDATE any attendance row ──────────
-- They must set supervisor_id to themselves (updates the audit trail
-- to the last supervisor who touched the row).
create policy "attendance_supervisor_upd"
  on public.attendance
  for update
  using (public.is_supervisor())
  with check (
    supervisor_id = auth.uid()
    and public.is_supervisor()
  );
