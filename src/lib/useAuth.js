import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mustChangePassword, setMustChangePassword] = useState(false)

  async function fetchRole(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()
    setRole(data?.role || 'client')
  }

  function refreshPasswordRequirement(sessionData) {
    const metadata = sessionData?.user?.user_metadata || {}
    const shouldChange = Boolean(metadata.must_change_password)
    setMustChangePassword(shouldChange)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchRole(session.user.id)
        refreshPasswordRequirement(session)
      } else {
        setMustChangePassword(false)
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        fetchRole(session.user.id)
        refreshPasswordRequirement(session)
      } else {
        setRole(null)
        setMustChangePassword(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (role !== null) setLoading(false)
  }, [role])

  return { session, role, loading, mustChangePassword }
}