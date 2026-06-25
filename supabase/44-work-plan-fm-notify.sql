-- ============================================================
-- Sasec Engineering — Step 44: notify Site Incharges on work plan submit
-- Run AFTER 16-notifications-fix.sql. Safe to re-run.
--
-- notify_work_plan_posted() (from 16-notifications-fix.sql) currently only
-- notifies profiles with role = 'boss'. Site Incharges (profiles with
-- field_manager = true) need the same visibility into the Work Feed, so
-- this extends the trigger to also notify them.
-- ============================================================

create or replace function public.notify_work_plan_posted()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_supervisor_name text;
  v_date_str        text;
  v_morning_new     boolean := false;
  v_evening_new     boolean := false;
  v_recipient       record;
begin
  if tg_op = 'INSERT' then
    v_morning_new := new.morning_plan is not null;
    v_evening_new := new.evening_update is not null;
  elsif tg_op = 'UPDATE' then
    v_morning_new := old.morning_plan is null and new.morning_plan is not null;
    v_evening_new := old.evening_update is null and new.evening_update is not null;
  end if;

  if not v_morning_new and not v_evening_new then
    return new;
  end if;

  select full_name into v_supervisor_name
    from public.profiles where id = new.supervisor_id;

  v_date_str := to_char(new.plan_date, 'FMMon FMDD, YYYY');

  for v_recipient in
    select id from public.profiles where role = 'boss' or field_manager = true
  loop
    if v_morning_new then
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_recipient.id, 'work_plan', 'Morning plan posted',
        coalesce(v_supervisor_name, 'A supervisor')
          || ' posted the morning plan for ' || v_date_str || '.',
        new.id, 'work_plan'
      );
    end if;
    if v_evening_new then
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_recipient.id, 'work_plan', 'Evening update posted',
        coalesce(v_supervisor_name, 'A supervisor')
          || ' posted the evening update for ' || v_date_str || '.',
        new.id, 'work_plan'
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_work_plan on public.work_plans;
create trigger trg_notify_work_plan
  after insert or update on public.work_plans
  for each row execute function public.notify_work_plan_posted();
