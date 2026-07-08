# SASEC Engineering EMS

Production workforce-management app for SASEC Engineering (fabrication / structural steel).
**Live data: real attendance, payroll, and advances for ~88 workers.** Treat every DB change as production surgery.

Users: field supervisors on budget Android phones (mobile-first, always), Site Incharges (senior supervisors), and one Director — the repo owner, Rishi. Workers never log in.

## Stack and commands

- React 19 + Vite, Tailwind CSS v4 (`@tailwindcss/vite`), React Router v7, Supabase JS v2 (auth + Postgres + RLS). Deployed on Vercel.
- Dev server: `npm run dev -- --host`. When asked to "run the server" / "give me the link", run it with `--host` in the background and report BOTH the Local and the Network URL (Rishi tests on his phone).
- `npm run build` and `npm run lint` must both pass cleanly before any work is called done. Actually run them — never assume.
- There is no test suite. Verification = build + lint + walking the manual flow per role.

## Role & data model (most past bugs came from getting this wrong)

| Person | Table | Notes |
|---|---|---|
| Worker (~88) | `public.workers` | NO auth account, NO profiles row. Never insert notifications targeting a worker id. |
| Supervisor / Director | `public.profiles` | `role` = 'supervisor' or 'boss'. Exactly ONE boss row exists (the Director). |
| Site Incharge | `public.profiles` | supervisor with `field_manager = true`. |

- The live Site Incharge flag is **`profiles.field_manager`**. The `is_field_manager` column and the `public.is_field_manager()` SQL helper found in older migrations are LEGACY — never use them in new SQL; check `field_manager` directly (`exists (select 1 from profiles p where p.id = auth.uid() and p.field_manager = true)`).
- **Dual-role staff are intentional.** Some people have BOTH a supervisor row in `profiles` AND a separate worker row in `public.workers` (different id, same `full_name`) carrying real attendance/payroll history. Never delete, hide, or "de-duplicate" these worker rows — it breaks payroll. Detection helpers: `fetchStaffIdentity()` / `isDualRoleWorker()` in `src/lib/workers.js` (match by normalized name, not id). Only a Site Incharge may mark attendance or raise advances for dual-role staff.

## Hard-won gotchas — each one cost a multi-session debugging saga; do not relearn them

1. **`work_plans.morning_plan` is a TEXT column holding a JSON string, not jsonb.** You cannot use `->>`/`->` or JSON filters in SQL/RLS on it — parse and filter in JS. Some legacy rows are plain text, so a blanket `::jsonb` cast throws. To mutate one key server-side, use an RPC doing `(morning_plan::jsonb || jsonb_build_object(...))::text` (see migration 50).
2. **There are TWO unrelated OT systems.** Worker OT = `attendance.ot_status` (real DB checks/triggers, feeds payroll; helpers in `src/lib/ot.js`). Planned OT = an `ot_status` key inside the `morning_plan` JSON (`src/lib/plan-ot.js`; does NOT touch payroll). Same status names, entirely separate approval chains. Never conflate them. Payroll reads `attendance`, never `work_plans`.
3. **Supervisors cannot read `role='boss'` profiles client-side** — RLS deliberately excludes boss rows, and the blocked query silently returns 0 rows (no error), so notifications "send to nobody". To notify the Director from a supervisor/Site Incharge session, ALWAYS use the SECURITY DEFINER RPCs in `src/lib/notifications.js` (`notifyBoss()` / `notifySupervisorsAndBoss()`), never a client query + `notifyUser` loop.
4. **The advances status column is `advance_status`, NOT `status`** (table `weekly_advances`).
5. **Times display in IST:** `new Date(x).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })`.
6. **Do not add client-side notifies where a DB trigger already fires** — e.g. `notify_work_plan_posted()` (migration 44) notifies Director + Site Incharge on first work-plan save; a client-side notify on top double-notifies.
7. **Hosted Supabase has no superuser.** `ALTER DATABASE ... SET` fails with "permission denied". Secrets for cron/functions go in Supabase Vault (migration 55 pattern).
8. **Mobile WebKit quirks:** tappable rows must be real `<button>` elements (divs drop click events on iOS), and bottom sheets must render via `createPortal` to escape ancestor CSS stacking contexts (a picker once rendered off-screen for days because of this).

## Database migration workflow (manual — no Supabase CLI)

Migrations are numbered files in `supabase/` (currently up to `58-fuel-type.sql`, plus `setup.sql`). Rishi runs SQL by hand in the Supabase dashboard SQL Editor. Follow exactly:

1. Check `supabase/` for the highest number; the new file is `NN-short-kebab-name.sql`.
2. Write the migration file AND print the full SQL in chat.
3. **STOP. Do not write dependent app code yet.** Ask Rishi to run it.
4. Continue only after he confirms ("ran it", "done", "sql done proceed").
5. Offer a small copy-pasteable verification SELECT so he can prove the migration took effect.

Destructive SQL (DELETE / DROP / data rewrites): first print a read-only evidence query (row counts, history checks) and wait for its results; then propose the destructive statement wrapped in `begin; ... commit;`; wait for a separate explicit go-ahead.

## Working rules

- **Read the actual files before changing anything.** Incoming specs are often drafted against an imagined codebase (tables/components that don't exist here). Map spec → reality first; when they disagree, say so and follow reality.
- **Honor scope guards literally.** "Design only" = zero logic/data/dependency changes. "Do NOT touch X" = X appears in no diff hunk. Verify with `git diff` before reporting.
- **RLS thinking:** for every query, ask "which role executes this, and what can that role actually read?" A silently empty result is an RLS problem until proven otherwise.
- Commit style: bundled per session, imperative summary (e.g. `Session 3: per-fuel-type balance tracking, correct debiting on allocation`). Commit/push only when asked.

## Design system

Premium-minimal ("Linear / Vercel / Notion — not a student project"), mobile-first:

- Ink navy `#0F172A` (headings, dark surfaces) · brand red `#C0272D` (accents, count badges, active states) · borders `#E2E8F0` · white cards with `rounded-xl` and subtle shadows · muted grey secondary text.
- Compact buttons — never oversized. Tab switchers as `bg-gray-100 p-1 rounded-xl` pill groups.
- Every list needs a loading state AND an explicit empty state (blank areas have repeatedly been mistaken for bugs — e.g. "No present workers for {date} — mark attendance first").

## File map

- Pages: `src/pages/` — `Boss*.jsx` = Director portal; `src/pages/supervisor/` = current supervisor pages (`TodaysPlan.jsx` team-picking + work-plan, `DailyUpdates.jsx`, `Approvals.jsx`, `SiteInchargeWorkFeed.jsx`). `SupervisorTeam.jsx` and `SupervisorWorkPlan.jsx` in `src/pages/` are legacy — their routes redirect; don't build on them.
- Data access lives in `src/lib/*.js`, one module per domain (`attendance.js`, `advances.js`, `work-plans.js`, `batches.js`, `collaborations.js`, `notifications.js`, `payroll.js`, `fuel.js`, `assignments.js`, ...). Pages call libs; put new Supabase calls in libs, not in components.
- Navigation is data-driven from THREE places — adding/moving a page means touching all of them: `src/lib/nav.js` (sidebar), `src/components/BottomNav.jsx` (mobile tabs), `src/lib/notification-meta.jsx` (notification → route mapping).
- SQL: `supabase/` numbered migrations + `setup.sql` + `supabase/functions/`.
