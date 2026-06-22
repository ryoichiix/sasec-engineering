-- ============================================================
-- Sasec Engineering — Step 11: Designation wage_type + seed data
-- Run AFTER 06-designations.sql. Safe to re-run.
--
-- Changes:
--   1. Add wage_type column ('daily_rate' | 'monthly_fixed')
--   2. Seed the 26 standard SASEC designations (on conflict = no-op)
-- ============================================================

-- 1. Add wage_type column to designations ----------------------
alter table public.designations
  add column if not exists wage_type text
    not null default 'daily_rate'
    check (wage_type in ('daily_rate', 'monthly_fixed'));

-- 2. Seed standard designations --------------------------------
-- Salaried (monthly_fixed) roles: Director, Supervisor, HOD,
-- Safety Officer, Accounts — the rest are daily-rate field workers.
-- All wages default to 0 so the boss can fill them in.
-- ON CONFLICT DO NOTHING means existing rows are never overwritten.
insert into public.designations (name, wage_type, daily_wage) values
  ('Director',             'monthly_fixed', 0),
  ('Supervisor',           'monthly_fixed', 0),
  ('Head of Department',   'monthly_fixed', 0),
  ('Safety Officer',       'monthly_fixed', 0),
  ('Accounts',             'monthly_fixed', 0),
  ('Fabricator',           'daily_rate',    0),
  ('Driver',               'daily_rate',    0),
  ('Saw Operator',         'daily_rate',    0),
  ('Electrician',          'daily_rate',    0),
  ('Mechanic',             'daily_rate',    0),
  ('Foreman',              'daily_rate',    0),
  ('Skilled Worker',       'daily_rate',    0),
  ('Multi-skilled Fitter', 'daily_rate',    0),
  ('Helper Operator',      'daily_rate',    0),
  ('Helper',               'daily_rate',    0),
  ('Fitter',               'daily_rate',    0),
  ('Gang Contractor',      'daily_rate',    0),
  ('Grinder',              'daily_rate',    0),
  ('Mason/Welder',         'daily_rate',    0),
  ('Painter',              'daily_rate',    0),
  ('Rigger',               'daily_rate',    0),
  ('Tack Welder',          'daily_rate',    0),
  ('Welder',               'daily_rate',    0),
  ('Watchman',             'daily_rate',    0),
  ('Cook',                 'daily_rate',    0),
  ('Khalasi',              'daily_rate',    0)
on conflict (name) do nothing;
