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
    const { email, password, name, phone, role } = await req.json()

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

    const normalizedEmail = String(email).trim().toLowerCase()
    let userId: string | undefined
    let created = false

    if (password) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: name || phone ? { name, phone } : undefined,
        app_metadata: {
          must_change_password: true
        }
      })

      userId = data?.user?.id
      created = true

      if (error) {
        const message = (error.message || '').toLowerCase()
        const mayExist = message.includes('already') || message.includes('registered') || message.includes('exists')

        if (!mayExist) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { data: listedUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
        if (listError) {
          return new Response(JSON.stringify({ error: listError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const existing = (listedUsers?.users || []).find((u) => (u.email || '').toLowerCase() === normalizedEmail)
        if (!existing?.id) {
          return new Response(JSON.stringify({ error: 'User exists but could not be resolved by email.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          user_metadata: name || phone ? { ...existing.user_metadata, name: name || existing.user_metadata?.name, phone: phone || existing.user_metadata?.phone } : undefined,
          app_metadata: {
            must_change_password: true
          }
        })

        if (updateError) {
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        userId = updatedUser?.user?.id || existing.id
        created = false
      }
    } else {
      // Find existing user by email
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
      }
    }

    if (userId) {
      const assignedRole = role === 'admin' ? 'admin' : 'client'
      await supabase.from('profiles').upsert({ id: userId, role: assignedRole })
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