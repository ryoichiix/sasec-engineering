-- ============================================================
-- Step 37: Advance approval workflow
--
-- Mirrors the OT approval flow (step 35):
--   amount ≤ ₹1000           → 'direct'              (auto, saved & paid out)
--   amount > ₹1000 on INSERT  → 'pending_site_incharge'
--   Site Incharge approves    → 'pending_boss'
--   Site Incharge rejects     → 'rejected' (amount zeroed by trigger)
--   Boss approves             → 'approved'
--   Boss rejects              → 'rejected' (amount zeroed by trigger)
--
-- Payroll deducts only amounts whose advance_status is 'direct'
-- or 'approved'. Pending and rejected contribute ₹0.
--
-- Safe to re-run.
-- ============================================================

-- Threshold constant the trigger uses to decide auto vs needs-approval.
-- Kept as a function so it can be changed in one place if business rules change.
create or replace function public.advance_auto_threshold()
returns numeric language sql immutable as $$ select 1000::numeric $$;

-- ── 1. Status columns ────────────────────────────────────────
alter table public.weekly_advances
  add column if not exists advance_status      text,
  add column if not exists fm_decided_by       uuid references public.profiles(id),
  add column if not exists fm_decided_at       timestamptz,
  add column if not exists decided_by          uuid references public.profiles(id),
  add column if not exists decided_at          timestamptz;

-- Backfill any existing rows: they were saved directly under the old flow.
update public.weekly_advances
  set advance_status = 'direct'
  where advance_status is null;

-- Check constraint on advance_status
alter table public.weekly_advances
  drop constraint if exists weekly_advances_status_check;

alter table public.weekly_advances
  add constraint weekly_advances_status_check
  check (advance_status in (
    'direct',
    'pending_site_incharge',
    'pending_boss',
    'approved',
    'rejected'
  ));

-- ── 2. BEFORE trigger: set advance_status based on amount ────
create or replace function public.weekly_advances_set_status()
returns trigger
language plpgsql
as $$
declare
  v_threshold numeric := public.advance_auto_threshold();
begin
  -- Zeroed advance → reset everything
  if new.amount = 0 or new.amount is null then
    new.advance_status := 'direct';
    new.fm_decided_by  := null;
    new.fm_decided_at  := null;
    new.decided_by     := null;
    new.decided_at     := null;
    return new;
  end if;

  -- Small advance ≤ threshold → auto-direct
  if new.amount <= v_threshold then
    new.advance_status := 'direct';
    new.fm_decided_by  := null;
    new.fm_decided_at  := null;
    new.decided_by     := null;
    new.decided_at     := null;
    return new;
  end if;

  -- Large advance > threshold ────────────────────────────────
  if tg_op = 'INSERT' then
    new.advance_status := 'pending_site_incharge';
    new.fm_decided_by  := null;
    new.fm_decided_at  := null;
    new.decided_by     := null;
    new.decided_at     := null;

  elsif tg_op = 'UPDATE' then
    -- A decision is being submitted (status explicitly transitioning).
    if new.advance_status in ('pending_boss', 'approved', 'rejected')
       and old.advance_status is distinct from new.advance_status then
      -- Timestamp FM decision
      if new.advance_status = 'pending_boss' then
        new.fm_decided_at := coalesce(new.fm_decided_at, now());
      end if;
      -- Timestamp Boss decision
      if new.advance_status in ('approved', 'rejected') then
        new.decided_at := coalesce(new.decided_at, now());
      end if;
      -- Reject → zero out the amount
      if new.advance_status = 'rejected' then
        new.amount := 0;
      end if;

    -- Supervisor raised the amount past the threshold on this update
    elsif old.amount is distinct from new.amount
          and (old.amount is null or old.amount <= v_threshold)
          and new.amount > v_threshold then
      new.advance_status := 'pending_site_incharge';
      new.fm_decided_by  := null;
      new.fm_decided_at  := null;
      new.decided_by     := null;
      new.decided_at     := null;

    -- Supervisor edited an amount that was previously pending/approved and
    -- the new value is still > threshold but advance_status was cleared.
    elsif new.advance_status is null then
      new.advance_status := 'pending_site_incharge';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_weekly_advances_set_status on public.weekly_advances;
