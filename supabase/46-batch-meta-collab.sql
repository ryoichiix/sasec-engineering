-- 46-batch-meta-collab.sql
-- Schema additions for the batch-teams + multi-supervisor collaboration features.
--
--   1. today_team_batches gains a `project_description` text column and a
--      `metadata` jsonb column, so each batch can carry a FULL work plan
--      (project, work timing, equipment, overtime) — not just location + tasks.
--
--   2. work_plan_collaborations gains an RLS policy that lets the *collaborator*
--      (not only the initiator) update a row's `status`. Without this, a tagged
--      supervisor cannot Accept / Decline a collaboration request from their
--      notifications because RLS silently blocks the UPDATE.
--
-- Every statement is idempotent — safe to re-run.

-- ── 1. Batch full work plan storage ──────────────────────────
alter table public.today_team_batches
  add column if not exists project_description text,
  add column if not exists metadata            jsonb not null default '{}'::jsonb;

-- ── 2. Collaborator can respond to a collaboration request ────
alter table public.work_plan_collaborations enable row level security;

drop policy if exists "wpc_collaborator_update" on public.work_plan_collaborations;
create policy "wpc_collaborator_update"
  on public.work_plan_collaborations
  for update
  to authenticated
  using (auth.uid() = collaborator_id)
  with check (auth.uid() = collaborator_id);
