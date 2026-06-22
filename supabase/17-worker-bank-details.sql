-- ============================================================
-- Sasec Engineering — Step 17: Worker PF ID + bank details
-- Run AFTER 12-worker-individual-wage.sql. Safe to re-run.
--
-- Adds the columns the "Import Workers" bulk-upload feature needs
-- to store on each worker profile:
--   • pf_id                — Provident Fund identifier (from Excel)
--   • bank_name            — payout bank
--   • bank_account_number  — payout account (also seeds the default
--                            password: SASEC + last 4 digits)
--   • ifsc_code            — bank branch IFSC
-- ============================================================

-- 1. Add columns ---------------------------------------------
alter table public.profiles
  add column if not exists pf_id               text,
  add column if not exists bank_name           text,
  add column if not exists bank_account_number text,
  add column if not exists ifsc_code           text;

-- 2. Index for duplicate detection ----------------------------
-- The importer skips a worker when the same (full_name, pf_id)
-- pair already exists, so index pf_id to keep that lookup fast.
create index if not exists profiles_pf_id_idx
  on public.profiles(pf_id);
