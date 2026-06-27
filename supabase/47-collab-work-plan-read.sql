-- 47-collab-work-plan-read.sql
-- Let collaborating supervisors read each other's work plan.
--
-- Background: work_plans RLS (migration 04) only allows a supervisor to SELECT
-- their OWN plan (auth.uid() = supervisor_id) or the boss. So when Supervisor B
-- accepts Supervisor A's collaboration request, B still cannot read A's
-- work_plans row — the "Collaborating with …" partner-plan card on Today's Plan
-- silently renders nothing. Regular supervisors have no Work Feed page either,
-- so this is their only window into a partner's plan.
--
-- This migration adds ADDITIVE select policies (Postgres OR's policies together,
-- so existing access is unchanged):
--   1. Both parties to a collaboration link can SELECT that link row.
--   2. A supervisor can SELECT a work_plans row when there is an ACCEPTED
--      collaboration between them and that plan's supervisor for the same date.
--
-- Every statement is idempotent — safe to re-run.

-- ── 1. Both parties can read their collaboration links ───────
alter table public.work_plan_collaborations enable row level security;

drop policy if exists "wpc_party_select" on public.work_plan_collaborations;
create policy "wpc_party_select"
  on public.work_plan_collaborations
  for select
  to authenticated
  using (auth.uid() = initiator_id or auth.uid() = collaborator_id);

-- ── 2. Collaborator can read the partner's work plan ─────────
drop policy if exists "work_plans_collaborator_select" on public.work_plans;
create policy "work_plans_collaborator_select"
  on public.work_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date = work_plans.plan_date
        and c.status = 'accepted'
        and (
          (c.initiator_id    = auth.uid() and c.collaborator_id = work_plans.supervisor_id) or
          (c.collaborator_id = auth.uid() and c.initiator_id    = work_plans.supervisor_id)
        )
    )
  );
