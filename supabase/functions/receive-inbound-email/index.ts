// supabase/functions/receive-inbound-email/index.ts
// Deploy with: supabase functions deploy receive-inbound-email --no-verify-jwt
//
// Configure this function's URL as the "Endpoint" for Resend's inbound email
// webhook (Resend dashboard → Webhooks → Add Endpoint, event: email.received).
//
// Required secrets (set via Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY            — used to fetch the full received email + forward it
//   RESEND_WEBHOOK_SECRET     — the "Signing Secret" shown for the webhook endpoint
//   RESEND_FROM_EMAIL         — optional, sender used for the forwarded copy
//   FORWARD_TO_EMAIL          — optional, defaults to cloudpeaksilverlabs@yahoo.com
//   SUPABASE_URL              — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
}

const DEFAULT_FORWARD_TO = 'cloudpeaksilverlabs@yahoo.com'

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin)
}

// Verifies Resend's (svix-based) webhook signature.
// See https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
async function verifySignature(req: Request, rawBody: string, secret: string): Promise<boolean> {
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const secretBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = bytesToBase64(signatureBuffer)

  const candidates = svixSignature.split(' ').map((part) => part.split(',')[1]).filter(Boolean)
  return candidates.includes(expected)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const rawBody = await req.text()
    const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')

    if (webhookSecret) {
      const valid = await verifySignature(req, rawBody, webhookSecret)
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const event = JSON.parse(rawBody)

    if (event?.type !== 'email.received') {
      // Ignore any other event types Resend might send to this endpoint.
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emailId = event?.data?.email_id
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!emailId || !resendKey) {
      throw new Error('Missing email_id or RESEND_API_KEY')
    }

    // The webhook payload only contains metadata; fetch the full body.
    const authHeaderValue = 'Bearer ' + resendKey
    const receivedRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { 'Authorization': authHeaderValue },
    })
    if (!receivedRes.ok) {
      throw new Error(`Could not fetch received email (${receivedRes.status}): ${await receivedRes.text()}`)
    }
    const received = await receivedRes.json()

    const fromEmail = received.from || event.data.from || 'unknown@unknown'
    const toEmail = Array.isArray(received.to) ? received.to.join(', ') : (received.to || (event.data.to || []).join(', '))
    const subject = received.subject || event.data.subject || '(no subject)'
    const textBody = received.text || ''
    const htmlBody = received.html || ''

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error: insertError } = await supabase.from('emails').insert({
      direction: 'inbound',
      resend_id: emailId,
      from_email: fromEmail,
      to_email: toEmail,
      subject,
      text_body: textBody,
      html_body: htmlBody,
    })
    if (insertError) throw new Error(`Could not store email: ${insertError.message}`)

    // Forward a copy of every inbound email so it's never missed.
    const fromForward = Deno.env.get('RESEND_FROM_EMAIL') || 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>'
    const forwardTo = Deno.env.get('FORWARD_TO_EMAIL') || DEFAULT_FORWARD_TO

    const forwardRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': authHeaderValue, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromForward,
        to: forwardTo,
        reply_to: fromEmail,
        subject: `Fwd: ${subject}`,
        html: htmlBody || `<pre>${textBody}</pre>`,
        text: textBody || undefined,
      }),
    })

    if (!forwardRes.ok) {
      // Don't fail the webhook (the email is already stored); just log it.
      console.error(`Failed to forward email (${forwardRes.status}): ${await forwardRes.text()}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
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
