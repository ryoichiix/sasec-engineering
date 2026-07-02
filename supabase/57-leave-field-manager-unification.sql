-- ============================================================
-- Sasec Engineering — Step 57: Unify Site Incharge flag for
-- leave approval onto the live `profiles.field_manager` column.
--
-- BUG CLASS (same as migration 53/56): the leave-approval
-- permission check was gated on public.is_field_manager(), which
-- reads the LEGACY `profiles.is_field_manager` column. The live
-- Site Incharge flag used by the app and the /boss/supervisors
-- page is `profiles.field_manager`. The two are never synced, so
-- a real Site Incharge (field_manager = true, is_field_manager =
-- false) would be silently DENIED when approving/rejecting leave:
--   • RLS policy leave_field_manager_upd blocks the UPDATE, and
--   • the leave_requests_before_update() trigger raises
--     "Only a Field Manager can decide on this request".
--
-- FIX: switch BOTH leave-approval permission checks to
-- public.is_site_incharge() (migration 56), which reads the live
-- `field_manager` column. The leave STATE MACHINE (statuses,
-- transitions, field freezing) is preserved verbatim from
-- migration 34 — only the single permission-check line changes.
--
-- Scope note: the advance RLS (37), advance notify (39) and OT
-- notify (41) flows still read the legacy column and are
-- intentionally NOT touched here, so the legacy column is kept
-- and only DEPRECATED — not dropped. A later, separate migration
-- can drop it once those flows are migrated too.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. RLS policy: use the live Site Incharge helper ─────────
drop policy if exists "leave_field_manager_upd" on public.leave_requests;

create policy "leave_field_manager_upd"
  on public.leave_requests
  for update
  using (
    status = 'pending_field_manager'
    and public.is_site_incharge()
  )
  with check (public.is_site_incharge());

-- ── 2. BEFORE UPDATE trigger: swap only the permission check ─
-- Body is identical to migration 34 (branch ordering fix + field
-- freezing) EXCEPT the FM-stage gate now calls is_site_incharge().
create or replace function public.leave_requests_before_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- ── Field Manager (Site Incharge) stage ───────────────────
  if old.status = 'pending_field_manager' then
    if not public.is_site_incharge() then
      raise exception 'Only a Field Manager can decide on this request';
    end if;
    if new.field_manager_decision is null then
      raise exception 'field_manager_decision is required';
    end if;

    new.field_manager_id         := auth.uid();
    new.field_manager_decided_at := now();
    new.status := case new.field_manager_decision
      when 'approved' then 'pending_boss'::public.leave_status
      when 'rejected' then 'rejected'::public.leave_status
    end;

    -- Freeze immutable fields
    new.supervisor_id       := old.supervisor_id;
    new.start_date          := old.start_date;
    new.end_date            := old.end_date;
    new.reason              := old.reason;
    new.boss_id             := null;
    new.boss_decision       := null;
    new.boss_note           := null;
    new.boss_decided_at     := null;

  -- ── Boss stage ────────────────────────────────────────────
  elsif old.status in ('pending_boss', 'callback_requested') then
    if not public.is_boss() then
      raise exception 'Only the boss can decide on this request';
    end if;

    -- Check boss_decision FIRST (final decision), then callback.
    if new.boss_decision is not null then
      new.status          := case new.boss_decision
        when 'approved' then 'approved'::public.leave_status
        when 'rejected' then 'rejected'::public.leave_status
      end;
      new.boss_id         := auth.uid();
      new.boss_decided_at := now();

    elsif new.status = 'callback_requested' then
      new.boss_id         := auth.uid();
      new.boss_decided_at := now();
      new.boss_decision   := null;

    else
      raise exception 'boss_decision is required to make a final decision';
    end if;

    -- Freeze immutable fields
    new.supervisor_id            := old.supervisor_id;
    new.start_date               := old.start_date;
    new.end_date                 := old.end_date;
    new.reason                   := old.reason;
    new.field_manager_id         := old.field_manager_id;
    new.field_manager_decision   := old.field_manager_decision;
    new.field_manager_note       := old.field_manager_note;
    new.field_manager_decided_at := old.field_manager_decided_at;

  else
    raise exception 'Cannot update a leave request with status ''%''', old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists leave_requests_before_update on public.leave_requests;
create trigger leave_requests_before_update
  before update on public.leave_requests
  for each row execute function public.leave_requests_before_update();

-- ── 3. Safety-net sync ───────────────────────────────────────
-- Promote any real Site Incharge that was only ever set via the
-- legacy page/column so nobody loses approval rights at cutover.
update public.profiles
  set field_manager = true
  where is_field_manager = true
    and field_manager = false;

-- ── 4. Deprecate the legacy column (do NOT drop yet) ─────────
comment on column public.profiles.is_field_manager is
  'DEPRECATED - use field_manager instead, scheduled for removal';
