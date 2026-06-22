-- ============================================================
-- Sasec Engineering — Step 21: Voice messages for work updates + leave
-- Run AFTER 10-work-updates.sql and 20-leave-supervisor-rework.sql.
-- Safe to re-run.
--
-- Changes:
--   1. Allow audio MIME types in the work-attachments storage bucket
--      so voice recordings (webm/ogg/mp4) can be uploaded.
--   2. Allow empty-string content in work_updates so supervisors can
--      post voice-only updates with no typed text.
--   3. Extend work_attachments to support leave_request parent type
--      so voice recordings can be attached to leave requests.
-- ============================================================

-- ── 1. Extend the storage bucket MIME allowlist ─────────────

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  -- audio formats for voice messages
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a'
]
where id = 'work-attachments';

-- ── 2. Allow empty-string content in work_updates ───────────
--
-- The original table has: content text not null check (length(trim(content)) > 0)
-- We keep NOT NULL (voice-only updates use '' as content) but drop the
-- non-empty check so an empty string is valid.

-- Drop the existing check constraint (auto-named by Postgres — we locate it
-- dynamically to avoid hard-coding the generated name).
do $$
declare
  cname text;
begin
  select cc.conname into cname
  from pg_constraint cc
  join pg_class      cl on cl.oid = cc.conrelid
  join pg_attribute   a on a.attrelid = cl.oid and a.attnum = any(cc.conkey)
  where cl.relname = 'work_updates'
    and cc.contype = 'c'
    and a.attname  = 'content'
  limit 1;

  if cname is not null then
    execute format('alter table public.work_updates drop constraint if exists %I', cname);
  end if;
end $$;

-- Set default to empty string so inserts without content always succeed
alter table public.work_updates
  alter column content set default '';

-- ── 3. Extend work_attachments for leave_request parent type ─

-- Add the new FK column (idempotent)
alter table public.work_attachments
  add column if not exists leave_request_id uuid
    references public.leave_requests(id) on delete cascade;

-- Update parent_type allowed values
alter table public.work_attachments
  drop constraint if exists work_attachments_parent_type_check;
alter table public.work_attachments
  add constraint work_attachments_parent_type_check
  check (parent_type in ('update', 'evening_report', 'leave_request'));

-- Replace the "exactly-one-parent" check to include leave_request
alter table public.work_attachments
  drop constraint if exists work_attachments_check;
alter table public.work_attachments
  add constraint work_attachments_check check (
    (parent_type = 'update'         and update_id        is not null and report_id       is null and leave_request_id is null) or
    (parent_type = 'evening_report' and report_id        is not null and update_id        is null and leave_request_id is null) or
    (parent_type = 'leave_request'  and leave_request_id is not null and update_id        is null and report_id        is null)
  );
