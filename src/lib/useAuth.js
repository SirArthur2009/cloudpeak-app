import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  async function fetchRole(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()
    setRole(data?.role || 'client')
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchRole(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchRole(session.user.id)
      else { setRole(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (role !== null) setLoading(false)
  }, [role])

  return { session, role, loading }
}