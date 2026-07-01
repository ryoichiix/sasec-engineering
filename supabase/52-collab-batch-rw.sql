-- 52-collab-batch-rw.sql
-- Extend Fix A (shared canonical work plan for accepted collaborators) to BATCH
-- MODE — today_team_batches + batch_worker_assignments.
--
-- Background: migrations 47 + 49 added additive SELECT / INSERT / UPDATE RLS on
-- work_plans so a collaborator can read and write the initiator's shared row.
-- Migration 48 added work_plans to the realtime publication so those edits fire
-- postgres_changes to both sides. Batch mode (today_team_batches +
-- batch_worker_assignments) needs the same three things, or a collaborator
-- cannot see, add, edit, or receive live updates for the shared batch set.
--
-- ADDITIVE (Postgres OR's RLS policies) so a supervisor's existing owner-only
-- write rights are unchanged. A collaborator may read/write a batch row ONLY
-- when that row's supervisor is their partner in an ACCEPTED collaboration for
-- the same date — i.e. exactly the shared canonical batch set. Delete rights
-- are included because updateBatchRecord() in src/lib/batches.js does a
-- delete-all + reinsert on batch_worker_assignments to replace the roster.
--
-- Idempotent: drop-if-exists + create; the publication add uses a duplicate_object
-- guard so re-running is a no-op.
--
-- No columns or constraints are touched.

-- ── 1. today_team_batches — collaborator select/insert/update/delete ─────────
alter table public.today_team_batches enable row level security;

drop policy if exists "ttb_collaborator_select" on public.today_team_batches;
create policy "ttb_collaborator_select"
  on public.today_team_batches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = today_team_batches.date
        and c.status          = 'accepted'
        and (
          (c.initiator_id    = auth.uid() and c.collaborator_id = today_team_batches.supervisor_id) or
          (c.collaborator_id = auth.uid() and c.initiator_id    = today_team_batches.supervisor_id)
        )
    )
  );

drop policy if exists "ttb_collaborator_ins" on public.today_team_batches;
create policy "ttb_collaborator_ins"
  on public.today_team_batches
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = today_team_batches.date
        and c.status          = 'accepted'
        and c.initiator_id    = today_team_batches.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

drop policy if exists "ttb_collaborator_upd" on public.today_team_batches;
create policy "ttb_collaborator_upd"
  on public.today_team_batches
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = today_team_batches.date
        and c.status          = 'accepted'
        and c.initiator_id    = today_team_batches.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = today_team_batches.date
        and c.status          = 'accepted'
        and c.initiator_id    = today_team_batches.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

drop policy if exists "ttb_collaborator_del" on public.today_team_batches;
create policy "ttb_collaborator_del"
  on public.today_team_batches
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.work_plan_collaborations c
      where c.date            = today_team_batches.date
        and c.status          = 'accepted'
        and c.initiator_id    = today_team_batches.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

-- ── 2. batch_worker_assignments — reach through to parent batch's owner ─────
-- The assignment rows have no supervisor_id / date columns of their own, so the
-- policy joins back to the parent today_team_batches row. Same accepted-collab
-- test as above, but expressed relative to the parent.
alter table public.batch_worker_assignments enable row level security;

drop policy if exists "bwa_collaborator_select" on public.batch_worker_assignments;
create policy "bwa_collaborator_select"
  on public.batch_worker_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.today_team_batches b
      join public.work_plan_collaborations c
        on c.date = b.date and c.status = 'accepted'
      where b.id = batch_worker_assignments.batch_id
        and (
          (c.initiator_id    = auth.uid() and c.collaborator_id = b.supervisor_id) or
          (c.collaborator_id = auth.uid() and c.initiator_id    = b.supervisor_id)
        )
    )
  );

drop policy if exists "bwa_collaborator_ins" on public.batch_worker_assignments;
create policy "bwa_collaborator_ins"
  on public.batch_worker_assignments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.today_team_batches b
      join public.work_plan_collaborations c
        on c.date = b.date and c.status = 'accepted'
      where b.id = batch_worker_assignments.batch_id
        and c.initiator_id    = b.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

drop policy if exists "bwa_collaborator_upd" on public.batch_worker_assignments;
create policy "bwa_collaborator_upd"
  on public.batch_worker_assignments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.today_team_batches b
      join public.work_plan_collaborations c
        on c.date = b.date and c.status = 'accepted'
      where b.id = batch_worker_assignments.batch_id
        and c.initiator_id    = b.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.today_team_batches b
      join public.work_plan_collaborations c
        on c.date = b.date and c.status = 'accepted'
      where b.id = batch_worker_assignments.batch_id
        and c.initiator_id    = b.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

drop policy if exists "bwa_collaborator_del" on public.batch_worker_assignments;
create policy "bwa_collaborator_del"
  on public.batch_worker_assignments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.today_team_batches b
      join public.work_plan_collaborations c
        on c.date = b.date and c.status = 'accepted'
      where b.id = batch_worker_assignments.batch_id
        and c.initiator_id    = b.supervisor_id
        and c.collaborator_id = auth.uid()
    )
  );

-- ── 3. Realtime publication — batch tables broadcast postgres_changes ───────
do $$
begin
  alter publication supabase_realtime add table public.today_team_batches;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.batch_worker_assignments;
exception when duplicate_object then null;
end $$;
