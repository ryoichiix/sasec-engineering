-- ============================================================
-- Step 41: Notify Site Incharge (Field Manager) when OT > 3 hrs
-- is first entered — not the Boss.
--
-- Previously, the legacy trg_notify_ot_pending trigger (step 23)
-- notified every Boss whenever ot_status = 'pending'. Since step 35
-- renamed the initial state to 'pending_field_manager', that trigger
-- no longer matches — but it's still installed, so remove it to avoid
-- any stale/duplicate Boss notifications on initial OT entry.
--
-- The Boss should only be notified once the Site Incharge approves
-- and the row moves to 'pending_boss' — that's already handled by
-- trg_notify_ot_pending_boss (step 40), which is left untouched.
--
-- Safe to re-run.
-- ============================================================

-- 1. Remove the legacy "notify boss on initial OT" trigger ─────
drop trigger if exists trg_notify_ot_pending on public.attendance;
drop function if exists public.notify_ot_pending();

-- 2. AFTER trigger: notify every Site Incharge when OT > 3 hrs
--    first needs review ────────────────────────────────────────
create or replace function public.notify_ot_pending_fm()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_worker_name text;
  v_recipient   record;
begin
  if new.ot_status <> 'pending_field_manager' then return new; end if;
  if tg_op = 'UPDATE' and old.ot_status is not distinct from new.ot_status then return new; end if;

  select full_name into v_worker_name
    from public.workers where id = new.worker_table_id;
  if v_worker_name is null then
    select full_name into v_worker_name
      from public.workers where id = new.worker_id;
  end if;

  for v_recipient in select id from public.profiles where is_field_manager = true loop
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_recipient.id,
      'ot_pending',
      'New OT request',
      'New OT request: ' || coalesce(v_worker_name, 'a worker') || ' worked ' ||
        new.ot_hours || ' hours on ' || to_char(new.attendance_date, 'FMMon FMDD') ||
        ' — needs your review.',
      new.id,
      'attendance'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_ot_pending_fm on public.attendance;
create trigger trg_notify_ot_pending_fm
  after insert or update on public.attendance
  for each row execute function public.notify_ot_pending_fm();
