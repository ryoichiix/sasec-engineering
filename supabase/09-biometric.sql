-- ============================================================
-- Sasec Engineering — Step 9: Biometric (ZKTeco K40) prep
-- Run AFTER 08-overtime.sql. Safe to re-run.
--
-- Adds:
--   1. app_settings (single key/value table) — holds attendance_mode
--   2. biometric_devices (Boss-managed registry)
--   3. profiles.employee_code (links device user IDs to profiles)
--   4. biometric_logs (raw punches from the device, plus derived link)
--   5. Triggers that, when attendance_mode = 'biometric', derive rows
--      into public.attendance automatically so payroll & views keep working.
--
-- Manual mode bypasses the triggers entirely — manual attendance is
-- ALWAYS available as a fallback.
-- ============================================================

-- 1. app_settings -------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

drop policy if exists "app_settings_read_all"   on public.app_settings;
drop policy if exists "app_settings_boss_write" on public.app_settings;

create policy "app_settings_read_all"
  on public.app_settings
  for select
  using (auth.uid() is not null);

create policy "app_settings_boss_write"
  on public.app_settings
  for all
  using (public.is_boss())
  with check (public.is_boss());

-- Seed default: manual mode (preserves existing behavior)
insert into public.app_settings (key, value)
values ('attendance_mode', '"manual"'::jsonb)
on conflict (key) do nothing;

-- 2. biometric_devices --------------------------------------
create table if not exists public.biometric_devices (
  id             uuid primary key default gen_random_uuid(),
  serial_number  text not null unique,
  location       text not null,
  active         boolean not null default true,
  last_sync_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.biometric_devices enable row level security;

drop trigger if exists biometric_devices_touch_updated_at on public.biometric_devices;
create trigger biometric_devices_touch_updated_at
  before update on public.biometric_devices
  for each row execute function public.touch_updated_at();

drop policy if exists "devices_read_all"   on public.biometric_devices;
drop policy if exists "devices_boss_write" on public.biometric_devices;

create policy "devices_read_all"
  on public.biometric_devices
  for select
  using (auth.uid() is not null);

create policy "devices_boss_write"
  on public.biometric_devices
  for all
  using (public.is_boss())
  with check (public.is_boss());

-- 3. profiles.employee_code ---------------------------------
-- Used to map the device's internal user ID (e.g. "1001") to a profile.
alter table public.profiles
  add column if not exists employee_code text;

create unique index if not exists profiles_employee_code_uidx
  on public.profiles(employee_code)
  where employee_code is not null;

-- 4. biometric_logs -----------------------------------------
do $$ begin
  create type public.punch_type as enum ('in', 'out');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.bio_sync_status as enum ('pending', 'matched', 'unmatched', 'applied');
exception when duplicate_object then null;
end $$;

create table if not exists public.biometric_logs (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid references public.biometric_devices(id) on delete set null,
  device_serial  text not null,                                -- denormalised; survives device delete
  employee_code  text not null,                                -- as reported by the device
  worker_id      uuid references public.profiles(id) on delete set null,
  punch_type     public.punch_type not null default 'in',
  punched_at     timestamptz not null,
  sync_status    public.bio_sync_status not null default 'pending',
  raw_payload    jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists biometric_logs_punched_at_idx
  on public.biometric_logs(punched_at desc);
create index if not exists biometric_logs_worker_punch_idx
  on public.biometric_logs(worker_id, punched_at desc);
create index if not exists biometric_logs_device_punch_idx
  on public.biometric_logs(device_id, punched_at desc);

alter table public.biometric_logs enable row level security;

-- SELECT: boss = all; worker = own; supervisor = their assigned workers
drop policy if exists "biometric_logs_select" on public.biometric_logs;
create policy "biometric_logs_select"
  on public.biometric_logs
  for select
  using (
    public.is_boss()
    or worker_id = auth.uid()
    or (worker_id is not null and public.is_my_worker(worker_id))
  );

-- INSERT/UPDATE: handled exclusively by the Edge Function using the
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. No end-user write policy.

-- 5. Trigger: resolve worker_id from employee_code on insert -
create or replace function public.resolve_biometric_worker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.worker_id is null and new.employee_code is not null then
    select id into new.worker_id
      from public.profiles
     where employee_code = new.employee_code
     limit 1;
  end if;

  if new.worker_id is null then
    new.sync_status := 'unmatched';
  elsif new.sync_status = 'pending' then
    new.sync_status := 'matched';
  end if;

  return new;
end;
$$;

drop trigger if exists biometric_logs_resolve on public.biometric_logs;
create trigger biometric_logs_resolve
  before insert on public.biometric_logs
  for each row execute function public.resolve_biometric_worker();

-- 6. Trigger: derive attendance rows in biometric mode ------
create or replace function public.apply_biometric_to_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode  text;
  v_date  date;
  v_super uuid;
begin
  if new.worker_id is null then
    return new;
  end if;

  -- attendance_mode is stored as a JSON string scalar e.g. '"biometric"'
  select value #>> '{}' into v_mode
    from public.app_settings
   where key = 'attendance_mode';

  if v_mode is null or v_mode <> 'biometric' then
    return new;
  end if;

  v_date := (new.punched_at at time zone 'Asia/Kolkata')::date;

  -- Need a supervisor for attendance.supervisor_id (NOT NULL FK)
  select supervisor_id into v_super
    from public.profiles
   where id = new.worker_id;

  if v_super is null then
    return new;  -- boss can fix manually
  end if;

  -- Any IN punch on a date = present. Idempotent on multiple punches.
  -- Don't downgrade a supervisor's explicit half_day / absent.
  insert into public.attendance (worker_id, supervisor_id, attendance_date, status)
  values (new.worker_id, v_super, v_date, 'present')
  on conflict (worker_id, attendance_date) do update
    set status = case
      when public.attendance.status in ('half_day','absent') then public.attendance.status
      else 'present'::public.attendance_status
    end;

  update public.biometric_logs
     set sync_status = 'applied'
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists biometric_logs_apply on public.biometric_logs;
create trigger biometric_logs_apply
  after insert on public.biometric_logs
  for each row execute function public.apply_biometric_to_attendance();
