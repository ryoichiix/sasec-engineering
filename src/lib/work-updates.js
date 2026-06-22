import { supabase } from './supabase'

const BUCKET = 'work-attachments'
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

// ── Daily updates ──────────────────────────────────────────

export function fetchUpdatesForDate(supervisorId, date) {
  return supabase
    .from('work_updates')
    .select('id, content, created_at')
    .eq('supervisor_id', supervisorId)
    .eq('update_date', date)
    .order('created_at', { ascending: true })
}

export function insertUpdate(supervisorId, date, content) {
  // content is '' for voice-only updates (requires migration 21-voice-messages.sql
  // which drops the non-empty CHECK constraint on this column)
  return supabase
    .from('work_updates')
    .insert({ supervisor_id: supervisorId, update_date: date, content: content ?? '' })
    .select('id, content, created_at')
    .single()
}

export function deleteUpdate(id) {
  return supabase.from('work_updates').delete().eq('id', id)
}

// ── Evening reports ────────────────────────────────────────

export function fetchEveningReport(supervisorId, date) {
  return supabase
    .from('evening_reports')
    .select('id, completed, pending, pending_reason, plan_tomorrow, created_at, updated_at')
    .eq('supervisor_id', supervisorId)
    .eq('report_date', date)
    .maybeSingle()
}

export function upsertEveningReport(supervisorId, date, fields) {
  return supabase
    .from('evening_reports')
    .upsert(
      { supervisor_id: supervisorId, report_date: date, ...fields },
      { onConflict: 'supervisor_id,report_date' }
    )
    .select('id, completed, pending, pending_reason, plan_tomorrow, created_at, updated_at')
    .single()
}

// ── Attachments — metadata ─────────────────────────────────

export function fetchAttachmentsByUpdateIds(updateIds) {
  if (!updateIds.length) return Promise.resolve({ data: [], error: null })
  return supabase
    .from('work_attachments')
    .select('id, update_id, report_id, storage_path, file_name, file_size, mime_type')
    .in('update_id', updateIds)
    .order('created_at', { ascending: true })
}

export function fetchAttachmentsByReportId(reportId) {
  return supabase
    .from('work_attachments')
    .select('id, update_id, report_id, storage_path, file_name, file_size, mime_type')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
}

export function fetchAttachmentsByLeaveRequestId(leaveRequestId) {
  return supabase
    .from('work_attachments')
    .select('id, leave_request_id, storage_path, file_name, file_size, mime_type')
    .eq('leave_request_id', leaveRequestId)
    .order('created_at', { ascending: true })
}

// ── Attachments — storage ──────────────────────────────────

/**
 * Validate a file before upload. Returns an error string or null.
 */
export function validateFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} exceeds the 10 MB limit.`
  }
  return null
}

/**
 * Upload a file to storage and insert a work_attachments row.
 * Exactly one of updateId / reportId / leaveRequestId must be provided.
 * Returns { data: attachment_row, error }.
 */
export async function uploadAttachment({
  supervisorId,
  date,
  file,
  updateId = null,
  reportId = null,
  leaveRequestId = null,
}) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${supervisorId}/${date}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })

  if (uploadError) return { data: null, error: uploadError }

  const parentType = updateId
    ? 'update'
    : reportId
      ? 'evening_report'
      : 'leave_request'

  return supabase
    .from('work_attachments')
    .insert({
      supervisor_id:    supervisorId,
      parent_type:      parentType,
      update_id:        updateId        ?? null,
      report_id:        reportId        ?? null,
      leave_request_id: leaveRequestId  ?? null,
      storage_path:     path,
      file_name:        file.name,
      file_size:        file.size,
      mime_type:        file.type,
    })
    .select('id, update_id, report_id, leave_request_id, storage_path, file_name, file_size, mime_type')
    .single()
}

/**
 * Get a 1-hour signed URL for any stored file.
 */
export function getSignedUrl(storagePath) {
  return supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600)
}

// ── Boss feed queries ──────────────────────────────────────

export function fetchAllUpdatesRange(daysBack = 30) {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  return supabase
    .from('work_updates')
    .select('id, supervisor_id, update_date, content, created_at')
    .gte('update_date', since.toISOString().slice(0, 10))
    .order('update_date', { ascending: false })
    .order('created_at', { ascending: true })
}

export function fetchAllEveningReportsRange(daysBack = 30) {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  return supabase
    .from('evening_reports')
    .select('id, supervisor_id, report_date, completed, pending, pending_reason, plan_tomorrow, created_at, updated_at')
    .gte('report_date', since.toISOString().slice(0, 10))
    .order('report_date', { ascending: false })
}
