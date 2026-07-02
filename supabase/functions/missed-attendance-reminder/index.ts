// ============================================================
// Sasec Engineering — Edge Function
// missed-attendance-reminder
//
// Runs daily at 10:00 IST (scheduled via pg_cron in migration 55).
// For each supervisor whose team of workers has NOT been fully marked
// in the `attendance` table for today, sends notifications to:
//   1. The supervisor themselves (reminder)
//   2. Every Site Incharge (field_manager = true) (escalation)
//   3. Every Director (role = 'boss') (escalation)
//
// Uses the notify_user RPC — never a direct notifications insert.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// IST = UTC + 5:30. Format as 'YYYY-MM-DD' for the IST calendar day.
function todayIST(): string {
  const now = new Date()
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const today = todayIST()
  const prettyDate = new Date(today + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  // 1. All supervisors (both regular + field_manager count as supervisors here).
  const { data: supervisors, error: supErr } = await supabase
    .from('profiles')
    .select('id, full_name, field_manager')
    .eq('role', 'supervisor')

  if (supErr) {
    return new Response(JSON.stringify({ ok: false, error: supErr.message }), { status: 500 })
  }

  // 2. All workers grouped by supervisor.
  const { data: workers, error: wErr } = await supabase
    .from('workers')
    .select('id, supervisor_id')

  if (wErr) {
    return new Response(JSON.stringify({ ok: false, error: wErr.message }), { status: 500 })
  }

  const workersBySup = new Map<string, string[]>()
  for (const w of workers ?? []) {
    if (!w.supervisor_id) continue
    if (!workersBySup.has(w.supervisor_id)) workersBySup.set(w.supervisor_id, [])
    workersBySup.get(w.supervisor_id)!.push(w.id)
  }

  // 3. Today's attendance rows to compute "marked" set per supervisor.
  const { data: att, error: attErr } = await supabase
    .from('attendance')
    .select('worker_table_id, worker_id')
    .eq('attendance_date', today)

  if (attErr) {
    return new Response(JSON.stringify({ ok: false, error: attErr.message }), { status: 500 })
  }

  const marked = new Set<string>()
  for (const r of att ?? []) marked.add(r.worker_table_id ?? r.worker_id)

  // 4. Find supervisors who have NOT fully marked their team.
  const missing = (supervisors ?? []).filter((s) => {
    const team = workersBySup.get(s.id) ?? []
    if (team.length === 0) return false            // no team → nothing to mark
    return team.some((wid) => !marked.has(wid))    // at least one unmarked
  })

  if (missing.length === 0) {
    return new Response(JSON.stringify({ ok: true, date: today, missing: 0 }))
  }

  // 5. Look up escalation recipients.
  const siteIncharges = (supervisors ?? []).filter((s) => s.field_manager === true)
  const { data: bosses } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'boss')

  const notify = async (userId: string, title: string, message: string) => {
    const { error } = await supabase.rpc('notify_user', {
      p_user_id:        userId,
      p_title:          title,
      p_message:        message,
      p_type:           'attendance_missed',
      p_reference_id:   null,
      p_reference_type: 'attendance',
    })
    if (error) console.error('notify_user failed', userId, error.message)
  }

  // 6. Fire notifications for each missing supervisor.
  for (const sup of missing) {
    const supName = sup.full_name || 'A supervisor'

    // Self reminder
    await notify(
      sup.id,
      '⏰ Attendance reminder',
      `You haven't marked attendance for your team yet today (${prettyDate}). Please complete it as soon as possible.`,
    )

    // Site Incharge escalation
    for (const fm of siteIncharges) {
      if (fm.id === sup.id) continue
      await notify(
        fm.id,
        '⚠️ Attendance not marked',
        `${supName} has not marked their team's attendance for ${prettyDate}.`,
      )
    }

    // Director escalation
    for (const b of bosses ?? []) {
      await notify(
        b.id,
        '⚠️ Attendance not marked',
        `${supName} has not marked their team's attendance for ${prettyDate}.`,
      )
    }
  }

  return new Response(JSON.stringify({
    ok:      true,
    date:    today,
    missing: missing.length,
  }))
})