create trigger trg_weekly_advances_set_status
  before insert or update on public.weekly_advances
  for each row execute function public.weekly_advances_set_status();

-- ── 3. AFTER trigger: notify supervisor on each transition ───
create or replace function public.notify_advance_decision()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_worker_name text;
  v_sup_id      uuid;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if old.advance_status is not distinct from new.advance_status then return new; end if;

  v_sup_id := new.supervisor_id;
  if v_sup_id is null then return new; end if;

  select full_name into v_worker_name
    from public.workers where id = new.worker_id;
  if v_worker_name is null then
    select full_name into v_worker_name
      from public.profiles where id = new.worker_id;
  end if;

  -- Site Incharge approved → forwarded to Boss
  if old.advance_status in ('pending_site_incharge', 'pending_field_manager')
     and new.advance_status = 'pending_boss' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'advance_decision',
      'Advance forwarded to Boss',
      'Your advance request of ₹' || new.amount || ' for ' ||
        coalesce(v_worker_name, 'a worker') ||
        ' was reviewed by the Site Incharge and sent to the Boss.',
      new.id,
      'advance'
    );

  -- Boss final approval
  elsif new.advance_status = 'approved' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'advance_decision',
      'Advance Approved',
      'Your advance request of ₹' || new.amount || ' for ' ||
        coalesce(v_worker_name, 'a worker') ||
        ' has been approved by Boss.',
      new.id,
      'advance'
    );

  -- Boss rejection (final)
  elsif new.advance_status = 'rejected' and old.advance_status = 'pending_boss' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'advance_decision',
      'Advance Rejected',
      'Your advance request for ' || coalesce(v_worker_name, 'a worker') ||
        ' has been rejected by Boss.',
      new.id,
      'advance'
    );

  -- Site Incharge rejection
  elsif new.advance_status = 'rejected' then
    insert into public.notifications
      (user_id, type, title, message, reference_id, reference_type)
    values (
      v_sup_id,
      'advance_decision',
      'Advance Rejected',
      'Your advance request for ' || coalesce(v_worker_name, 'a worker') ||
        ' was rejected by the Site Incharge.',
      new.id,
      'advance'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_advance_decision on public.weekly_advances;
create trigger trg_notify_advance_decision
  after update on public.weekly_advances
  for each row execute function public.notify_advance_decision();

-- ── 3b. Suppress legacy 'advance_alert' notifications for amounts that
--      are still under approval — bosses should only see a one-time
--      "Advance recorded" alert when the amount is actually counted
--      in payroll (status = 'direct' or 'approved').
create or replace function public.notify_advance_recorded()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_worker_name     text;
  v_supervisor_name text;
  v_week_str        text;
  v_mode_label      text;
  v_boss            record;
  v_should_notify   boolean := false;
begin
  -- Only notify bosses when the advance is actually live in payroll.
  if new.advance_status not in ('direct', 'approved') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.amount > 0 then
    v_should_notify := true;
  elsif tg_op = 'UPDATE' and new.amount > 0
        and (
          old.amount is distinct from new.amount
          or old.payment_mode is distinct from new.payment_mode
          or (old.advance_status is distinct from new.advance_status and new.advance_status = 'approved')
        ) then
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

-- ── 4. RLS additions ─────────────────────────────────────────
-- Site Incharges (is_field_manager=true) need to read all pending advances
-- to review them.
drop policy if exists "wa_fm_select" on public.weekly_advances;
create policy "wa_fm_select" on public.weekly_advances
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_field_manager = true
    )
  );

-- Site Incharges can update pending_site_incharge rows (to escalate/reject).
drop policy if exists "wa_fm_update" on public.weekly_advances;
create policy "wa_fm_update" on public.weekly_advances
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_field_manager = true
    )
  );
