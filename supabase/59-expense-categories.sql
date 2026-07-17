-- ============================================================
-- Sasec Engineering — Step 59: Widen expense category constraint
-- Safe to re-run (idempotent).
--
-- Migration 31 created public.expenses with an inline CHECK that only
-- allowed 6 categories:
--   'Petrol','Diesel','Food','Materials','Travel','Other'
--
-- The app (src/lib/expenses.js → EXPENSE_CATEGORIES) later added five
-- more categories:
--   'Hydraulic Oil','Vehicle Repairs','Machinery Repairs',
--   'Tools & Equipment','Site Expenses'
-- but the DB constraint was never updated, so any INSERT with one of
-- those newer categories fails the CHECK (this is the "errors on
-- Hydraulic / Machinery Repairs / Tools & Equipment / Site Expenses"
-- bug). This migration widens the constraint to the full current set.
--
-- Existing rows all carry the original 6 categories, so replacing the
-- CHECK with a superset cannot fail on live data.
-- ============================================================

-- Drop the old (auto-named) inline CHECK, then re-add the widened one.
alter table public.expenses
  drop constraint if exists expenses_category_check;

alter table public.expenses
  add constraint expenses_category_check
  check (category in (
    'Petrol',
    'Diesel',
    'Hydraulic Oil',
    'Vehicle Repairs',
    'Machinery Repairs',
    'Tools & Equipment',
    'Site Expenses',
    'Food',
    'Materials',
    'Travel',
    'Other'
  ));
