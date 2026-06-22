import { supabase } from './supabase'

/**
 * Notify ALL supervisors and boss (called client-side by workers on submit).
 * Uses the SECURITY DEFINER RPC so a worker can insert notifications for other users.
 */
export async function notifySupervisorsAndBoss({
  title,
  message,
  type = 'info',
  referenceId = null,
  referenceType = null,
}) {
  return supabase.rpc('notify_supervisors_and_boss', {
    p_title:          title,
    p_message:        message,
    p_type:           type,
    p_reference_id:   referenceId,
    p_reference_type: referenceType,
  })
}

/**
 * Notify every OTHER supervisor (all supervisors except the caller).
 * Used when a supervisor submits a leave request.
 */
export async function notifyOtherSupervisors({
  title,
  message,
  type = 'info',
  referenceId = null,
  referenceType = null,
}) {
  return supabase.rpc('notify_other_supervisors', {
    p_title:          title,
    p_message:        message,
    p_type:           type,
    p_reference_id:   referenceId,
    p_reference_type: referenceType,
  })
}

/**
 * Notify ALL supervisors (used when boss decides, so every supervisor
 * sees the updated status).
 */
export async function notifyAllSupervisors({
  title,
  message,
  type = 'info',
  referenceId = null,
  referenceType = null,
}) {
  return supabase.rpc('notify_all_supervisors', {
    p_title:          title,
    p_message:        message,
    p_type:           type,
    p_reference_id:   referenceId,
    p_reference_type: referenceType,
  })
}

/**
 * Notify all Field Managers (supervisors with is_field_manager=true).
 * Used when a supervisor submits a leave request.
 */
export async function notifyFieldManagers({
  title,
  message,
  type = 'info',
  referenceId = null,
  referenceType = null,
}) {
  return supabase.rpc('notify_field_managers', {
    p_title:          title,
    p_message:        message,
    p_type:           type,
    p_reference_id:   referenceId,
    p_reference_type: referenceType,
  })
}

/**
 * Notify every boss (called client-side by a supervisor on leave submit).
 */
export async function notifyBoss({
  title,
  message,
  type = 'info',
  referenceId = null,
  referenceType = null,
}) {
  return supabase.rpc('notify_boss', {
    p_title:          title,
    p_message:        message,
    p_type:           type,
    p_reference_id:   referenceId,
    p_reference_type: referenceType,
  })
}

/**
 * Notify a single user (called client-side by boss when deciding).
 */
export async function notifyUser({
  userId,
  title,
  message,
  type = 'info',
  referenceId = null,
  referenceType = null,
}) {
  return supabase.rpc('notify_user', {
    p_user_id:        userId,
    p_title:          title,
    p_message:        message,
    p_type:           type,
    p_reference_id:   referenceId,
    p_reference_type: referenceType,
  })
}

/** Fetch the current user's recent notifications (latest 30). */
export async function fetchNotifications(userId) {
  return supabase
    .from('notifications')
    .select('id, type, title, message, is_read, reference_id, reference_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)
}

/** Fetch ALL of the current user's notifications, most recent first. */
export async function fetchAllNotifications(userId) {
  return supabase
    .from('notifications')
    .select('id, type, title, message, is_read, reference_id, reference_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
}

/** Mark a single notification as read. */
export async function markNotificationRead(id) {
  return supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
}

/** Mark all of the current user's notifications as read. */
export async function markAllRead(userId) {
  return supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
}
