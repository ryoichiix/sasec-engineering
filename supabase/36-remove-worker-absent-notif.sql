-- ============================================================
-- Step 36: Remove worker-absent notification
--
-- Workers live in the `workers` table, not `profiles`, and have
-- no auth accounts — they can never read in-app notifications.
-- The trg_notify_absent trigger inserted notifications with
-- user_id = worker_id (a non-existent/invalid recipient). Drop it.
--
-- Safe to re-run.
-- ============================================================

drop trigger if exists trg_notify_absent on public.attendance;
drop function if exists public.notify_absent_worker();
