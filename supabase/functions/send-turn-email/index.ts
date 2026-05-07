import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const { clientName, clientEmail, portalUrl } = await req.json()

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
      to: clientEmail,
      subject: `It's your turn to pick your puppy!`,
      html: `
        <h2>Hi ${clientName}!</h2>
        <p>Great news — it's your turn to choose your puppy from Cloud Peak Silver Labradors.</p>
        <p>Log in to the portal to make your selection:</p>
        <a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a1a;color:#fff;border-radius:6px;text-decoration:none;">
          Choose My Puppy
        </a>
      `
    })
  })

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})