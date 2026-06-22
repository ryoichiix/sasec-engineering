import { useAuth } from '../contexts/auth-context'

export default function NoProfile() {
  const { user, profileError, signOut } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-site-bg px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-md p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          Account is missing a profile
        </h1>
        <p className="text-sm text-slate-600 mb-4">
          You're signed in as <span className="font-medium">{user?.email}</span>, but
          no row exists in <code>profiles</code> for this account.
        </p>
        <p className="text-sm text-slate-600 mb-6">
          This usually means the Supabase setup SQL hasn't been run yet, or this user
          was created before the signup trigger was installed. Run{' '}
          <code>supabase/setup.sql</code> in the Supabase SQL editor, then sign out
          and sign up again.
        </p>
        {profileError?.message && (
          <p className="text-xs text-red-600 mb-4">
            Supabase error: {profileError.message}
          </p>
        )}
        <button
          onClick={signOut}
          className="bg-brand hover:bg-brand-hover text-white font-medium px-4 py-2 rounded-lg transition"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
