-- 49-collab-work-plan-write.sql
-- Let a collaborating supervisor WRITE the initiator's shared work plan.
--
-- Background: Fix A makes accepted collaborators share ONE canonical work_plans
-- row owned by the collaboration INITIATOR — both supervisors read AND write it,
-- so either side's edits sync. Migration 47 already added the additive SELECT
-- policy ("work_plans_collaborator_select"); this adds the matching INSERT and
-- UPDATE policies. Without them, the collaborator's save to the initiator's row
-- is blocked by the supervisor-owns-own-row RLS from migration 04 and Fix A's
-- two-way sync cannot work.
--
-- ADDITIVE (Postgres OR's policies together) so a supervisor's existing ability
-- to write their OWN row (migration 04) is unchanged. A collaborator may write a
-- work_plans row ONLY when that row's owner is their partner in an ACCEPTED
-- collaboration for the same plan_date — i.e. exactly the shared canonical row.
--
-- This changes RLS policies only — it does NOT alter the work_plans table schema
-- (no columns or constraints touched). Every statement is idempotent.

-- ── Collaborator can INSERT the initiator's shared row ───────
drop policy if exists "work_plans_collaborator_ins" on public.work_plans;
create policy "work_plans_collaborator_ins"
  on public.work_plans
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = work_plans.plan_date
        and c.status          = 'accepted'
        and c.initiator_id    = work_plans.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

-- ── Collaborator can UPDATE the initiator's shared row ───────
drop policy if exists "work_plans_collaborator_upd" on public.work_plans;
create policy "work_plans_collaborator_upd"
  on public.work_plans
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = work_plans.plan_date
        and c.status          = 'accepted'
        and c.initiator_id    = work_plans.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = work_plans.plan_date
        and c.status          = 'accepted'
        and c.initiator_id    = work_plans.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );
