-- ============================================================
-- Sasec Engineering — Step 25: Leave voice + supervisor notifications
-- Safe to re-run.
--
-- 1. notify_other_supervisors RPC: inserts a notification for every
--    supervisor EXCEPT the caller. Used when a supervisor submits
--    a leave request.
--
-- 2. notify_all_supervisors RPC: inserts for ALL supervisors. Used
--    when the boss makes a decision so every supervisor sees the
--    updated status.
-- ============================================================

-- ── 1. notify_other_supervisors ──────────────────────────────
create or replace function public.notify_other_supervisors(
  p_title          text,
  p_message        text      default null,
  p_type           text      default 'info',
  p_reference_id   uuid      default null,
  p_reference_type text      default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  for v_uid in (
    select id from public.profiles
    where role = 'supervisor'
      and id <> auth.uid()          -- exclude the caller
  ) loop
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values
      (v_uid, coalesce(p_type,'info'), coalesce(p_title,'Notification'),
       p_message, p_reference_id, p_reference_type);
  end loop;
end;
$$;

-- ── 2. notify_all_supervisors ────────────────────────────────
create or replace function public.notify_all_supervisors(
  p_title          text,
  p_message        text      default null,
  p_type           text      default 'info',
  p_reference_id   uuid      default null,
  p_reference_type text      default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  for v_uid in (
    select id from public.profiles
    where role = 'supervisor'
  ) loop
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values
      (v_uid, coalesce(p_type,'info'), coalesce(p_title,'Notification'),
       p_message, p_reference_id, p_reference_type);
  end loop;
end;
$$;
