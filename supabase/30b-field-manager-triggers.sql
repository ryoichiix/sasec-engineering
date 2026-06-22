-- ============================================================
-- Sasec Engineering — Step 30b: Field Manager triggers & functions
--
-- Run this AFTER the enum values (pending_field_manager,
-- callback_requested) have already been added.
-- Skips all ALTER TYPE lines — they are already done.
-- ============================================================

-- ── 1. is_field_manager flag on profiles ─────────────────────
alter table public.profiles
  add column if not exists is_field_manager boolean not null default false;

-- ── 2. Field manager decision columns on leave_requests ──────
alter table public.leave_requests
  add column if not exists field_manager_id          uuid references public.profiles(id) on delete set null,
  add column if not exists field_manager_decision    public.leave_decision,
  add column if not exists field_manager_note        text,
  add column if not exists field_manager_decided_at  timestamptz;

-- ── 3. notify_field_managers() RPC ───────────────────────────
create or replace function public.notify_field_managers(
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
    where role = 'supervisor' and is_field_manager = true
  ) loop
    insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
    values (v_uid, p_type, p_title, p_message, p_reference_id, p_reference_type);
  end loop;
end;
$$;

-- ── 4. is_field_manager() helper ─────────────────────────────
create or replace function public.is_field_manager()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'supervisor'
      and is_field_manager = true
  );
$$;

-- ── 5. BEFORE INSERT trigger ──────────────────────────────────
create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.supervisor_id              := auth.uid();
  new.status                     := 'pending_field_manager';
  new.boss_id                    := null;
  new.boss_decision              := null;
  new.boss_note                  := null;
  new.boss_decided_at            := null;
  new.field_manager_id           := null;
  new.field_manager_decision     := null;
  new.field_manager_note         := null;
  new.field_manager_decided_at   := null;
  return new;
end;
$$;

drop trigger if exists leave_requests_before_insert on public.leave_requests;
create trigger leave_requests_before_insert
  before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();

-- ── 6. BEFORE UPDATE trigger ──────────────────────────────────
create or replace function public.leave_requests_before_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- ── Field Manager stage ──────────────────────────────────
  if old.status = 'pending_field_manager' then
    if not public.is_field_manager() then
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

    new.supervisor_id   := old.supervisor_id;
    new.start_date      := old.start_date;
    new.end_date        := old.end_date;
    new.reason          := old.reason;
    new.boss_id         := null;
    new.boss_decision   := null;
    new.boss_note       := null;
    new.boss_decided_at := null;

  -- ── Boss stage ────────────────────────────────────────────
  elsif old.status in ('pending_boss', 'callback_requested') then
    if not public.is_boss() then
      raise exception 'Only the boss can decide on this request';
    end if;

    if new.status = 'callback_requested' then
      -- Boss requests a callback — no final decision yet
      new.boss_id         := auth.uid();
      new.boss_decided_at := now();
      new.boss_decision   := null;
    elsif new.boss_decision is null then
      raise exception 'boss_decision is required';
    else
      new.status := case new.boss_decision
        when 'approved' then 'approved'::public.leave_status
        when 'rejected' then 'rejected'::public.leave_status
      end;
      new.boss_id         := auth.uid();
      new.boss_decided_at := now();
    end if;

    new.supervisor_id              := old.supervisor_id;
    new.start_date                 := old.start_date;
    new.end_date                   := old.end_date;
    new.reason                     := old.reason;
    new.field_manager_id           := old.field_manager_id;
    new.field_manager_decision     := old.field_manager_decision;
    new.field_manager_note         := old.field_manager_note;
    new.field_manager_decided_at   := old.field_manager_decided_at;

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

-- ── 7. RLS policies ───────────────────────────────────────────
drop policy if exists "leave_boss_upd"          on public.leave_requests;
drop policy if exists "leave_field_manager_upd" on public.leave_requests;

create policy "leave_field_manager_upd"
  on public.leave_requests
  for update
  using (
    status = 'pending_field_manager'
    and public.is_field_manager()
  )
  with check (public.is_field_manager());

create policy "leave_boss_upd"
  on public.leave_requests
  for update
  using (
    status in ('pending_boss', 'callback_requested')
    and public.is_boss()
  )
  with check (public.is_boss());

