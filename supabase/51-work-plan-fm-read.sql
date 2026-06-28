-- 51-work-plan-fm-read.sql
-- Let a Site Incharge (field manager) READ all supervisors' work plans.
--
-- Background: Fix B's planned-OT queue on /supervisor/approvals lists every
-- supervisor's pending OT plan so the Site Incharge can approve/reject it. The
-- work_plans RLS (migration 04) only lets a supervisor read their OWN row (or
-- the boss read all), so without this the Site Incharge's planned-OT queue comes
-- up empty. The Director already reads all plans via is_boss().
--
-- This also completes migration 44's stated intent ("field managers need the
-- same visibility into the Work Feed") at the row level — so the Site Incharge
-- Work Feed now shows all supervisors' plans, matching the Director's feed.
--
-- ADDITIVE select policy (Postgres OR's policies together); existing access is
-- unchanged. Filtering by ot_status is done in JS (lib/plan-ot.js), NOT in SQL,
-- because morning_plan may hold legacy plain text that a ::jsonb cast would
-- reject. This changes RLS only — no table schema change. Idempotent.
--
-- The Site Incharge flag is read inline from profiles.field_manager (the column
-- the app and migration 44 use) rather than via is_field_manager(), whose older
-- definition references the legacy is_field_manager column.

drop policy if exists "work_plans_field_manager_select" on public.work_plans;
create policy "work_plans_field_manager_select"
  on public.work_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.field_manager = true
    )
  );
