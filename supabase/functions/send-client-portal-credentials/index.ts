import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { clientName, clientEmail, password, portalUrl } = await req.json()

    if (!clientEmail || !password) {
      return new Response(JSON.stringify({ error: 'clientEmail and password are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const safeName = clientName || 'there'
    const loginUrl = portalUrl || 'https://cloudpeaksilverlabradors.com/waitlist.html'
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Cloud Peak Silver Labradors <onboarding@resend.dev>'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: clientEmail,
        subject: 'Your Cloud Peak waitlist portal login',
        html: `
          <h2>Hi ${safeName},</h2>
          <p>You have been added to the Cloud Peak waitlist portal.</p>
          <p><strong>Login email:</strong> ${clientEmail}</p>
          <p><strong>Temporary password:</strong> ${password}</p>
          <p>When you sign in for the first time, you will be asked to choose a new password before continuing.</p>
          <p><a href="${loginUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a1a;color:#fff;border-radius:6px;text-decoration:none;">Open Portal</a></p>
          <p>Please keep your login details secure.</p>
        `
      })
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message || 'Failed to send email', details: data }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
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
