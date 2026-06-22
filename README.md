# Sasec Engineering

React + Vite + Tailwind v4 app with Supabase authentication and three role-based dashboards (Boss, Supervisor, Worker).

## Stack

- React 19 + Vite
- Tailwind CSS v4 (`@tailwindcss/vite` plugin)
- React Router v7
- Supabase JS v2 (auth + Postgres)

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

1. Go to <https://supabase.com> and create a new project.
2. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
3. Copy `.env.example` to `.env.local` and paste them in:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### 3. Apply the database schema

Open the Supabase **SQL Editor** and run, in order:

1. [`supabase/setup.sql`](supabase/setup.sql) — auth + profiles
   - `user_role` enum (`boss`, `supervisor`, `worker`)
   - `profiles` table linked to `auth.users`
   - RLS policies (users see their own profile; bosses see everyone)
   - signup trigger that creates a profile row with the role chosen at signup
   - role-self-escalation guard
2. [`supabase/02-attendance.sql`](supabase/02-attendance.sql) — attendance module
   - `profiles.supervisor_id` column
   - `attendance_status` enum (`present`, `absent`, `half_day`)
   - `attendance` table (unique per worker/date) with supervisor-scoped RLS
   - `notifications` table with user-scoped RLS
   - trigger that inserts an `attendance_absent` notification whenever a worker's status becomes Absent
3. [`supabase/03-leave.sql`](supabase/03-leave.sql) — leave workflow
   - `leave_status` enum (`pending_supervisor`, `pending_boss`, `approved`, `rejected`)
   - `leave_decision` enum (`approved`, `rejected`)
   - `leave_requests` table with start/end dates, reason, and per-stage decision fields
   - BEFORE INSERT trigger that snapshots the supervisor from the worker's profile
   - BEFORE UPDATE trigger that enforces the state machine
   - AFTER trigger that fires notifications at every stage transition
4. [`supabase/04-work-plans.sql`](supabase/04-work-plans.sql) — daily work plans
   - `work_plans` table (unique per `supervisor_id` + `plan_date`) with `morning_plan` / `evening_update` text fields and `_posted_at` timestamps
   - BEFORE trigger that stamps `posted_at` on the null → not-null transition
   - AFTER trigger that notifies every boss once per posted field (no spam on edits)
5. [`supabase/05-payroll.sql`](supabase/05-payroll.sql) — payroll *(superseded by step 6 — keep applying it in order so the trigger lineage stays consistent)*
   - `profiles.daily_rate` numeric column (replaced by designations in step 6)
6. [`supabase/06-designations.sql`](supabase/06-designations.sql) — designations
   - `designations` table (`name` unique, `daily_wage` numeric)
   - `profiles.designation_id` FK with `ON DELETE RESTRICT` (deleting a designation that has workers assigned fails by design)
   - Extends `prevent_role_self_escalation` to also block non-boss users from changing their own `designation_id`
   - **Drops `profiles.daily_rate`** — designation is now the sole source of truth for wages
7. [`supabase/07-daily-assignments.sql`](supabase/07-daily-assignments.sql) — daily supervisor-worker assignments
   - `daily_assignments` table (`unique(worker_id, assignment_date)`)
   - Sits **on top of** the permanent `profiles.supervisor_id` (which still owns attendance + leave routing)
   - RLS: any signed-in user can read (so supervisors see conflict badges); supervisors INSERT/UPDATE only with themselves as `supervisor_id`; current owner or boss can DELETE

All files are idempotent — safe to re-run, but always run in numbered order so the latest state wins.

### 4. (Recommended) Disable email confirmations for local dev

In **Authentication → Providers → Email**, turn off "Confirm email" so new signups can log in immediately. Re-enable it before going to production.

### 5. Run

```bash
npm run dev
```

Open <http://localhost:5173>.

## Auth flow

- `/signup` — pick a role (Worker / Supervisor / Boss) at signup. Role is written to `user_metadata` and copied into `profiles` by a trigger.
- `/login` — email + password.
- `/` — redirects to the correct dashboard for the user's role.
- `/boss`, `/supervisor`, `/worker` — each guarded by `ProtectedRoute`. Wrong-role users are redirected to their own dashboard.

## Attendance flow

1. **Boss** opens `/boss/workers` and assigns each worker to a supervisor.
2. **Supervisor** opens `/supervisor/attendance`, picks a date (default today), and clicks Present / Half Day / Absent for each of their workers. Autosaves on click.
3. **Worker** opens their dashboard and sees a Notifications card listing days they were marked absent (unread dots clear on view).
4. **Boss** opens `/boss/attendance` to see a single-day overview grouped by supervisor.

## Leave flow

1. **Worker** opens `/worker/leave`, picks a start and end date, writes a reason, and submits. Status starts as `pending_supervisor`.
2. **Supervisor** gets a notification, opens `/supervisor/leave`, sees the pending queue, and clicks Approve or Reject (with an optional note).
   - Reject → status becomes `rejected`. Worker is notified.
   - Approve → status becomes `pending_boss`. Worker and every boss are notified.
