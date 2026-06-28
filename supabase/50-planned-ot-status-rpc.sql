-- 50-planned-ot-status-rpc.sql
-- SECURITY DEFINER RPC to decide PLANNED OT (work_plans.morning_plan.ot_status).
--
-- Background: Fix B's approval chain has the Site Incharge and the Director flip
-- the ot_status on a SUPERVISOR'S work_plans row — a row they don't own. The
-- work_plans RLS (migration 04) only lets a supervisor write their OWN row, so
-- approvers cannot update it directly from the client. This RPC performs the
-- change server-side (like the notify_* RPCs), authorizing the caller and
-- MERGING only ot_status so the rest of the supervisor's plan JSON is preserved.
--
-- morning_plan is a TEXT column holding a JSON string, so we cast to jsonb,
-- merge with `||` (overrides just the ot_status key), and cast back to text.
--
-- This creates a function only — it does NOT alter any table schema. Idempotent.

create or replace function public.set_planned_ot_status(p_plan_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_fm   boolean;
  v_is_boss boolean;
begin
  -- Only a Site Incharge (field manager) or the Director may decide planned OT.
  select coalesce(field_manager, false), (role = 'boss')
    into v_is_fm, v_is_boss
    from public.profiles
   where id = auth.uid();

  if not coalesce(v_is_fm, false) and not coalesce(v_is_boss, false) then
    raise exception 'Not authorized to decide planned OT';
  end if;

  if p_status not in ('pending_field_manager', 'pending_boss', 'approved', 'rejected', 'none') then
    raise exception 'Invalid planned-OT status: %', p_status;
  end if;

  -- Merge ONLY ot_status into the existing plan JSON; leave every other field intact.
  update public.work_plans
     set morning_plan = (coalesce(morning_plan, '{}')::jsonb
                          || jsonb_build_object('ot_status', p_status))::text
   where id = p_plan_id;
end;
$$;

grant execute on function public.set_planned_ot_status(uuid, text) to authenticated;
