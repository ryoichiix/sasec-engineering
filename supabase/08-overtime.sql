-- ============================================================
-- Sasec Engineering — Step 8: Overtime (OT) tracking
-- Run AFTER 07-daily-assignments.sql. Safe to re-run.
--
-- Adds ot_hours to attendance so supervisors can record how
-- many overtime hours each present worker put in.  Payroll is
-- computed in the frontend:
--   hourly_rate  = daily_wage / 8
--   ot_pay       = ot_hours × 2 × hourly_rate
-- ============================================================

-- 1. Add ot_hours column to attendance ----------------------
alter table public.attendance
  add column if not exists ot_hours numeric(4,1) not null default 0
  check (ot_hours >= 0 and ot_hours <= 24);

-- 2. Guard: attendance_supervisor_upd already lets supervisors
--    update their own workers' rows — no new policy needed.
--    The constraint above ensures data integrity.
