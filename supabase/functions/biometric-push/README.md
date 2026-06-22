# biometric-push — ZKTeco K40 ADMS endpoint

Receives push data from a ZKTeco K40 fingerprint device and writes it to
`public.biometric_logs`. When `app_settings.attendance_mode = 'biometric'`,
a trigger on that table derives rows into `public.attendance` so payroll
and all other modules keep working unchanged.

## One-time setup (when you get the K40)

### 1. Deploy the function

```bash
supabase functions deploy biometric-push --no-verify-jwt
```

The `--no-verify-jwt` flag is required: ZKTeco devices don't send
Supabase JWTs. Auth is enforced instead by **device serial-number
allowlisting** — only logs from serials registered in
`public.biometric_devices` ever resolve to a real device row.

### 2. Configure the K40

In the device menu navigate to **Comm → ADMS** and set:

| Field                | Value                                |
| -------------------- | ------------------------------------ |
| Enable Domain Name   | Yes                                  |
| Server Address       | `<your-project>.supabase.co`         |
| Server Port          | `443`                                |
| Enable Proxy         | No                                   |
| HTTPS               | Yes                                  |
| URL Path             | `/functions/v1/biometric-push`       |

Reboot the device. Within ~30 seconds the green "ADMS" icon should
appear and `last_sync_at` for that serial in
`public.biometric_devices` will start updating.

### 3. Register the device in the app

Go to **Boss → Devices** in the app and add a row with the K40's
serial number (printed on a sticker on the back) and a location
e.g. `"Main Gate"`. The serial **must match exactly** — the device's
log lines are ignored if the serial isn't registered.

### 4. Map workers to device user IDs

In the K40 each fingerprint is associated with a numeric "User ID"
(e.g. `1001`). In our DB, set `profiles.employee_code = '1001'` for
the matching worker. Until this mapping exists, that worker's punches
land in `biometric_logs` with `sync_status = 'unmatched'`.

You can do this from the Boss → Workers page (or via a SQL update).

## Protocol notes

The K40 ADMS protocol is plain HTTP. It uses these endpoints:

| Method | Path                                | Purpose                              |
| ------ | ----------------------------------- | ------------------------------------ |
| GET    | `/iclock/cdata?SN=…`                | Handshake / config fetch             |
| POST   | `/iclock/cdata?SN=…&table=ATTLOG`   | **Push attendance records (TSV)**    |
| GET    | `/iclock/getrequest?SN=…`           | Device polls for commands            |
| POST   | `/iclock/devicecmd?SN=…`            | Device acks a command                |

ATTLOG records are tab-separated:

```
userid<TAB>YYYY-MM-DD HH:MM:SS<TAB>status<TAB>verify<TAB>workcode<TAB>…
```

`status`: `0/2/3/4` ⇒ `in`, `1/5` ⇒ `out`.

## Troubleshooting

- **No `last_sync_at` updates** — the device isn't reaching the server.
  Verify it has internet access and that HTTPS is enabled in the ADMS
  menu. Some older K40 firmwares require HTTP-only; in that case
  deploy a small relay (Node/Express) on a VPS and have it forward
  to this endpoint.

- **Punches arrive but no attendance appears** — check
  `app_settings.attendance_mode` is `"biometric"`, and that the
  worker has a `profiles.supervisor_id` set (the `attendance.supervisor_id`
  column is NOT NULL).

- **Punches arrive as `sync_status = 'unmatched'`** — set
  `profiles.employee_code` for the worker to match the K40 user ID.
