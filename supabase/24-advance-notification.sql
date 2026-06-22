-- ============================================================
-- Step 24: Notify boss(es) on weekly advance entry
-- Each insert or amount change creates an "advance_alert"
-- notification for every boss. Safe to re-run.
-- ============================================================

create or replace function public.notify_advance_recorded()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_worker_name     text;
  v_supervisor_name text;
  v_week_str        text;
  v_mode_label      text;
  v_boss            record;
  v_should_notify   boolean := false;
begin
  if tg_op = 'INSERT' and new.amount > 0 then
    v_should_notify := true;
  elsif tg_op = 'UPDATE' and new.amount > 0
        and (old.amount is distinct from new.amount or old.payment_mode is distinct from new.payment_mode) then
    v_should_notify := true;
  end if;

  if not v_should_notify then
    return new;
  end if;

  select full_name into v_worker_name
    from public.profiles where id = new.worker_id;
  select full_name into v_supervisor_name
    from public.profiles where id = new.supervisor_id;

  v_week_str := to_char(new.week_start, 'FMMon FMDD, YYYY');
  v_mode_label := case new.payment_mode
    when 'bank_transfer' then 'Bank Transfer'
    else 'Cash'
  end;

  for v_boss in select id from public.profiles where role = 'boss' loop
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_boss.id,
      'advance_alert',
      'Advance recorded',
      coalesce(v_supervisor_name, 'A supervisor')
        || ' gave ₹' || new.amount || ' (' || v_mode_label || ') to '
        || coalesce(v_worker_name, 'a worker')
        || ' for week of ' || v_week_str || '.',
      new.id,
      'advance'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_advance on public.weekly_advances;
create trigger trg_notify_advance
  after insert or update on public.weekly_advances
  for each row execute function public.notify_advance_recorded();
