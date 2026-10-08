import { randomUUID } from 'node:crypto'

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
export const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }

export function brandEmail(html) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f8;color:#26333a;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:#fff;border-top:3px solid #597987"><tr><td style="padding:20px 28px;border-bottom:1px solid #e8edef;font-size:15px;font-weight:bold;letter-spacing:1px">CLOUD PEAK <span style="font-weight:normal;color:#657780">Silver Labradors</span></td></tr><tr><td style="padding:24px 28px;font-size:15px;line-height:1.65">${html}</td></tr><tr><td style="padding:18px 28px;border-top:1px solid #e8edef;font-size:12px;color:#657780"><a href="https://cloudpeaksilverlabradors.com" style="color:#597987">Cloud Peak Silver Labradors</a></td></tr></table></td></tr></table></body></html>`
}

export function formatApplication(application) {
  const fields = Object.entries(application).filter(([key]) => !['id', 'created_at', 'status'].includes(key))
  const label = key => key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  const value = item => item == null || item === '' ? 'Not provided' : typeof item === 'boolean' ? (item ? 'Yes' : 'No') : Array.isArray(item) ? item.join(', ') : typeof item === 'object' ? JSON.stringify(item) : String(item)
  return {
    text: `New puppy application\n\n${fields.map(([key, item]) => `${label(key)}: ${value(item)}`).join('\n\n')}`,
    html: `<h2 style="margin-top:0">New puppy application</h2><table width="100%" cellspacing="0" cellpadding="0">${fields.map(([key, item]) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e8edef"><div style="font-size:12px;font-weight:bold;color:#657780;margin-bottom:4px">${escapeHtml(label(key))}</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(value(item))}</div></td></tr>`).join('')}</table>`,
  }
}

export function createMailer({ pool, env, fetchImpl = fetch }) {
  const mode = env.EMAIL_MODE || 'preview'
  if (!['preview', 'live'].includes(mode)) throw new Error('EMAIL_MODE must be preview or live.')
  const allowed = env.EMAIL_ALLOWED_RECIPIENTS ? new Set(env.EMAIL_ALLOWED_RECIPIENTS.split(',').map(value => value.trim().toLowerCase())) : null
  function validate(payload) {
    if (!validEmail(payload.to)) fail('Enter a valid recipient email address.')
    if (!payload.subject || payload.subject.length > 300) fail('Enter a subject of at most 300 characters.')
    if (mode === 'live' && allowed && [payload.to, ...[payload.cc, payload.bcc].flat().filter(Boolean)].some(to => !allowed.has(to.toLowerCase()))) fail('Hosted verification only permits the approved test recipient.', 409)
    if (mode === 'live' && !(env.RESEND_EMAIL_API_KEY || env.RESEND_API_KEY)) fail('Email delivery is not configured.', 503)
  }
  async function deliver(id) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query('SELECT * FROM cloudpeak_internal.email_outbox WHERE id=$1 FOR UPDATE', [id])
      const item = rows[0]
      if (!item) fail('Email job not found.', 404)
      if (item.status === 'sent' || item.status === 'preview') { await client.query('COMMIT'); return item }
      if (mode !== 'live') fail('Live email delivery is disabled in preview mode.', 409)
      validate(item.payload)
      // Resend retains idempotency keys for 24h; avoid replaying an older failed job automatically.
      if (Date.now() - new Date(item.created_at).getTime() > 23 * 60 * 60 * 1000) fail('Email retry window expired; review delivery before sending again.', 409)
      const key = env.RESEND_EMAIL_API_KEY || env.RESEND_API_KEY
      if (!key) fail('Email delivery is not configured.', 503)
      // Serialize provider calls across replicas using this Railway database.
      // Leave headroom below Resend's default request limit.
      await client.query('SELECT pg_advisory_xact_lock(209315001)')
      await client.query('SELECT pg_sleep(0.6)')
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `cloudpeak/${id}` },
        body: JSON.stringify(item.payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.id) {
        if (response.status === 429) {
          await client.query("UPDATE cloudpeak_internal.email_outbox SET status='queued',error_code='provider_429',next_attempt_at=now()+interval '10 seconds',updated_at=now() WHERE id=$1", [id])
          await client.query('COMMIT')
          return { ...item, status: 'queued' }
        }
        await client.query("UPDATE cloudpeak_internal.email_outbox SET status='failed',error_code=$2,updated_at=now() WHERE id=$1", [id, `provider_${response.status}`])
        await client.query('COMMIT')
        fail('Email provider rejected delivery. The job is saved for review.', 502)
      }
      await client.query("INSERT INTO public.emails(direction,resend_id,from_email,to_email,subject,text_body,html_body,is_read,thread_id) VALUES('outbound',$1,$2,$3,$4,$5,$6,true,$7)", [result.id, item.payload.from, item.payload.to, item.payload.subject, item.payload.text || null, item.payload.html || null, item.payload.thread_id || randomUUID()])
      // Erase bodies after delivery so temporary credentials aren't retained in the outbox.
      await client.query("UPDATE cloudpeak_internal.email_outbox SET status='sent',provider_id=$2,error_code=NULL,payload=payload-'html'-'text',updated_at=now() WHERE id=$1", [id, result.id])
      await client.query('COMMIT')
      return { ...item, status: 'sent', provider_id: result.id }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }
  async function store(payload, dedupeKey = null) {
    validate(payload)
    // Use the same durable job for retries of a server-derived event.
    const { rows } = await pool.query(`INSERT INTO cloudpeak_internal.email_outbox(dedupe_key,payload,status) VALUES($1,$2,$3)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        payload=CASE WHEN email_outbox.status='preview' AND EXCLUDED.status='queued' THEN EXCLUDED.payload ELSE email_outbox.payload END,
        created_at=CASE WHEN email_outbox.status='preview' AND EXCLUDED.status='queued' THEN now() ELSE email_outbox.created_at END,
        status=CASE WHEN email_outbox.status='preview' AND EXCLUDED.status='queued' THEN 'queued' ELSE email_outbox.status END
      RETURNING *`, [dedupeKey && mode === 'preview' ? `preview/${dedupeKey}` : dedupeKey, JSON.stringify(payload), mode === 'preview' ? 'preview' : 'queued'])
    return rows[0]
  }
  async function send(payload, dedupeKey = null) {
    const item = await store(payload, dedupeKey)
    const result = await deliver(item.id)
    return { ok: true, preview: result.status === 'preview', queued: result.status === 'queued', job_id: result.id, data: { id: result.provider_id }, status: result.status }
  }
  async function enqueueMany(payloads) {
    payloads.forEach(validate)
    if (!payloads.length) return { queued: 0 }
    const { rows } = await pool.query("INSERT INTO cloudpeak_internal.email_outbox(payload,status) SELECT value,'queued' FROM jsonb_array_elements($1::jsonb) RETURNING id", [JSON.stringify(payloads)])
    return { queued: rows.length }
  }
  async function enqueue(payload, dedupeKey) {
    const item = await store(payload, dedupeKey)
    return { ok: true, queued: item.status === 'queued', preview: item.status === 'preview', job_id: item.id }
  }
  let draining = false
  async function drain() {
    if (mode !== 'live' || draining) return
    draining = true
    try {
      await pool.query("UPDATE cloudpeak_internal.email_outbox SET status='failed',error_code='retry_window_expired' WHERE status='queued' AND created_at < now()-interval '23 hours'")
      const { rows } = await pool.query("SELECT id FROM cloudpeak_internal.email_outbox WHERE status='queued' AND next_attempt_at <= now() AND ($1::text[] IS NULL OR lower(payload->>'to')=ANY($1)) ORDER BY created_at LIMIT 10", [allowed ? [...allowed] : null])
      for (const { id } of rows) { try { await deliver(id) } catch { /* Durable job remains available for review/retry. */ } }
    } finally { draining = false }
  }
  return { mode, send, deliver, enqueue, enqueueMany, drain }
}
