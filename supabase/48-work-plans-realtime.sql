-- ============================================================
-- Sasec Engineering — Step 48: Enable realtime for work_plans
--
-- Fix A needs two-way LIVE sync of a shared work plan: the Today's
-- Plan form and the merged Work Feed cards subscribe to
-- postgres_changes on public.work_plans. Those events only fire when
-- the table belongs to the supabase_realtime publication.
--
-- This is a publication/replication change ONLY — it does not alter
-- the work_plans table schema (no columns or constraints touched).
-- Without it, edits still save to the shared canonical row, but the
-- other side only sees them on reload (no live update).
--
-- Idempotent: the duplicate_object guard makes re-running a no-op.
-- ============================================================

-- ── Enable realtime broadcasts for work_plans ────────────────
do $$
begin
  alter publication supabase_realtime add table public.work_plans;
exception when duplicate_object then null;
end $$;