-- ── 8. AFTER trigger: notifications for all transitions ──────
create or replace function public.notify_leave_event()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_dates          text;
  v_applicant_name text;
  v_fm_name        text;
  v_payload        jsonb;
  v_boss           record;
  v_fm             record;
begin
  if new.start_date = new.end_date then
    v_dates := to_char(new.start_date, 'FMMon FMDD, YYYY');
  else
    v_dates := to_char(new.start_date, 'FMMon FMDD')
            || ' – ' || to_char(new.end_date, 'FMMon FMDD, YYYY');
  end if;

  select full_name into v_applicant_name
    from public.profiles where id = new.supervisor_id;

  if new.field_manager_id is not null then
    select full_name into v_fm_name
      from public.profiles where id = new.field_manager_id;
  end if;

  v_payload := jsonb_build_object(
    'leave_request_id', new.id,
    'start_date',       new.start_date,
    'end_date',         new.end_date
  );

  -- INSERT → notify all field managers
  if tg_op = 'INSERT' then
    for v_fm in (
      select id from public.profiles
      where role = 'supervisor' and is_field_manager = true
    ) loop
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        v_fm.id, 'leave_request',
        '📋 Leave Request — ' || coalesce(v_applicant_name, 'A supervisor'),
        coalesce(v_applicant_name, 'A supervisor')
          || ' requested leave for ' || v_dates || '. Awaiting your review.',
        new.id, 'leave_request'
      );
    end loop;

  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then

    -- FM approved → applicant + every boss
    if old.status = 'pending_field_manager' and new.status = 'pending_boss' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '✅ Leave forwarded to Boss',
        'Your leave for ' || v_dates
          || ' was reviewed by the Field Manager and sent to the Boss.',
        new.id, 'leave_request'
      );
      for v_boss in select id from public.profiles where role = 'boss' loop
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          v_boss.id, 'leave_request',
          '📋 Leave pending your approval — ' || coalesce(v_applicant_name, 'A supervisor'),
          coalesce(v_applicant_name, 'A supervisor')
            || ' requested leave for ' || v_dates
            || ' (approved by Field Manager '
            || coalesce(v_fm_name, 'FM') || ').',
          new.id, 'leave_request'
        );
      end loop;

    -- FM rejected → applicant only
    elsif old.status = 'pending_field_manager' and new.status = 'rejected' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '❌ Leave rejected by Field Manager',
        'Your leave for ' || v_dates || ' was rejected by the Field Manager.',
        new.id, 'leave_request'
      );

    -- Boss approved → applicant + FM
    elsif old.status in ('pending_boss', 'callback_requested') and new.status = 'approved' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '✅ Leave approved',
        'Your leave for ' || v_dates || ' has been approved by the Boss.',
        new.id, 'leave_request'
      );
      if new.field_manager_id is not null then
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          new.field_manager_id, 'leave_decision',
          '✅ Leave approved by Boss',
          'Boss approved ' || coalesce(v_applicant_name, 'a supervisor')
            || '''s leave for ' || v_dates || '.',
          new.id, 'leave_request'
        );
      end if;

    -- Boss rejected → applicant + FM
    elsif old.status in ('pending_boss', 'callback_requested') and new.status = 'rejected' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_decision',
        '❌ Leave rejected',
        'Your leave for ' || v_dates || ' has been rejected by the Boss.',
        new.id, 'leave_request'
      );
      if new.field_manager_id is not null then
        insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
        values (
          new.field_manager_id, 'leave_decision',
          '❌ Leave rejected by Boss',
          'Boss rejected ' || coalesce(v_applicant_name, 'a supervisor')
            || '''s leave for ' || v_dates || '.',
          new.id, 'leave_request'
        );
      end if;

    -- Boss requested callback → notify applicant
    elsif new.status = 'callback_requested' then
      insert into public.notifications (user_id, type, title, message, reference_id, reference_type)
      values (
        new.supervisor_id, 'leave_request',
        '📞 Callback requested by Boss',
        'Boss has requested a callback regarding your leave for ' || v_dates
          || '. Please contact them before a decision is made.',
        new.id, 'leave_request'
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_leave on public.leave_requests;
create trigger trg_notify_leave
  after insert or update on public.leave_requests
  for each row execute function public.notify_leave_event();
