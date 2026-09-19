import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
    const { data: auth, error } = await db.auth.getUser(token)
    if (error || !auth.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
    const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).single()
    if (profile?.role !== 'admin') return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers })
    const { data: profiles, error: profileError } = await db.from('profiles').select('id, role')
    if (profileError) throw profileError
    const roles = new Map((profiles || []).map(p => [p.id, p.role]))
    const users = []
    for (let page = 1; ; page++) {
      const { data, error: listError } = await db.auth.admin.listUsers({ page, perPage: 1000 })
      if (listError) throw listError
      for (const user of data.users) if (user.email) users.push({ id: user.id, email: user.email.toLowerCase(), role: roles.get(user.id) || 'client', name: user.user_metadata?.name || '', phone: user.user_metadata?.phone || '' })
      if (data.users.length < 1000) break
    }
    return new Response(JSON.stringify({ users }), { headers })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers })
  }
})
