// supabase/functions/send-email-reply/index.ts
// Deploy with: supabase functions deploy send-email-reply
//
// Lets an authenticated admin reply to an email thread from the
// Settings > Email tab. Sends via Resend and stores the outbound copy.
//
// Required secrets (set via Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY            — get a free key at resend.com
//   RESEND_FROM_EMAIL         — optional, sender used for replies
//   SUPABASE_URL              — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase

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
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    if (!resendKey) {
      throw new Error('Missing RESEND_API_KEY')
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

    const { thread_id, to, subject, message } = await req.json()
    if (!thread_id || !to || !message) {
      return new Response(JSON.stringify({ error: 'thread_id, to, and message are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>'
    const replySubject = subject && subject.trim().length > 0 ? subject : 'Re: your message'
    const authHeaderValue = 'Bearer ' + resendKey

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': authHeaderValue, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject: replySubject,
        html: `<p>${String(message).replace(/\n/g, '<br />')}</p>`,
        text: message,
      }),
    })

    if (!sendRes.ok) {
      throw new Error(`Resend send failed (${sendRes.status}): ${await sendRes.text()}`)
    }
    const sendData = await sendRes.json()

    const { error: insertError } = await adminClient.from('emails').insert({
      thread_id,
      direction: 'outbound',
      resend_id: sendData?.id ?? null,
      from_email: fromEmail,
      to_email: to,
      subject: replySubject,
      text_body: message,
      html_body: `<p>${String(message).replace(/\n/g, '<br />')}</p>`,
      is_read: true,
    })
    if (insertError) throw new Error(`Could not store outbound email: ${insertError.message}`)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    return new Response(JSON.stringify({ error: 'Failed to send reply' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
