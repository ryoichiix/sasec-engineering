// ============================================================
// Sasec Engineering — Biometric push endpoint (ZKTeco K40)
//
// Implements the ZKTeco ADMS / Push SDK protocol that the K40
// uses to stream attendance records to a remote server.
//
// Deploy with:
//   supabase functions deploy biometric-push --no-verify-jwt
//
// In the K40 menu > Comm > ADMS, set:
//   Enable Domain Name : Yes
//   Server Address     : <your project>.supabase.co
//   Server Port        : 443
//   Enable Proxy       : No
//   HTTPS              : Yes
//   URL Path           : /functions/v1/biometric-push
//
// The device will then append /iclock/<endpoint> to that URL.
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

// Service role bypasses RLS — needed to insert biometric_logs and
// update biometric_devices.last_sync_at on the device's behalf.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/**
 * The K40's clock is local. Convert "YYYY-MM-DD HH:MM:SS" (assumed IST)
 * to a UTC ISO string for storage in punched_at (timestamptz).
 */
function parseDeviceTimestamp(s: string): string | null {
  // Examples seen: "2026-05-28 09:14:33"
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  // Treat as IST (UTC+5:30) — JSW Hyderabad
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}+05:30`
  const dt = new Date(iso)
  return isNaN(dt.getTime()) ? null : dt.toISOString()
}

/**
 * Map the device's "status" / "verify" fields to our punch_type enum.
 * ZKTeco status codes (vendor docs):
 *   0 = check-in, 1 = check-out, 2 = break-out, 3 = break-in,
 *   4 = overtime-in, 5 = overtime-out
 * We collapse to in/out.
 */
function mapPunchType(statusStr: string | undefined): "in" | "out" {
  const n = parseInt(statusStr ?? "0", 10)
  if (n === 1 || n === 5) return "out"
  return "in"
}

/**
 * Touch the device's last_sync_at. Best-effort; failure isn't fatal —
 * the device must always get a 2xx response or it will retry forever.
 */
async function touchDevice(serial: string): Promise<string | null> {
  const { data, error } = await admin
    .from("biometric_devices")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("serial_number", serial)
    .select("id")
    .maybeSingle()
  if (error) {
    console.error("touchDevice error", error)
    return null
  }
  return data?.id ?? null
}

/**
 * Parse an ATTLOG body. Each line is tab-separated:
 *   userid \t timestamp \t status \t verify \t workcode \t reserved \t reserved
 */
function parseAttlogBody(body: string) {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const records: Array<{
    employee_code: string
    punched_at: string
    punch_type: "in" | "out"
    raw: string[]
  }> = []
  for (const line of lines) {
    const cols = line.split("\t")
    if (cols.length < 2) continue
    const punched_at = parseDeviceTimestamp(cols[1])
    if (!punched_at) continue
    records.push({
      employee_code: cols[0],
      punched_at,
      punch_type: mapPunchType(cols[2]),
      raw: cols,
    })
  }
  return records
}

// Most ADMS responses are plain text; OK is the canonical "got it" reply.
const okText = (body = "OK") =>
  new Response(body, { status: 200, headers: { "content-type": "text/plain" } })

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Supabase routes everything under /functions/v1/biometric-push/* to us;
  // url.pathname will already be the device-side path (e.g. /iclock/cdata).
  // We accept both with and without a leading "/biometric-push" prefix
  // in case the device is configured differently.
  const path = url.pathname.replace(/^\/biometric-push/, "")

  const serial =
    url.searchParams.get("SN") ??
    url.searchParams.get("sn") ??
    ""

  if (!serial) {
    return new Response("Missing SN", { status: 400 })
  }

  // ---------------------------------------------------------
  // GET /iclock/cdata — initial handshake
  // The device asks for its config. We return a minimal config
  // string the firmware accepts. (Full config push not needed.)
  // ---------------------------------------------------------
  if (req.method === "GET" && path === "/iclock/cdata") {
    await touchDevice(serial)
    const stamp = Math.floor(Date.now() / 1000)
    const config = [
      `GET OPTION FROM: ${serial}`,
      `ATTLOGStamp=${stamp}`,
      `OPERLOGStamp=${stamp}`,
      `ATTPHOTOStamp=${stamp}`,
      `ErrorDelay=30`,
      `Delay=10`,
      `TransTimes=00:00;14:05`,
      `TransInterval=1`,
      `TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic`,
      `TimeZone=8`,
      `Realtime=1`,
      `Encrypt=None`,
    ].join("\n")
    return okText(config)
  }

  // ---------------------------------------------------------
  // POST /iclock/cdata?table=ATTLOG — attendance push
  // ---------------------------------------------------------
  if (req.method === "POST" && path === "/iclock/cdata") {
    const table = url.searchParams.get("table") ?? ""
    const deviceId = await touchDevice(serial)
    const body = await req.text()

    if (table.toUpperCase() === "ATTLOG") {
      const records = parseAttlogBody(body)
      if (records.length > 0) {
        const rows = records.map((r) => ({
          device_id: deviceId,
          device_serial: serial,
          employee_code: r.employee_code,
          punch_type: r.punch_type,
          punched_at: r.punched_at,
          raw_payload: { cols: r.raw, table },
        }))

        const { error } = await admin.from("biometric_logs").insert(rows)
        if (error) {
          console.error("biometric_logs insert error", error)
          // Still ACK the device — we'll re-ingest from the raw body later.
        }
      }
    }
    // Other tables (OPERLOG, ATTPHOTO, USERINFO, FP) are accepted but
    // not yet processed. The device requires a 200 OK either way.

    return okText(`OK: ${body.split(/\r?\n/).filter(Boolean).length}`)
  }

  // ---------------------------------------------------------
  // GET /iclock/getrequest — device polls for pending commands
  // No queued commands yet; reply OK so the device idles.
  // ---------------------------------------------------------
  if (req.method === "GET" && path === "/iclock/getrequest") {
    await touchDevice(serial)
    return okText("OK")
  }

  // ---------------------------------------------------------
  // POST /iclock/devicecmd — device acks a command. Ignored.
  // ---------------------------------------------------------
  if (req.method === "POST" && path === "/iclock/devicecmd") {
    return okText("OK")
  }

  // ---------------------------------------------------------
  // Fallback — log unknowns so future protocol additions surface.
  // ---------------------------------------------------------
  console.warn("Unhandled biometric-push request", req.method, path,
    Object.fromEntries(url.searchParams.entries()))
  return okText("OK")
})
