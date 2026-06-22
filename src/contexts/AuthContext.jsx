import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)

  // Bootstrap session + subscribe to Supabase auth changes
  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session ?? null)
      setSessionReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setSessionReady(true)
      if (!newSession) {
        setProfile(null)
        setProfileError(null)
      }
    })

    return () => {
      isMounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Fetch the profile row whenever the signed-in user changes.
  // Clearing on sign-out is handled by the auth-change subscription and signOut().
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId) return

    let isMounted = true
    supabase
      .from('profiles')
      .select('*')   // fetch all columns so field_manager, email, etc. are available
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (!isMounted) return
        if (error) {
          console.error('Failed to load profile:', error)
          setProfileError(error)
          setProfile(null)
        } else {
          setProfileError(null)
          setProfile(data)
        }
      })

    return () => {
      isMounted = false
    }
  }, [userId])

  // signIn/signUp/signOut update session state directly from the response so
  // callers can navigate immediately without racing onAuthStateChange.
  const signIn = useCallback(async ({ email, password }) => {
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.data?.session) {
      setSession(result.data.session)
      setSessionReady(true)
    }
    return result
  }, [])

  const signUp = useCallback(async ({ email, password, fullName, role }) => {
    const result = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    })
    if (result.data?.session) {
      setSession(result.data.session)
      setSessionReady(true)
    }
    return result
  }, [])

  const signOut = useCallback(async () => {
    const result = await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setProfileError(null)
    return result
  }, [])

  const value = useMemo(() => {
    const user = session?.user ?? null
    const loading =
      !sessionReady || (!!user && !profile && !profileError)
    return {
      session,
      user,
      profile,
      role: profile?.role ?? null,
      loading,
      profileError,
      signIn,
      signUp,
      signOut,
    }
  }, [session, sessionReady, profile, profileError, signIn, signUp, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
