-- ============================================================
-- Sasec Engineering — Step 43: "On Duty" attendance status
--
-- attendance.status is the enum public.attendance_status
-- ('present', 'absent', 'half_day'). Add a new 'on_duty' value.
--
-- On Duty is treated as a paid full working day in payroll
-- (see computePayroll in src/lib/payroll.js).
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block with other statements that use the new value, so run this
-- on its own. Safe to re-run (IF NOT EXISTS).
-- ============================================================

alter type public.attendance_status add value if not exists 'on_duty';
