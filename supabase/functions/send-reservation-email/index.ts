import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { clientName, puppyName } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    const adminIds = (admins || []).map(a => a.id)
    const { data: users } = await supabase.auth.admin.listUsers()
    const adminEmails = (users?.users || []).filter(u => adminIds.includes(u.id)).map(u => u.email)

    await Promise.all(adminEmails.map(email =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
          to: email,
          subject: `Reservation Request: ${clientName} wants ${puppyName}`,
          html: `<h2>New Reservation Request</h2><p><strong>${clientName}</strong> has selected <strong>${puppyName}</strong>.</p><p>Log in to your admin dashboard to approve.</p>`
        })
      })
    ))

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})