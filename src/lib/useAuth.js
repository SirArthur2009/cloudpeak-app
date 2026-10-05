import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mustChangePassword, setMustChangePassword] = useState(false)

  useEffect(() => {
    let mounted = true
    const timeout = setTimeout(() => { if (mounted) setLoading(false) }, 20000)
    function applySession(next) {
      if (!mounted) return
      clearTimeout(timeout)
      setSession(next)
      setMustChangePassword(Boolean(next?.user?.app_metadata?.must_change_password))
      if (!next) { setRole(null); setLoading(false) }
    }
    supabase.auth.getSession().then(({ data }) => applySession(data.session)).catch(() => applySession(null))
    // Keep this callback synchronous. Database requests run in the separate
    // React effect below, after the Supabase Auth lock has been released.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      // Defer React effects as well as database calls until Auth notification completes.
      setTimeout(() => applySession(next), 0)
    })
    return () => { mounted = false; clearTimeout(timeout); subscription.unsubscribe() }
  }, [])

  const userId = session?.user?.id
  const accessToken = session?.access_token
  useEffect(() => {
    if (!userId) return
    let disposed = false
    const base = import.meta.env.VITE_DATA_API_URL || import.meta.env.VITE_SUPABASE_URL
    // The session already supplies a token; do not reacquire the Auth lock to
    // fetch the Railway role while an Auth session event is being handled.
    fetch(`${base.replace(/\/$/, '')}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    }).then(async response => {
      if (!response.ok) throw new Error('Account access could not be loaded.')
      return response.json()
    }).then(rows => { if (!disposed) { setRole(rows[0]?.role || 'client'); setLoading(false) } })
      .catch(() => { if (!disposed) { setRole('client'); setLoading(false) } })
    return () => { disposed = true }
  }, [userId, accessToken])

  return { session, role, loading, mustChangePassword }
}
