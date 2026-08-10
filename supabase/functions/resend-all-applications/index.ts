import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getBearerToken(authHeader: string | null): string {
  if (!authHeader) return ''
  const [type, token] = authHeader.split(' ')
  if (type?.toLowerCase() !== 'bearer' || !token) return ''
  return token.trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const token = getBearerToken(req.headers.get('Authorization'))

    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: userData, error: userError } = await adminClient.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()

    if (profileError || profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: applications, error: applicationsError } = await adminClient
      .from('applications')
      .select('*')
      .order('created_at', { ascending: true })

    if (applicationsError) {
      throw new Error(`Could not load applications: ${applicationsError.message}`)
    }

    const apps = applications || []
    let sentCount = 0
    const failures: Array<{ application_id: string | null; error: string }> = []

    for (const app of apps) {
      const notifyRes = await fetch(`${supabaseUrl}/functions/v1/notify-application`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(app),
      })

      if (!notifyRes.ok) {
        const body = await notifyRes.text()
        failures.push({
          application_id: app?.id ?? null,
          error: `notify-application failed (${notifyRes.status}): ${body}`,
        })
        continue
      }

      sentCount += 1
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_applications: apps.length,
        sent_count: sentCount,
        failed_count: failures.length,
        failures,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