3. **Boss** gets a notification, opens `/boss/leave`, sees the pending-boss queue (with the supervisor's note inline), and clicks Approve or Reject.
   - Status becomes `approved` or `rejected`. Worker and supervisor are notified.
4. **Worker** sees status + notes on `/worker/leave` and the Notifications card on their dashboard.

## Work plans flow

1. **Supervisor** opens `/supervisor/work-plan`, picks a date (default today), types into "Morning plan" and clicks Save. A "Posted at 7:42 AM" timestamp appears.
2. **Bosses** get a notification ("Aisha Khan posted the morning plan for May 28, 2026.").
3. Later that day the supervisor returns, types into "Evening update", and clicks Save. Bosses get a second notification.
4. **Boss** opens `/boss/work-feed` and sees a feed of the last 30 days, grouped by date (newest first). Each date shows every supervisor who posted, with their morning and evening text and post times side by side.
5. Editing already-posted text re-saves silently — no spam notifications.

## Daily team assignment

1. Workers' attendance is marked for the day (by their **permanent** supervisor on `/supervisor/attendance`, unchanged).
2. **Supervisor** opens `/supervisor/team` — they see every worker marked Present today (across all permanent crews), with a designation filter dropdown.
3. They tick the workers they want for their crew today. Each click immediately writes a `daily_assignments` row.
4. If a worker is already on another supervisor's team, the row shows an amber **"On Aisha's team"** badge. Ticking them moves them onto the picker's team (last-write-wins via UPSERT).
5. The supervisor's **/supervisor/work-plan** page shows the picked team as pills above the morning/evening panels.
6. **Boss** opens `/boss/assignments` to see every supervisor's daily team for any date, plus an "Unassigned (present but not on any team)" section.

## Payroll flow

1. **Boss** opens `/boss/designations`, adds job roles (Welder, Pipe Fitter, JCB Operator, …) and sets each role's daily wage.
2. **Boss** opens `/boss/workers` and assigns each worker a designation from the dropdown (and a supervisor).
3. **Boss** opens `/boss/payroll` and toggles **Weekly** (Mon → Sun) or **Monthly** (calendar month). The period navigator chevrons step backward/forward; the default is the period containing today.
4. The table computes, per worker:
   - **Days paid** = `present + 0.5 × half-day` (from `attendance`)
   - **Gross** = `days_paid × designation.daily_wage`
   - **PF** = 12 % of gross, **ESI** = 0.75 % of gross
   - **PT** = ₹200 in monthly view, ₹50/week in weekly view (apportioned). Skipped when gross is 0.
   - **Net** = gross − PF − ESI − PT
5. A totals footer sums every numeric column.
6. Workers see the same breakdown for themselves at `/worker/payroll`.
7. Payroll itself is **not stored** — it's computed live from `attendance × designation.daily_wage`. Adjusting attendance, a designation's wage, or a worker's designation immediately reflects in the table. (Changing a wage retroactively changes historical totals; add snapshotting if you need locked pay periods later.)

## Project layout

```
src/
  components/
    DashboardShell.jsx       Shared header for dashboards
    DashboardNav.jsx         Nav-card grid used inside dashboards
    NotificationsCard.jsx    User-scoped notifications card (all dashboards)
    NoProfile.jsx            Error screen if profiles row is missing
    ProtectedRoute.jsx       Auth + role guard
    StatusPill.jsx           Attendance Present/Half/Absent pill
    LeaveStatusPill.jsx      Leave status pill
    LeaveQueue.jsx           Shared approval queue (supervisor + boss)
    WorkPlanPanel.jsx        Single editable field (morning OR evening)
    PeriodNavigator.jsx      Weekly/Monthly toggle + prev/next chevrons
  contexts/
    AuthContext.jsx          Auth provider (session + profile)
    auth-context.js          Context + useAuth hook
  lib/
    supabase.js              Supabase client + ROLES constant
    roles.js                 role → home route mapping
    attendance.js            STATUS enum + pill styling
    leave.js                 LEAVE_STATUS enum + pill styling
    work-plans.js            fetch/upsert helpers for work_plans
    assignments.js           daily team picker helpers
    payroll.js               config, period helpers, computePayroll, INR formatter
    dates.js                 todayLocal() / formatDate() / formatTime()
    notifications.js         fetchNotifications / markAllRead
  pages/
    Login.jsx
    Signup.jsx
    BossDashboard.jsx
    BossAttendance.jsx
    BossWorkers.jsx
    SupervisorDashboard.jsx
    SupervisorAttendance.jsx
    SupervisorLeave.jsx
    SupervisorWorkPlan.jsx
    WorkerDashboard.jsx
    WorkerLeave.jsx
    BossLeave.jsx
    BossWorkFeed.jsx
    BossPayroll.jsx
    BossDesignations.jsx
    BossAssignments.jsx
    SupervisorTeam.jsx
    WorkerPayroll.jsx
  App.jsx                    Router
  main.jsx
supabase/
  setup.sql                  Step 1: auth + profiles
  02-attendance.sql          Step 2: attendance + notifications
  03-leave.sql               Step 3: leave workflow
  04-work-plans.sql          Step 4: daily morning + evening updates
  05-payroll.sql             Step 5: daily_rate column + self-edit guard (superseded by 06)
  06-designations.sql        Step 6: designations table; drops daily_rate
  07-daily-assignments.sql   Step 7: daily supervisor-worker assignments
```

## Scripts

- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the build
- `npm run lint` — ESLint
