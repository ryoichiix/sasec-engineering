-- ============================================================
-- Sasec Engineering — Step 55: Schedule the 10:00 AM IST
-- missed-attendance reminder Edge Function via pg_cron.
--
-- Requires:
--   1. The `missed-attendance-reminder` Edge Function deployed
--      (supabase/functions/missed-attendance-reminder/index.ts).
--   2. Two secrets stored in Supabase Vault (Dashboard → Project
--      Settings → Vault), keyed by name:
--        - project_url        (e.g. https://xxxxx.supabase.co)
--        - service_role_key   (the service_role JWT)
--      The cron body reads them from `vault.decrypted_secrets`
--      each time it fires, so rotating the secret is picked up
--      automatically — no re-schedule needed.
--
-- 10:00 AM IST = 04:30 UTC. Cron expression: "30 4 * * *".
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Extensions ───────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. Un-schedule any prior version, then re-schedule ──────
do $$
declare
  v_job_id int;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'missed_attendance_reminder_10am_ist';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end $$;

select cron.schedule(
  'missed_attendance_reminder_10am_ist',
  '30 4 * * *',              -- 04:30 UTC = 10:00 IST daily
  $cron$
    select net.http_post(
      url     := (select decrypted_secret
                    from vault.decrypted_secrets
                   where name = 'project_url'
                   limit 1)
                 || '/functions/v1/missed-attendance-reminder',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret
                                         from vault.decrypted_secrets
                                        where name = 'service_role_key'
                                        limit 1)
      ),
      body    := jsonb_build_object('source', 'pg_cron')
    );
  $cron$
);
