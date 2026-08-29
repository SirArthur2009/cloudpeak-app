import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()

    if (!normalizedEmail) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: waitlistRows, error: waitlistFetchError } = await supabase
      .from('waitlist')
      .select('selected_puppy_id')
      .ilike('email', normalizedEmail)

    if (waitlistFetchError) throw waitlistFetchError

    const selectedPuppyIds = (waitlistRows || [])
      .map(row => row.selected_puppy_id)
      .filter(Boolean)

    if (selectedPuppyIds.length) {
      const { error: puppyUpdateError } = await supabase
        .from('puppies')
        .update({ status: 'available' })
        .in('id', selectedPuppyIds)
      if (puppyUpdateError) throw puppyUpdateError
    }

    const { error: applicationsDeleteError } = await supabase
      .from('applications')
      .delete()
      .ilike('email', normalizedEmail)
    if (applicationsDeleteError) throw applicationsDeleteError

    const { error: waitlistDeleteError } = await supabase
      .from('waitlist')
      .delete()
      .ilike('email', normalizedEmail)
    if (waitlistDeleteError) throw waitlistDeleteError

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (usersError) throw usersError
    const user = usersData.users.find(user => user.email?.toLowerCase() === normalizedEmail)

    if (user) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user.id)
      if (authDeleteError) throw authDeleteError
    }

    return new Response(JSON.stringify({ ok: true, released_puppies: selectedPuppyIds.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})