import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * An isolated Supabase client used only for the bulk worker import.
 *
 * Why a separate client? `supabase.auth.signUp()` signs the newly created
 * user *into* the client it runs on, which would silently log the Boss out
 * (and break the rest of the import, which relies on the Boss session for
 * RLS). This client is configured with `persistSession: false` so every
 * signUp lives purely in memory and never touches the Boss's stored session.
 *
 * A fresh instance is created per import run so its in-memory session starts
 * clean and can be discarded afterwards.
 */
export function createImportAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      // Distinct key so it can never collide with the main client's storage.
      storageKey: 'sasec-import-auth',
    },
  })
}

export const ROLES = {
  BOSS: 'boss',
  SUPERVISOR: 'supervisor',
  WORKER: 'worker',
}
