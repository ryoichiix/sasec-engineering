-- ============================================================
-- Sasec Engineering — Step 10: Work updates & evening reports
-- Run AFTER 09-biometric.sql. Safe to re-run.
--
-- Replaces the single morning_plan / evening_update text fields
-- with a richer structure:
--   work_updates    — running timestamped daily log (multiple entries/day)
--   evening_reports — structured end-of-day report (one per supervisor/day)
--   work_attachments — photos/documents for either parent type
--
-- The old work_plans table is left intact (no data loss).
-- ============================================================

-- 1. work_updates -------------------------------------------
create table if not exists public.work_updates (
  id            uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  update_date   date not null,
  content       text not null check (length(trim(content)) > 0),
  created_at    timestamptz not null default now()
);

create index if not exists work_updates_date_idx
  on public.work_updates (update_date desc);
create index if not exists work_updates_supervisor_date_idx
  on public.work_updates (supervisor_id, update_date desc);

alter table public.work_updates enable row level security;

drop policy if exists "work_updates_select"        on public.work_updates;
drop policy if exists "work_updates_supervisor_ins" on public.work_updates;
drop policy if exists "work_updates_supervisor_del" on public.work_updates;

create policy "work_updates_select"
  on public.work_updates for select
  using (auth.uid() = supervisor_id or public.is_boss());

create policy "work_updates_supervisor_ins"
  on public.work_updates for insert
  with check (auth.uid() = supervisor_id);

-- Allow supervisors to delete their own updates (rare but needed for mistakes)
create policy "work_updates_supervisor_del"
  on public.work_updates for delete
  using (auth.uid() = supervisor_id);

-- 2. evening_reports ----------------------------------------
create table if not exists public.evening_reports (
  id              uuid primary key default gen_random_uuid(),
  supervisor_id   uuid not null references public.profiles(id) on delete cascade,
  report_date     date not null,
  completed       text not null check (length(trim(completed)) > 0),
  pending         text not null check (length(trim(pending)) > 0),
  pending_reason  text,
  plan_tomorrow   text not null check (length(trim(plan_tomorrow)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (supervisor_id, report_date)
);

create index if not exists evening_reports_date_idx
  on public.evening_reports (report_date desc);
create index if not exists evening_reports_supervisor_date_idx
  on public.evening_reports (supervisor_id, report_date desc);

alter table public.evening_reports enable row level security;

drop trigger if exists evening_reports_touch_updated_at on public.evening_reports;
create trigger evening_reports_touch_updated_at
  before update on public.evening_reports
  for each row execute function public.touch_updated_at();

drop policy if exists "evening_reports_select"        on public.evening_reports;
drop policy if exists "evening_reports_supervisor_ins" on public.evening_reports;
drop policy if exists "evening_reports_supervisor_upd" on public.evening_reports;

create policy "evening_reports_select"
  on public.evening_reports for select
  using (auth.uid() = supervisor_id or public.is_boss());

create policy "evening_reports_supervisor_ins"
  on public.evening_reports for insert
  with check (auth.uid() = supervisor_id);

create policy "evening_reports_supervisor_upd"
  on public.evening_reports for update
  using (auth.uid() = supervisor_id)
  with check (auth.uid() = supervisor_id);

-- 3. work_attachments ----------------------------------------
create table if not exists public.work_attachments (
  id            uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  parent_type   text not null check (parent_type in ('update', 'evening_report')),
  update_id     uuid references public.work_updates(id) on delete cascade,
  report_id     uuid references public.evening_reports(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  file_size     bigint not null,
  mime_type     text not null,
  created_at    timestamptz not null default now(),
  -- Exactly one of update_id / report_id must be set
  check (
    (parent_type = 'update'         and update_id is not null and report_id is null) or
    (parent_type = 'evening_report' and report_id is not null and update_id is null)
  )
);

create index if not exists work_attachments_update_idx
  on public.work_attachments (update_id);
create index if not exists work_attachments_report_idx
  on public.work_attachments (report_id);

alter table public.work_attachments enable row level security;

drop policy if exists "work_attachments_select"        on public.work_attachments;
drop policy if exists "work_attachments_supervisor_ins" on public.work_attachments;
drop policy if exists "work_attachments_supervisor_del" on public.work_attachments;

create policy "work_attachments_select"
  on public.work_attachments for select
  using (auth.uid() = supervisor_id or public.is_boss());

create policy "work_attachments_supervisor_ins"
  on public.work_attachments for insert
  with check (auth.uid() = supervisor_id);

create policy "work_attachments_supervisor_del"
  on public.work_attachments for delete
  using (auth.uid() = supervisor_id);

-- 4. Storage bucket -----------------------------------------
-- Creates the private 'work-attachments' bucket (10 MB per file).
-- If the bucket already exists the INSERT is a no-op.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-attachments',
  'work-attachments',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- Storage object policies (objects table lives in the storage schema)
drop policy if exists "work_att_storage_upload"   on storage.objects;
drop policy if exists "work_att_storage_read"     on storage.objects;
drop policy if exists "work_att_storage_delete"   on storage.objects;

-- Upload: supervisor can write to their own subfolder {uid}/...
create policy "work_att_storage_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'work-attachments'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Read: own files or boss
create policy "work_att_storage_read"
  on storage.objects for select
  using (
    bucket_id = 'work-attachments'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.is_boss()
    )
  );

-- Delete: own files only
create policy "work_att_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'work-attachments'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
