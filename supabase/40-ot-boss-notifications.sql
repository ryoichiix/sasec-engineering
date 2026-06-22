-- ============================================================
-- Step 40: Notify Boss when OT is escalated for final approval
--
-- The existing notify_ot_decision() trigger (step 35) notifies the
-- supervisor on every transition, but never notifies the Boss when
-- a Site Incharge approves OT and it becomes 'pending_boss'. Add a
-- second AFTER trigger that alerts every Boss in that case — mirrors
-- notify_advance_pending() from step 39.
--
-- Safe to re-run.
-- ============================================================

create or replace function public.notify_ot_pending_boss()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_worker_name text;
  v_recipient   record;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if old.ot_status is not distinct from new.ot_status then return new; end if;
  if new.ot_status <> 'pending_boss' then return new; end if;

  select full_name into v_worker_name
    from public.workers where id = new.worker_table_id;
  if v_worker_name is null then
    select full_name into v_worker_name
      from public.workers where id = new.worker_id;
  end if;

  for v_recipient in select id from public.profiles where role = 'boss' loop
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_recipient.id,
      'ot_pending',
      'OT request needs approval',
      'OT request for ' || coalesce(v_worker_name, 'a worker') || ' on ' ||
        to_char(new.attendance_date, 'FMMon FMDD') ||
        ' was approved by Site Incharge and needs your final approval.',
      new.id,
      'attendance'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_ot_pending_boss on public.attendance;
create trigger trg_notify_ot_pending_boss
  after update on public.attendance
  for each row execute function public.notify_ot_pending_boss();
