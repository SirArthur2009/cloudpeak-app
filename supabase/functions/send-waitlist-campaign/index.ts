import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c)

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const resendKey = Deno.env.get('RESEND_EMAIL_API_KEY') || ''
    if (!url || !key || !resendKey) return reply({ error: 'Email service is not configured' }, 500)
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return reply({ error: 'Unauthorized' }, 401)
    const db = createClient(url, key)
    const { data: auth, error: authError } = await db.auth.getUser(token)
    if (authError || !auth.user) return reply({ error: 'Unauthorized' }, 401)
    const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).single()
    if (profile?.role !== 'admin') return reply({ error: 'Admin access required' }, 403)

    const payload = await req.json()
    const subject = String(payload.subject || '').trim()
    const message = String(payload.message || '').trim()
    const audience = String(payload.audience || 'waitlists')
    const litterId = audience.startsWith('litter:') ? audience.slice(7) : null
    if (!subject || subject.length > 300 || !message || message.length > 20000) return reply({ error: 'Invalid subject or message' }, 400)
    if (!['waitlists', 'everyone', 'applicants'].includes(audience) && !litterId) return reply({ error: 'Invalid audience' }, 400)
    if (litterId && !/^\d+$/.test(String(litterId))) return reply({ error: 'Invalid litter' }, 400)
    if (litterId) {
      const { data: litter } = await db.from('litters').select('id').eq('id', litterId).maybeSingle()
      if (!litter) return reply({ error: 'Litter not found' }, 404)
    }

    // Page through each source so the database default row limit never drops recipients.
    const addresses = new Set<string>()
    for (const table of audience === 'everyone' ? ['waitlist', 'applications'] : audience === 'applicants' ? ['applications'] : ['waitlist']) {
      for (let offset = 0; ; offset += 1000) {
        let query = db.from(table).select('email').order('id').range(offset, offset + 999)
        if (litterId) query = query.eq('litter_id', litterId)
        const { data, error } = await query
        if (error) throw error
        for (const row of data || []) {
          const email = String(row.email || '').trim().toLowerCase()
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) addresses.add(email)
        }
        if ((data || []).length < 1000) break
      }
    }
    if (addresses.size > 1000) return reply({ error: 'This group is too large to send in one campaign.' }, 400)

    const from = Deno.env.get('RESEND_FROM_EMAIL') || 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>'
    const html = `<p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>`
    let sent = 0
    let failed = 0
    const recipients = [...addresses]
    for (let offset = 0; offset < recipients.length; offset += 100) {
      const batch = recipients.slice(offset, offset + 100)
      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map(email => ({ from, to: [email], subject, text: message, html })))
      })
      if (!response.ok) { failed += batch.length; console.error('Campaign send failed', response.status, await response.text()); continue }
      const result = await response.json()
      sent += batch.length
      const rows = batch.map((email, index) => ({ thread_id: crypto.randomUUID(), direction: 'outbound', resend_id: result.data?.[index]?.id || null, from_email: from, to_email: email, subject, text_body: message, html_body: html, is_read: true }))
      const { error } = await db.from('emails').insert(rows)
      if (error) console.error('Campaign email log failed', error.message)
    }
    return reply({ sent, failed, total: addresses.size })
  } catch (error) {
    console.error(error)
    return reply({ error: error instanceof Error ? error.message : 'Campaign failed' }, 500)
  }
})
