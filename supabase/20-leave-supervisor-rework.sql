-- ============================================================
-- Sasec Engineering — Step 20: Leave rework (Supervisor → Boss)
--
-- Workers can no longer apply for leave. The applicant is now a
-- supervisor. A supervisor's request goes directly to the boss for
-- approval; all supervisors can see every request (read-only) and the
-- applicant supervisor is notified of the boss's decision.
--
-- The leave_requests table is rebuilt around `supervisor_id` as the
-- applicant. The legacy worker_id / supervisor-stage columns and the
-- old DB notification trigger (which referenced dropped notification
-- columns) are removed.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Tear down the old worker-based leave objects ──────────
drop trigger if exists trg_notify_leave                 on public.leave_requests;
drop trigger if exists leave_requests_before_insert      on public.leave_requests;
drop trigger if exists leave_requests_before_update      on public.leave_requests;
drop trigger if exists leave_requests_touch_updated_at   on public.leave_requests;
drop function if exists public.notify_leave_event() cascade;

drop table if exists public.leave_requests cascade;

-- ── 2. Rebuild leave_requests (supervisor is the applicant) ──
-- Reuses the existing leave_status / leave_decision enums from step 3.
create table public.leave_requests (
  id              uuid primary key default gen_random_uuid(),
  supervisor_id   uuid not null references public.profiles(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  reason          text not null,
  status          public.leave_status not null default 'pending_boss',
  boss_id         uuid references public.profiles(id) on delete set null,
  boss_decision   public.leave_decision,
  boss_note       text,
  boss_decided_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date >= start_date)
);

create index leave_requests_supervisor_idx
  on public.leave_requests (supervisor_id, created_at desc);
create index leave_requests_status_idx
  on public.leave_requests (status, created_at desc);

alter table public.leave_requests enable row level security;

-- updated_at touch
create trigger leave_requests_touch_updated_at
  before update on public.leave_requests
  for each row execute function public.touch_updated_at();

-- ── 3. BEFORE INSERT: attribute to caller, force pending_boss ─
create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Always attribute the request to the calling user (a supervisor)
  new.supervisor_id   := auth.uid();
  new.status          := 'pending_boss';
  -- Wipe any client-supplied decision fields
  new.boss_id         := null;
  new.boss_decision   := null;
  new.boss_note       := null;
  new.boss_decided_at := null;
  return new;
end;
$$;

drop trigger if exists leave_requests_before_insert on public.leave_requests;
create trigger leave_requests_before_insert
  before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();

-- ── 4. BEFORE UPDATE: only the boss can decide ───────────────
create or replace function public.leave_requests_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'pending_boss' then
    raise exception 'Cannot update a leave request with status ''%''', old.status;
  end if;
  if not public.is_boss() then
    raise exception 'Only the boss can decide on a leave request';
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

  -- Freeze immutable fields
  new.supervisor_id := old.supervisor_id;
  new.start_date    := old.start_date;
  new.end_date      := old.end_date;
  new.reason        := old.reason;

  return new;
end;
$$;

drop trigger if exists leave_requests_before_update on public.leave_requests;
create trigger leave_requests_before_update
  before update on public.leave_requests
  for each row execute function public.leave_requests_before_update();

-- ── 5. RLS policies ──────────────────────────────────────────
drop policy if exists "leave_select"            on public.leave_requests;
drop policy if exists "leave_worker_insert"     on public.leave_requests;
drop policy if exists "leave_supervisor_insert" on public.leave_requests;
drop policy if exists "leave_supervisor_upd"    on public.leave_requests;
drop policy if exists "leave_boss_upd"          on public.leave_requests;

-- Any supervisor or the boss can read every request
create policy "leave_select"
  on public.leave_requests
  for select
  using (
    public.is_boss()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'supervisor'
    )
  );

-- Supervisors create their own requests
create policy "leave_supervisor_insert"
  on public.leave_requests
  for insert
  with check (
    supervisor_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'supervisor'
    )
  );

-- Boss decides on pending requests
create policy "leave_boss_upd"
  on public.leave_requests
  for update
  using (status = 'pending_boss' and public.is_boss())
  with check (public.is_boss());

-- ── 6. notify_boss RPC (supervisor → boss on submit) ─────────
create or replace function public.notify_boss(
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
  for v_uid in (select id from public.profiles where role = 'boss') loop
    insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
    values (v_uid, p_type, p_title, p_message, p_reference_id, p_reference_type);
  end loop;
end;
$$;
