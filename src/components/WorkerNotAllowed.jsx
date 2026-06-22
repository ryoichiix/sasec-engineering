import { useAuth } from '../contexts/auth-context'

export default function WorkerNotAllowed() {
  const { user, signOut } = useAuth()
  return (
    <div className="min-h-screen flex items-center justify-center bg-site-bg px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <img
          src="/logo.png"
          alt="SASEC"
          className="h-14 w-14 object-contain mx-auto mb-4 opacity-80"
        />
        <h1 className="text-lg font-semibold text-slate-900 mb-2">
          Worker accounts cannot sign in
        </h1>
        <p className="text-sm text-slate-600 mb-1">
          You're signed in as{' '}
          <span className="font-medium">{user?.email}</span>, registered as a
          worker.
        </p>
        <p className="text-sm text-slate-600 mb-6">
          This app is for Director and Supervisor accounts only. Your attendance
          and payroll are still tracked by your supervisor — please ask them
          for any details you need.
        </p>
        <button
          onClick={signOut}
          className="bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm px-4 py-2 rounded-md transition"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
