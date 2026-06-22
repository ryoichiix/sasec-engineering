-- ============================================================
-- Sasec Engineering — Step 3: Leave workflow
-- Run AFTER 02-attendance.sql. Safe to re-run.
-- ============================================================

-- 1. Enums ---------------------------------------------------
do $$ begin
  create type public.leave_status as enum
    ('pending_supervisor', 'pending_boss', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.leave_decision as enum ('approved', 'rejected');
exception when duplicate_object then null;
end $$;

-- 2. leave_requests table ------------------------------------
create table if not exists public.leave_requests (
  id                    uuid primary key default gen_random_uuid(),
  worker_id             uuid not null references public.profiles(id) on delete cascade,
  supervisor_id         uuid references public.profiles(id) on delete set null,
  start_date            date not null,
  end_date              date not null,
  reason                text not null,
  status                public.leave_status not null default 'pending_supervisor',
  supervisor_decision   public.leave_decision,
  supervisor_note       text,
  supervisor_decided_at timestamptz,
  boss_id               uuid references public.profiles(id) on delete set null,
  boss_decision         public.leave_decision,
  boss_note             text,
  boss_decided_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists leave_requests_worker_idx
  on public.leave_requests (worker_id, created_at desc);
create index if not exists leave_requests_supervisor_idx
  on public.leave_requests (supervisor_id, status, created_at desc);
create index if not exists leave_requests_status_idx
  on public.leave_requests (status, created_at desc);

alter table public.leave_requests enable row level security;

-- 3. updated_at touch (reuses touch_updated_at from step 2) --
drop trigger if exists leave_requests_touch_updated_at on public.leave_requests;
create trigger leave_requests_touch_updated_at
  before update on public.leave_requests
  for each row execute function public.touch_updated_at();

-- 4. BEFORE INSERT: snapshot supervisor, lock state ----------
create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor uuid;
begin
  -- Always attribute the request to the calling user
  new.worker_id := auth.uid();

  select supervisor_id into v_supervisor
    from public.profiles where id = new.worker_id;

  if v_supervisor is null then
    raise exception 'No supervisor assigned to you yet';
  end if;

  new.supervisor_id        := v_supervisor;
  new.status               := 'pending_supervisor';
  -- Wipe any client-provided decision fields
  new.supervisor_decision  := null;
  new.supervisor_note      := null;
  new.supervisor_decided_at := null;
  new.boss_id              := null;
  new.boss_decision        := null;
  new.boss_note            := null;
  new.boss_decided_at      := null;

  return new;
end;
$$;

drop trigger if exists leave_requests_before_insert on public.leave_requests;
create trigger leave_requests_before_insert
  before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();

-- 5. BEFORE UPDATE: enforce the state machine ---------------
create or replace function public.leave_requests_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_supervisor boolean;
  v_is_boss boolean;
begin
  v_is_supervisor := (old.supervisor_id = auth.uid());
  v_is_boss       := public.is_boss();

  if old.status = 'pending_supervisor' then
    if not v_is_supervisor then
      raise exception 'Only the assigned supervisor can decide on this request';
    end if;
    if new.supervisor_decision is null then
      raise exception 'supervisor_decision is required';
    end if;

    -- Derive status from decision
    new.status := case new.supervisor_decision
      when 'approved' then 'pending_boss'::public.leave_status
      when 'rejected' then 'rejected'::public.leave_status
    end;
    new.supervisor_decided_at := now();

    -- Freeze fields the supervisor must not change
    new.worker_id           := old.worker_id;
    new.supervisor_id       := old.supervisor_id;
    new.start_date          := old.start_date;
    new.end_date            := old.end_date;
    new.reason              := old.reason;
    new.boss_id             := null;
    new.boss_decision       := null;
    new.boss_note           := null;
    new.boss_decided_at     := null;

  elsif old.status = 'pending_boss' then
    if not v_is_boss then
      raise exception 'Only a boss can decide on this request';
    end if;
    if new.boss_decision is null then
      raise exception 'boss_decision is required';
    end if;

    new.status := case new.boss_decision
      when 'approved' then 'approved'::public.leave_status
      when 'rejected' then 'rejected'::public.leave_status
    end;
    new.boss_decided_at := now();
    new.boss_id         := auth.uid();

    new.worker_id           := old.worker_id;
    new.supervisor_id       := old.supervisor_id;
    new.start_date          := old.start_date;
    new.end_date            := old.end_date;
    new.reason              := old.reason;
    new.supervisor_decision := old.supervisor_decision;
    new.supervisor_note     := old.supervisor_note;
    new.supervisor_decided_at := old.supervisor_decided_at;

  else
    raise exception 'Cannot update a request with status %', old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists leave_requests_before_update on public.leave_requests;
create trigger leave_requests_before_update
  before update on public.leave_requests
  for each row execute function public.leave_requests_before_update();

-- 6. RLS policies --------------------------------------------
drop policy if exists "leave_select"          on public.leave_requests;
drop policy if exists "leave_worker_insert"   on public.leave_requests;
drop policy if exists "leave_supervisor_upd"  on public.leave_requests;
drop policy if exists "leave_boss_upd"        on public.leave_requests;

create policy "leave_select"
  on public.leave_requests
  for select
  using (
    auth.uid() = worker_id
    or auth.uid() = supervisor_id
    or public.is_boss()
  );

create policy "leave_worker_insert"
  on public.leave_requests
  for insert
  with check (auth.uid() = worker_id);

create policy "leave_supervisor_upd"
  on public.leave_requests
  for update
  using (status = 'pending_supervisor' and auth.uid() = supervisor_id)
  with check (auth.uid() = supervisor_id);

create policy "leave_boss_upd"
  on public.leave_requests
  for update
  using (status = 'pending_boss' and public.is_boss())
  with check (public.is_boss());

-- 7. AFTER INSERT/UPDATE: notifications ---------------------
create or replace function public.notify_leave_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates           text;
  v_worker_name     text;
  v_supervisor_name text;
  v_payload         jsonb;
  v_boss            record;
begin
  if new.start_date = new.end_date then
    v_dates := to_char(new.start_date, 'FMMon FMDD, YYYY');
  else
    v_dates := to_char(new.start_date, 'FMMon FMDD')
            || ' – ' || to_char(new.end_date, 'FMMon FMDD, YYYY');
  end if;

  select full_name into v_worker_name
    from public.profiles where id = new.worker_id;
  select full_name into v_supervisor_name
    from public.profiles where id = new.supervisor_id;

  v_payload := jsonb_build_object(
    'leave_request_id', new.id,
    'start_date',       new.start_date,
    'end_date',         new.end_date
  );

  if tg_op = 'INSERT' then
    if new.supervisor_id is not null then
      insert into public.notifications (user_id, kind, body, payload)
      values (
        new.supervisor_id,
        'leave_submitted',
        coalesce(v_worker_name, 'A worker')
          || ' requested leave for ' || v_dates || '.',
        v_payload
      );
    end if;

  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'pending_supervisor' and new.status = 'pending_boss' then
      -- worker
      insert into public.notifications (user_id, kind, body, payload)
      values (
        new.worker_id, 'leave_supervisor_approved',
        'Your leave for ' || v_dates
          || ' was approved by '
          || coalesce(v_supervisor_name, 'your supervisor')
          || ' and sent to the boss.',
        v_payload
      );
      -- every boss
      for v_boss in select id from public.profiles where role = 'boss' loop
        insert into public.notifications (user_id, kind, body, payload)
        values (
          v_boss.id, 'leave_supervisor_approved',
          coalesce(v_worker_name, 'A worker')
            || ' is requesting leave for ' || v_dates
            || ' (approved by '
            || coalesce(v_supervisor_name, 'their supervisor') || ').',
          v_payload
        );
      end loop;

    elsif old.status = 'pending_supervisor' and new.status = 'rejected' then
      insert into public.notifications (user_id, kind, body, payload)
      values (
        new.worker_id, 'leave_supervisor_rejected',
        'Your leave for ' || v_dates
          || ' was rejected by '
          || coalesce(v_supervisor_name, 'your supervisor') || '.',
        v_payload
      );

    elsif old.status = 'pending_boss' and new.status = 'approved' then
      insert into public.notifications (user_id, kind, body, payload)
      values (
        new.worker_id, 'leave_boss_approved',
        'Your leave for ' || v_dates || ' was approved.',
        v_payload
      );
      if new.supervisor_id is not null then
        insert into public.notifications (user_id, kind, body, payload)
        values (
          new.supervisor_id, 'leave_boss_approved',
          'Boss approved '
            || coalesce(v_worker_name, 'a worker')
            || '''s leave for ' || v_dates || '.',
          v_payload
        );
      end if;

    elsif old.status = 'pending_boss' and new.status = 'rejected' then
      insert into public.notifications (user_id, kind, body, payload)
      values (
        new.worker_id, 'leave_boss_rejected',
        'Your leave for ' || v_dates
          || ' was rejected by the boss.',
        v_payload
      );
      if new.supervisor_id is not null then
        insert into public.notifications (user_id, kind, body, payload)
        values (
          new.supervisor_id, 'leave_boss_rejected',
          'Boss rejected '
            || coalesce(v_worker_name, 'a worker')
            || '''s leave for ' || v_dates || '.',
          v_payload
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_leave on public.leave_requests;
create trigger trg_notify_leave
  after insert or update on public.leave_requests
  for each row execute function public.notify_leave_event();
