-- ============================================================
-- Step 42: Drawing Sheet Weight Calculator
--
-- A supervisor uploads a fabrication / structural drawing sheet,
-- Claude vision extracts the bill of materials, and the app
-- computes steel weights. Calculations are saved as draft or
-- submitted to the Boss (who gets an in-app notification).
--
-- Items are stored as JSONB — one array of line-item objects.
-- Each item: { sr_no, description, material_type, length_mm,
--   width_mm, thickness_mm, outer_diameter_mm, inner_diameter_mm,
--   diameter_mm, side_a_mm, side_b_mm, unit_weight, quantity,
--   remarks }
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────
create table if not exists public.weight_calculations (
  id              uuid primary key default gen_random_uuid(),
  supervisor_id   uuid not null references public.profiles(id) on delete cascade,
  project_name    text,
  drawing_ref     text,
  image_path      text,                      -- path in the 'drawing-sheets' bucket
  items           jsonb not null default '[]'::jsonb,
  total_weight_kg numeric not null default 0,
  status          text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists weight_calc_supervisor_idx
  on public.weight_calculations (supervisor_id, updated_at desc);
create index if not exists weight_calc_submitted_idx
  on public.weight_calculations (status, submitted_at desc);

-- ── 2. updated_at touch trigger ──────────────────────────────
create or replace function public.weight_calc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_weight_calc_touch on public.weight_calculations;
create trigger trg_weight_calc_touch
  before update on public.weight_calculations
  for each row execute function public.weight_calc_touch_updated_at();

-- ── 3. RLS ───────────────────────────────────────────────────
alter table public.weight_calculations enable row level security;

-- Supervisor: full control over their own rows
drop policy if exists "weight_calc_own_select" on public.weight_calculations;
create policy "weight_calc_own_select" on public.weight_calculations
  for select using (supervisor_id = auth.uid());

drop policy if exists "weight_calc_own_insert" on public.weight_calculations;
create policy "weight_calc_own_insert" on public.weight_calculations
  for insert with check (supervisor_id = auth.uid());

drop policy if exists "weight_calc_own_update" on public.weight_calculations;
create policy "weight_calc_own_update" on public.weight_calculations
  for update using (supervisor_id = auth.uid())
  with check (supervisor_id = auth.uid());

drop policy if exists "weight_calc_own_delete" on public.weight_calculations;
create policy "weight_calc_own_delete" on public.weight_calculations
  for delete using (supervisor_id = auth.uid() and status = 'draft');

-- Boss: read every submitted calculation
drop policy if exists "weight_calc_boss_select" on public.weight_calculations;
create policy "weight_calc_boss_select" on public.weight_calculations
  for select using (public.is_boss() and status = 'submitted');

-- ── 4. Notify every Boss when a calculation is submitted ─────
create or replace function public.notify_weight_submitted()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_sup_name text;
  v_boss     record;
begin
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then

    select full_name into v_sup_name
      from public.profiles where id = new.supervisor_id;

    for v_boss in select id from public.profiles where role = 'boss' loop
      insert into public.notifications
        (user_id, type, title, message, reference_id, reference_type)
      values (
        v_boss.id,
        'weight_calc',
        'New weight calculation submitted',
        coalesce(v_sup_name, 'A supervisor')
          || ' submitted a weight calculation for '
          || coalesce(nullif(new.project_name, ''), 'a project')
          || ' (Drawing ' || coalesce(nullif(new.drawing_ref, ''), '—') || ') — '
          || trim(to_char(round(new.total_weight_kg, 2), 'FM999999990.00')) || ' kg.',
        new.id,
        'weight_calculation'
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_weight_submitted on public.weight_calculations;
create trigger trg_notify_weight_submitted
  after insert or update on public.weight_calculations
  for each row execute function public.notify_weight_submitted();

-- ============================================================
-- 5. Storage bucket for uploaded drawing sheets
--    (drop-if-exists guards added so this block is re-runnable)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('drawing-sheets', 'drawing-sheets', false, 20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "supervisors_upload_drawings" ON storage.objects;
CREATE POLICY "supervisors_upload_drawings"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'drawing-sheets' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "drawings_read" ON storage.objects;
CREATE POLICY "drawings_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'drawing-sheets' AND auth.uid() IS NOT NULL);
