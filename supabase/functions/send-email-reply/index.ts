// supabase/functions/send-email-reply/index.ts
// Deploy with: supabase functions deploy send-email-reply
//
// Lets an authenticated admin reply to an email thread from the
// Settings > Email tab. Sends via Resend and stores the outbound copy.
//
// Required secrets (set via Supabase dashboard → Edge Functions → Secrets):
//   RESEND_EMAIL_API_KEY      — key for inbox replies, separate from application notifications
//   RESEND_FROM_EMAIL         — optional, sender used for replies
//   SUPABASE_URL              — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_FORWARD_TO = 'cloudpeaksilverlabs@yahoo.com'

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
    const resendKey = Deno.env.get('RESEND_EMAIL_API_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    if (!resendKey) {
      throw new Error('Missing RESEND_EMAIL_API_KEY')
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

    const { thread_id, to, subject, message, reply_to, sender } = await req.json()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim()) || !message || !String(message).trim() || !subject || !String(subject).trim()) {
      return new Response(JSON.stringify({ error: 'Recipient, subject, and message are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const senders: Record<string, string> = {
      noreply: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
      levi: 'Levi at Cloud Peak <levi@cloudpeaksilverlabradors.com>',
      leah: 'Leah at Cloud Peak <leah@cloudpeaksilverlabradors.com>',
      admin: 'Cloud Peak Admin <admin@cloudpeaksilverlabradors.com>',
      owner: 'Cloud Peak Owner <owner@cloudpeaksilverlabradors.com>',
    }
    if (sender && !senders[sender]) return new Response(JSON.stringify({ error: 'Invalid sender' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const fromEmail = sender ? senders[sender] : Deno.env.get('RESEND_FROM_EMAIL') || senders.noreply
    const forwardTo = Deno.env.get('FORWARD_TO_EMAIL') || DEFAULT_FORWARD_TO
    const replySubject = String(subject).trim().slice(0, 300)
    const safeText = String(message).trim().slice(0, 20000)
    const safeHtml = `<p>${safeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />')}</p>`
    const outboundThreadId = thread_id || crypto.randomUUID()
    const authHeaderValue = 'Bearer ' + resendKey

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': authHeaderValue, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to,
        bcc: forwardTo,
        reply_to: reply_to || undefined,
        subject: replySubject,
        html: safeHtml,
        text: safeText,
      }),
    })

    if (!sendRes.ok) {
      throw new Error(`Resend send failed (${sendRes.status}): ${await sendRes.text()}`)
    }
    const sendData = await sendRes.json()

    const { data: savedEmail, error: insertError } = await adminClient
      .from('emails')
      .insert({
        thread_id: outboundThreadId,
        direction: 'outbound',
        resend_id: sendData?.id ?? null,
        from_email: fromEmail,
        to_email: to,
        subject: replySubject,
        text_body: safeText,
        html_body: safeHtml,
        is_read: true,
      })
      .select('id, thread_id, direction, from_email, to_email, subject, text_body, html_body, is_read, created_at')
      .single()
    if (insertError) throw new Error(`Could not store outbound email: ${insertError.message}`)

    return new Response(JSON.stringify({ ok: true, email: savedEmail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
