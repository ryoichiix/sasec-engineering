import { ROLES } from './supabase'

export function roleHome(role) {
  switch (role) {
    case ROLES.BOSS:
      return '/boss'
    case ROLES.SUPERVISOR:
      return '/supervisor'
    case ROLES.WORKER:
      // Workers don't log in to the app — RootRedirect intercepts before
      // this is ever used. Returning '/login' keeps any stray callers safe.
      return '/login'
    default:
      return '/login'
  }
}

export function isAppRole(role) {
  return role === ROLES.BOSS || role === ROLES.SUPERVISOR
}
