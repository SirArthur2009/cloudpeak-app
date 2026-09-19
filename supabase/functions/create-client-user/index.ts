import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, password, name, phone, role, must_change_password } = await req.json()

    if (!email) {
      return new Response(JSON.stringify({ error: 'email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: caller, error: callerError } = await supabase.auth.getUser(token)
    if (callerError || !caller.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', caller.user.id).single()
    if (callerProfile?.role !== 'admin') return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const normalizedEmail = String(email).trim().toLowerCase()
    let userId: string | undefined
    let created = false

    const shouldMustChange = typeof must_change_password === 'boolean'
      ? must_change_password
      : Boolean(password)

    // Check if user already exists in auth
    const { data: listedUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listError) {
      return new Response(JSON.stringify({ error: listError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const existing = (listedUsers?.users || []).find((u) => (u.email || '').toLowerCase() === normalizedEmail)

    if (existing?.id) {
      userId = existing.id
      const updatePayload: Record<string, any> = {
        email_confirm: true,
      }
      if (password) {
        updatePayload.password = password
      }
      if (name || phone || existing.user_metadata) {
        updatePayload.user_metadata = {
          ...existing.user_metadata,
          ...(name ? { name } : {}),
          ...(phone ? { phone } : {})
        }
      }
      if (typeof must_change_password === 'boolean' || password) {
        updatePayload.app_metadata = {
          ...existing.app_metadata,
          must_change_password: shouldMustChange
        }
      }

      const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(existing.id, updatePayload)
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      userId = updatedUser?.user?.id || existing.id
      created = false
    } else {
      if (!password) {
        return new Response(JSON.stringify({ error: 'Password is required to create a new user account.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data, error } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: name || phone ? { name, phone } : undefined,
        app_metadata: {
          must_change_password: shouldMustChange
        }
      })

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      userId = data?.user?.id
      created = true
    }

    if (userId) {
      const assignedRole = role === 'admin' ? 'admin' : 'client'
      const { error: roleError } = await supabase.from('profiles').upsert({ id: userId, role: assignedRole })
      if (roleError) throw roleError
    }

    return new Response(JSON.stringify({ ok: true, userId, created }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
