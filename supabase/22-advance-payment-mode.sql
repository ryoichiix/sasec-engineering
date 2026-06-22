-- ============================================================
-- Step 22: Payment mode on weekly_advances + remove any legacy
-- one-time advance UI references at the data level.
-- Safe to re-run.
-- ============================================================

alter table public.weekly_advances
  add column if not exists payment_mode text not null default 'cash'
  check (payment_mode in ('cash', 'bank_transfer'));

create index if not exists weekly_advances_mode_week
  on public.weekly_advances (payment_mode, week_start);
