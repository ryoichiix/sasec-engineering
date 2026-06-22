-- ============================================================
-- Step 38: Project info + per-worker task on daily_assignments
--
-- When a supervisor picks their team, they now specify:
--   • project_name      (e.g. "Slab pouring - Block C")
--   • project_location  (e.g. "JSW Plant - Sector 4")
-- These apply to the supervisor's whole team for the day. The
-- supervisor can also tag each worker with an individual
-- task_assigned (e.g. "Welding work", "Material handling").
--
-- Safe to re-run.
-- ============================================================

alter table public.daily_assignments
  add column if not exists project_name      text,
  add column if not exists project_location  text,
  add column if not exists task_assigned     text;

-- Indexed lookups by supervisor/date already exist via the unique
-- (worker_id, assignment_date) constraint + supervisor filtering; no
-- new index is needed since project info is read alongside the row.
