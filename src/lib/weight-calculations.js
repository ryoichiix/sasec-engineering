import { supabase } from './supabase'
import { grandTotalKg } from './weight'

// ============================================================
// Drawing-sheet weight calculations — Supabase data layer.
// Items live as JSONB; uploaded sheets live in the private
// 'drawing-sheets' storage bucket (accessed via signed URLs).
// ============================================================

const SELECT_COLS =
  'id, supervisor_id, project_name, drawing_ref, image_path, items, total_weight_kg, status, submitted_at, created_at, updated_at'

/** Upload a drawing image; returns { path } or { error }. */
export async function uploadDrawingImage(file, supervisorId) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const path = `${supervisorId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage
    .from('drawing-sheets')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) return { error }
  return { path }
}

/** Short-lived signed URL for viewing a stored drawing. */
export async function getDrawingUrl(path) {
  if (!path) return { url: null, error: null }
  const { data, error } = await supabase.storage
    .from('drawing-sheets')
    .createSignedUrl(path, 60 * 60)
  return { url: data?.signedUrl ?? null, error }
}

/**
 * Insert (no id) or update (with id) a calculation.
 * total_weight_kg is always recomputed from items server-side of truth here.
 */
export async function saveCalculation({
  id,
  supervisorId,
  projectName,
  drawingRef,
  imagePath,
  items,
  status, // 'draft' | 'submitted'
}) {
  const row = {
    supervisor_id:   supervisorId,
    project_name:    projectName?.trim() || null,
    drawing_ref:     drawingRef?.trim() || null,
    image_path:      imagePath || null,
    items:           items || [],
    total_weight_kg: grandTotalKg(items),
    status,
  }
  if (status === 'submitted') row.submitted_at = new Date().toISOString()

  if (id) {
    return supabase
      .from('weight_calculations')
      .update(row)
      .eq('id', id)
      .select(SELECT_COLS)
      .single()
  }
  return supabase
    .from('weight_calculations')
    .insert(row)
    .select(SELECT_COLS)
    .single()
}

/** A supervisor's own calculations, newest first. */
export function fetchMyCalculations(supervisorId) {
  return supabase
    .from('weight_calculations')
    .select(SELECT_COLS)
    .eq('supervisor_id', supervisorId)
    .order('updated_at', { ascending: false })
}

/** A single calculation by id. */
export function fetchCalculation(id) {
  return supabase
    .from('weight_calculations')
    .select(SELECT_COLS)
    .eq('id', id)
    .single()
}

/** Delete a draft (RLS only allows the owner to delete drafts). */
export function deleteCalculation(id) {
  return supabase.from('weight_calculations').delete().eq('id', id)
}

/**
 * Boss view: every submitted calculation, optionally filtered by
 * supervisor / submitted-date range / project name. Joins supervisor
 * display names.
 */
export async function fetchSubmittedCalculations({ supervisorId, startDate, endDate, project } = {}) {
  let query = supabase
    .from('weight_calculations')
    .select(SELECT_COLS)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })

  if (supervisorId) query = query.eq('supervisor_id', supervisorId)
  if (startDate)    query = query.gte('submitted_at', `${startDate}T00:00:00`)
  if (endDate)      query = query.lte('submitted_at', `${endDate}T23:59:59.999`)
  if (project)      query = query.ilike('project_name', `%${project}%`)

  const { data: rows, error } = await query
  if (error) return { error, data: null }

  const supIds = Array.from(new Set((rows || []).map((r) => r.supervisor_id).filter(Boolean)))
  let nameById = {}
  if (supIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', supIds)
    for (const p of profs || []) nameById[p.id] = p.full_name
  }

  return {
    error: null,
    data: (rows || []).map((r) => ({
      ...r,
      supervisor_name: nameById[r.supervisor_id] || 'Supervisor',
    })),
  }
}

/** Distinct supervisors who have submitted at least one calculation (for the Boss filter). */
export async function fetchSubmittingSupervisors() {
  const { data, error } = await supabase
    .from('weight_calculations')
    .select('supervisor_id')
    .eq('status', 'submitted')
  if (error) return { data: [], error }

  const ids = Array.from(new Set((data || []).map((r) => r.supervisor_id).filter(Boolean)))
  if (!ids.length) return { data: [], error: null }

  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', ids)
    .order('full_name')
  return { data: profs || [], error: pErr }
}
