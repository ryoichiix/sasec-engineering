-- ============================================================
-- Step 39: Fix Advance Approval notifications
--
-- Adds the two missing notifications:
--   • New advance > ₹1000 (pending_site_incharge) → notify all
--     Site Incharges (profiles.is_field_manager = true)
--   • Site Incharge approves (pending_boss) → notify all Bosses
--
-- Existing notify_advance_decision() already covers:
--   • Site Incharge approve → notify supervisor (forwarded)
--   • Boss approve/reject → notify supervisor
--   • Site Incharge reject → notify supervisor
--
-- Safe to re-run.
-- ============================================================

create or replace function public.notify_advance_pending()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_worker_name text;
  v_recipient   record;
begin
  -- Fire when a row newly becomes pending_site_incharge or pending_boss.
  if tg_op = 'INSERT' then
    if new.advance_status is distinct from 'pending_site_incharge' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.advance_status is not distinct from new.advance_status then return new; end if;
    if new.advance_status not in ('pending_site_incharge', 'pending_boss') then return new; end if;
  else
    return new;
  end if;

  select full_name into v_worker_name
    from public.workers where id = new.worker_id;
  if v_worker_name is null then
    select full_name into v_worker_name
      from public.profiles where id = new.worker_id;
  end if;

  if new.advance_status = 'pending_site_incharge' then
    for v_recipient in select id from public.profiles where is_field_manager = true loop
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_recipient.id,
        'advance_pending',
        'New advance request',
        'New advance request of ₹' || new.amount || ' for ' ||
          coalesce(v_worker_name, 'a worker') || ' needs your review.',
        new.id,
        'advance'
      );
    end loop;

  elsif new.advance_status = 'pending_boss' then
    for v_recipient in select id from public.profiles where role = 'boss' loop
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_recipient.id,
        'advance_pending',
        'Advance request needs approval',
        'Advance request of ₹' || new.amount || ' for ' ||
          coalesce(v_worker_name, 'a worker') ||
          ' was approved by Site Incharge and needs your final approval.',
        new.id,
        'advance'
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_advance_pending on public.weekly_advances;
create trigger trg_notify_advance_pending
  after insert or update on public.weekly_advances
  for each row execute function public.notify_advance_pending();
