import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { clientName, clientEmail, password, portalUrl, isReset, mustChangePassword } = await req.json()

    if (!clientEmail || !password) {
      return new Response(JSON.stringify({ error: 'clientEmail and password are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const safeName = clientName || 'there'
    const loginUrl = portalUrl || 'https://cloudpeaksilverlabradors.com/waitlist.html'
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Cloud Peak Silver Labradors <onboarding@resend.dev>'

    const subject = isReset
      ? 'Your Cloud Peak portal password has been reset'
      : 'Welcome to your Cloud Peak portal'

    const passwordLabel = (mustChangePassword ?? true) ? 'Temporary password' : 'New password'
    const passwordNote = (mustChangePassword ?? true)
      ? '<p>When you sign in, you will be asked to choose a new password before continuing.</p>'
      : '<p>You can use this password to sign in to your portal.</p>'

    const introHtml = isReset
      ? `<p>Your password for the Cloud Peak Silver Labradors portal has been reset.</p>`
      : `<p>Welcome to the Cloud Peak Silver Labradors client portal.</p>
         <p>You have been added to the waitlist portal and can now log in to view available puppies, track your place in line, and review pedigree information.</p>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: clientEmail,
        subject,
        html: `
          <h2>Hi ${safeName},</h2>
          ${introHtml}

          <p><strong>Login email:</strong> ${clientEmail}</p>
          <p><strong>${passwordLabel}:</strong> ${password}</p>
          ${passwordNote}
          <p><a href="${loginUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a1a;color:#fff;border-radius:6px;text-decoration:none;">Open Portal</a></p>

          <h3>How to use the portal</h3>
          <ul>
            <li><strong>Available Puppies:</strong> Browse current and upcoming puppies and filter by litter or status.</li>
            <li><strong>Waitlist:</strong> View your litter and see where your family sits in the lineup.</li>
            <li><strong>Pedigrees:</strong> Search for dogs and review pedigree, Embark, and OFA information when available.</li>
          </ul>

          <h3>How the puppy selection process works</h3>
          <p>Once the waitlist is active, families are placed in order based on their position. When it is your turn, you will receive a notification and you will be able to log in and choose from the available puppies in your litter.</p>
          <p>If another family is currently choosing, you will see that message in the portal and can check back later. When it is your turn, you can select a puppy and submit your request.</p>
          <p>After you choose a puppy, the request is reviewed before final approval. Once approved, that puppy is reserved for your family.</p>

          <p>Please keep your login details secure and make sure to check the portal regularly for updates.</p>
          <p>If you have any questions, simply reply to this email and we’ll be happy to help.</p>
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (supabaseUrl && serviceRoleKey) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey)
      const { error: insertError } = await adminClient.from('emails').insert({
        direction: 'outbound',
        resend_id: data?.id ?? null,
        from_email: fromEmail,
        to_email: clientEmail,
        subject,
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
