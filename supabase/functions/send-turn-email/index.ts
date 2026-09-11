import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { clientName, clientEmail, portalUrl } = await req.json()

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
        to: clientEmail,
        subject: `It's your turn to pick your puppy!`,
        html: `<h2>Hi ${clientName}!</h2><p>It's your turn to choose your puppy from Cloud Peak Silver Labradors.</p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a1a;color:#fff;border-radius:6px;text-decoration:none;">Choose My Puppy</a>`
      })
    })

    const data = await res.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (res.ok && supabaseUrl && serviceRoleKey) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey)
      const { error: insertError } = await adminClient.from('emails').insert({
        direction: 'outbound',
        resend_id: data?.id ?? null,
        from_email: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
        to_email: clientEmail,
        subject: `It's your turn to pick your puppy!`,
        text_body: null,
        html_body: null,
        is_read: true
      })
      if (insertError) console.error('Could not record outbound email:', insertError.message)
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})