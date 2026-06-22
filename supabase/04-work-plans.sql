-- ============================================================
-- Sasec Engineering — Step 4: Work plans (daily morning + evening)
-- Run AFTER 03-leave.sql. Safe to re-run.
-- ============================================================

-- 1. Table ---------------------------------------------------
create table if not exists public.work_plans (
  id                uuid primary key default gen_random_uuid(),
  supervisor_id     uuid not null references public.profiles(id) on delete cascade,
  plan_date         date not null,
  morning_plan      text,
  evening_update    text,
  morning_posted_at timestamptz,
  evening_posted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (supervisor_id, plan_date)
);

create index if not exists work_plans_date_idx
  on public.work_plans (plan_date desc);
create index if not exists work_plans_supervisor_date_idx
  on public.work_plans (supervisor_id, plan_date desc);

alter table public.work_plans enable row level security;

-- 2. updated_at touch (reuses touch_updated_at from step 2) --
drop trigger if exists work_plans_touch_updated_at on public.work_plans;
create trigger work_plans_touch_updated_at
  before update on public.work_plans
  for each row execute function public.touch_updated_at();

-- 3. BEFORE INSERT/UPDATE: stamp posted_at on null→not-null --
create or replace function public.work_plans_stamp_posted_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.morning_plan is not null then
      new.morning_posted_at := now();
    end if;
    if new.evening_update is not null then
      new.evening_posted_at := now();
    end if;
  elsif tg_op = 'UPDATE' then
    if old.morning_plan is null and new.morning_plan is not null then
      new.morning_posted_at := now();
    end if;
    if old.evening_update is null and new.evening_update is not null then
      new.evening_posted_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists work_plans_stamp_posted_at on public.work_plans;
create trigger work_plans_stamp_posted_at
  before insert or update on public.work_plans
  for each row execute function public.work_plans_stamp_posted_at();

-- 4. RLS policies --------------------------------------------
drop policy if exists "work_plans_select"          on public.work_plans;
drop policy if exists "work_plans_supervisor_ins"  on public.work_plans;
drop policy if exists "work_plans_supervisor_upd"  on public.work_plans;

create policy "work_plans_select"
  on public.work_plans
  for select
  using (auth.uid() = supervisor_id or public.is_boss());

create policy "work_plans_supervisor_ins"
  on public.work_plans
  for insert
  with check (auth.uid() = supervisor_id);

create policy "work_plans_supervisor_upd"
  on public.work_plans
  for update
  using (auth.uid() = supervisor_id)
  with check (auth.uid() = supervisor_id);

-- 5. AFTER trigger: notify every boss on a fresh post --------
create or replace function public.notify_work_plan_posted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor_name text;
  v_date_str        text;
  v_morning_new     boolean := false;
  v_evening_new     boolean := false;
  v_boss            record;
  v_payload         jsonb;
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
  v_payload  := jsonb_build_object(
    'work_plan_id', new.id,
    'plan_date',    new.plan_date
  );

  for v_boss in select id from public.profiles where role = 'boss' loop
    if v_morning_new then
      insert into public.notifications (user_id, kind, body, payload)
      values (
        v_boss.id,
        'work_plan_morning_posted',
        coalesce(v_supervisor_name, 'A supervisor')
          || ' posted the morning plan for ' || v_date_str || '.',
        v_payload
      );
    end if;
    if v_evening_new then
      insert into public.notifications (user_id, kind, body, payload)
      values (
        v_boss.id,
        'work_plan_evening_posted',
        coalesce(v_supervisor_name, 'A supervisor')
          || ' posted the evening update for ' || v_date_str || '.',
        v_payload
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
