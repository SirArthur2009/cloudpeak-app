import { createHmac, timingSafeEqual } from 'node:crypto'
import { transaction, listAuthUsers, syncVerifiedProfile } from './backend-db.js'
import { escapeHtml as esc, validEmail, fail, brandEmail, formatApplication } from './mail.js'
import { renderCampaignMarkdown } from '../supabase/functions/_shared/campaignMarkdown.js'

const senders = {
  noreply: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
  levi: 'Levi at Cloud Peak <levi@cloudpeaksilverlabradors.com>',
  leah: 'Leah at Cloud Peak <leah@cloudpeaksilverlabradors.com>',
  admin: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
  owner: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
}
const adminActions = new Set(['create-client-user', 'delete-client-user', 'list-client-users', 'send-turn-email', 'send-client-portal-credentials', 'send-email-reply', 'send-waitlist-campaign', 'resend-all-applications', 'email-previews', 'retry-email'])
const userActions = new Set(['complete-first-password-change', 'send-reservation-email'])
export const actionNames = new Set([...adminActions, ...userActions, 'notify-application', 'receive-inbound-email'])

export function verifyWebhook(raw, headers, secret, now = Date.now()) {
  if (!secret) return false
  const id = headers.get('svix-id'), timestamp = headers.get('svix-timestamp')
  if (!id || !/^\d+$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) return false
  const expected = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${raw}`).digest()
  return (headers.get('svix-signature') || '').split(' ').some(part => {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) return false
    const supplied = Buffer.from(value, 'base64')
    return supplied.length === expected.length && timingSafeEqual(expected, supplied)
  })
}

export function createActions({ pool, authAdmin, mail, env, fetchImpl = fetch }) {
  // Brand authored outbound messages; preserve incoming forwarded content.
  const rawMail = mail
  mail = { ...rawMail,
    send: (payload, key) => rawMail.send({ ...payload, html: brandEmail(payload.html || `<p>${esc(payload.text || '')}</p>`) }, key),
    enqueue: (payload, key) => rawMail.enqueue({ ...payload, html: brandEmail(payload.html || `<p>${esc(payload.text || '')}</p>`) }, key),
    enqueueMany: payloads => rawMail.enqueueMany(payloads.map(payload => ({ ...payload, html: brandEmail(payload.html || '') }))),
  }
  function adminRequired(context) {
    if (!context.user) fail('Sign in first.', 401)
    if (context.role !== 'cloudpeak_admin') fail('Admin access required.', 403)
  }
  function authWritesAllowed(email) {
    if (env.AUTH_WRITES_ENABLED !== 'true') fail('Account and password changes are blocked in local testing because they affect real accounts.', 409)
    if (!authAdmin) fail('Server-side Auth credentials are not configured.', 503)
    if (env.AUTH_ALLOWED_EMAILS && !env.AUTH_ALLOWED_EMAILS.split(',').map(value => value.trim().toLowerCase()).includes(String(email || '').toLowerCase())) fail('Hosted verification only permits the approved disposable account.', 409)
  }
  async function users() {
    if (!authAdmin) fail('Server-side Auth credentials are not configured.', 503)
    return listAuthUsers(authAdmin)
  }
  function sender(body) {
    if (body.sender === 'custom') {
      const name = String(body.custom_sender_name || '').trim(), email = String(body.custom_sender_email || '').trim().toLowerCase()
      if (!/^[\p{L}\p{N} .,'-]{1,80}$/u.test(name) || !/^[a-z0-9][a-z0-9._+-]{0,63}@cloudpeaksilverlabradors\.com$/.test(email)) fail('Enter a sender name and a Cloud Peak email address.')
      return `${name} <${email}>`
    }
    if (body.sender && !senders[body.sender]) fail('Invalid sender.')
    return senders[body.sender] || env.RESEND_FROM_EMAIL || senders.noreply
  }
  function portalUrl(value) {
    const configured = env.PORTAL_URL || 'http://127.0.0.1:5173/'
    const url = new URL(value || configured)
    if (url.origin !== new URL(configured).origin || !['http:', 'https:'].includes(url.protocol)) fail('Use the configured portal URL.')
    return url.href
  }
  async function adminEmails() {
    const configured = (env.ADMIN_EMAILS || '').split(',').map(value => value.trim()).filter(Boolean)
    if (configured.length) { if (!configured.every(validEmail)) fail('Admin email configuration is invalid.', 503); return [...new Set(configured)] }
    const { rows } = await pool.query(`SELECT u.email FROM cloudpeak_internal.user_directory u JOIN public.profiles p ON p.id=u.id
      WHERE p.role='admin' AND NOT EXISTS (SELECT 1 FROM cloudpeak_internal.deleted_accounts d WHERE d.id=u.id)`)
    return rows.map(row => row.email).filter(validEmail)
  }
  async function notify(application) {
    const recipients = [...new Set((env.APPLICATION_EMAILS || 'cloudpeaksilverlabs@yahoo.com').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))]
    if (!recipients.length || !recipients.every(validEmail)) fail('Application email configuration is invalid.', 503)
    const { text, html } = formatApplication(application)
    const results = []
    for (const to of recipients) results.push(await (mail.mode === 'live' ? mail.enqueue : mail.send)({ from: sender({}), to, subject: `New puppy application — ${application.first_name || ''} ${application.last_name || ''}`.slice(0, 300), text, html }, `application/${application.id}/${to.toLowerCase()}`))
    return { ok: true, preview: mail.mode === 'preview', sent_to: mail.mode === 'live' ? recipients : [], preview_count: results.filter(result => result.preview).length }
  }
  async function invoke(name, body, context, raw = '', headers = new Headers()) {
    if (!actionNames.has(name)) fail('Unknown server action.', 404)
    if (adminActions.has(name)) adminRequired(context)
    if (userActions.has(name) && !context.user) fail('Sign in first.', 401)
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object.')
    if (name === 'list-client-users') {
      const { rows } = await pool.query(`SELECT u.id,u.email,p.role,u.name,u.phone FROM cloudpeak_internal.user_directory u
        JOIN public.profiles p ON p.id=u.id WHERE NOT EXISTS (SELECT 1 FROM cloudpeak_internal.deleted_accounts d WHERE d.id=u.id) ORDER BY u.email`)
      return { users: rows }
    }
    if (name === 'email-previews') {
      const { rows } = await pool.query("SELECT id,status,created_at,payload FROM cloudpeak_internal.email_outbox WHERE status IN ('preview','queued','failed') ORDER BY created_at DESC LIMIT 50")
      return { previews: rows }
    }
    if (name === 'retry-email') {
      if (!/^[0-9a-f-]{36}$/i.test(body.job_id || '')) fail('Invalid email job.')
      const result = await mail.deliver(body.job_id)
      return { ok: true, status: result.status, preview: result.status === 'preview' }
    }
    if (name === 'create-client-user') {
      authWritesAllowed(body.email)
      const email = String(body.email || '').trim().toLowerCase()
      if (!validEmail(email)) fail('Enter a valid email address.')
      if (body.role && !['admin', 'client'].includes(body.role)) fail('Invalid account role.')
      if (body.password && (typeof body.password !== 'string' || body.password.length < 8)) fail('Password must be at least 8 characters.')
      const existing = (await users()).find(user => user.email?.toLowerCase() === email)
      if (!existing && !body.password) fail('A password is required for a new account.')
      const metadata = { ...(existing?.user_metadata || {}), ...(body.name ? { name: String(body.name).slice(0, 200) } : {}), ...(body.phone ? { phone: String(body.phone).slice(0, 50) } : {}) }
      const appMetadata = { ...(existing?.app_metadata || {}) }
      if (typeof body.must_change_password === 'boolean' || body.password) appMetadata.must_change_password = body.must_change_password ?? true
      const payload = { user_metadata: metadata, app_metadata: appMetadata, ...(body.password ? { password: body.password } : {}) }
      const result = existing ? await authAdmin.updateUserById(existing.id, payload) : await authAdmin.createUser({ ...payload, email, email_confirm: true })
      if (result.error) fail('The authentication service could not save this account.', 502)
      const user = result.data.user
      const assignedRole = body.role || (existing ? (await pool.query('SELECT role FROM public.profiles WHERE id=$1', [user.id])).rows[0]?.role : 'client') || 'client'
      await syncVerifiedProfile(pool, user)
      await pool.query('UPDATE public.profiles SET role=$2 WHERE id=$1', [user.id, assignedRole])
      return { ok: true, userId: user.id, created: !existing }
    }
    if (name === 'complete-first-password-change') {
      authWritesAllowed(context.user.email)
      if (typeof body.password !== 'string' || body.password.length < 8) fail('Password must be at least 8 characters.')
      const result = await authAdmin.updateUserById(context.user.id, { password: body.password, app_metadata: { ...context.user.app_metadata, must_change_password: false } })
      if (result.error) fail('The authentication service could not change your password.', 502)
      return { ok: true }
    }
    if (name === 'delete-client-user') {
      authWritesAllowed(body.email)
      const email = String(body.email || '').trim().toLowerCase()
      if (!validEmail(email)) fail('Enter a valid email address.')
      const user = (await users()).find(user => user.email?.toLowerCase() === email)
      if (user?.id === context.user.id || email === context.user.email?.toLowerCase()) fail('You cannot delete your own account.')
      if (user && (await pool.query("SELECT 1 FROM public.profiles WHERE id=$1 AND role='admin'", [user.id])).rowCount) fail('Admin accounts cannot be deleted through client management.')
      if (user) {
        // Deny existing sessions before Auth deletion. A failed deletion remains blocked for review.
        await pool.query('INSERT INTO cloudpeak_internal.deleted_accounts(id) VALUES($1) ON CONFLICT DO NOTHING', [user.id])
        const result = await authAdmin.deleteUser(user.id)
        if (result.error) fail('Account deletion failed. Access remains blocked; review before retrying.', 502)
      }
      return transaction(pool, async client => {
        const released = await client.query("UPDATE public.puppies SET status='available' WHERE id IN (SELECT selected_puppy_id FROM public.waitlist WHERE lower(email)=$1) AND status <> 'sold'", [email])
        await client.query('DELETE FROM public.applications WHERE lower(email)=$1', [email])
        const removed = await client.query('DELETE FROM public.waitlist WHERE lower(email)=$1', [email])
        if (user) await client.query('DELETE FROM public.profiles WHERE id=$1', [user.id])
        return { ok: true, released_puppies: released.rowCount, waitlist_entries_deleted: removed.rowCount }
      })
    }
    if (name === 'send-reservation-email') {
      // Read the caller's actual pending selection; never trust a supplied puppy/name.
      const { rows } = await pool.query(`SELECT w.id,w.name,w.email,w.selected_puppy_id,p.name AS puppy_name FROM public.waitlist w JOIN public.puppies p ON p.id=w.selected_puppy_id
        WHERE (lower(w.email)=lower($1) OR ($2=true AND w.id=$3)) AND w.pending_approval=true ORDER BY w.id DESC LIMIT 1`, [context.user.email, context.role === 'cloudpeak_admin', /^\d+$/.test(String(body.waitlistId || '')) ? body.waitlistId : null])
      const selection = rows[0]
      if (!selection) fail('No pending reservation was found.', 409)
      await pool.query("UPDATE public.applications SET status='archived' WHERE id=(SELECT id FROM public.applications WHERE lower(email)=lower($1) ORDER BY created_at DESC LIMIT 1)", [selection.email])
      const recipients = await adminEmails()
      if (!recipients.length) fail('No admin recipients are configured.', 503)
      for (const to of recipients) await mail.send({ from: sender({}), to, subject: `Reservation Request: ${selection.name} wants ${selection.puppy_name}`.slice(0, 300), html: `<h2>New reservation request</h2><p>${esc(selection.name)} selected ${esc(selection.puppy_name)}. Review in the admin portal.</p>` }, `reservation/${selection.id}/${selection.selected_puppy_id}/${to.toLowerCase()}`)
      return { ok: true, preview: mail.mode === 'preview' }
    }
    if (name === 'send-turn-email') {
      const email = String(body.clientEmail || '').trim().toLowerCase()
      if (!validEmail(email)) fail('Enter a valid client email address.')
      const { rows } = await pool.query('SELECT name FROM public.waitlist WHERE lower(email)=$1 AND is_active=true LIMIT 1', [email])
      if (!rows.length) fail('This client is not currently active on the waitlist.', 409)
      return mail.send({ from: sender({}), to: email, subject: "It's your turn to pick your puppy!", html: `<h2>Hi ${esc(rows[0].name)}!</h2><p>It is your turn to choose a puppy.</p><a href="${esc(portalUrl(body.portalUrl))}">Open portal</a>` })
    }
    if (name === 'send-client-portal-credentials') {
      const email = String(body.clientEmail || '').trim().toLowerCase()
      if (!validEmail(email)) fail('Enter a valid client email address.')
      const url = portalUrl(body.portalUrl)
      // Preview never retains the browser-provided temporary password.
      if (mail.mode === 'preview') return mail.send({ from: sender({}), to: email, subject: body.isReset ? 'Portal access reset preview' : 'Welcome to your Cloud Peak portal', html: `<p>Hi ${esc(body.clientName || 'there')}.</p><p>Preview only: the password is omitted. Open <a href="${esc(url)}">the portal</a>.</p>` })
      if (env.EMAIL_ALLOWED_RECIPIENTS && !env.EMAIL_ALLOWED_RECIPIENTS.split(',').map(value => value.trim().toLowerCase()).includes(email)) fail('Hosted verification only permits the approved test recipient.', 409)
      authWritesAllowed(email)
      if (typeof body.password !== 'string' || body.password.length < 8) fail('Temporary password is required.')
      const html = brandEmail(`<h2>Hi ${esc(body.clientName || 'there')}!</h2><p>Login email: ${esc(email)}</p><p>Temporary password: ${esc(body.password)}</p><p>Choose a new password when you sign in.</p><a href="${esc(url)}">Open portal</a>`)
      // Password-containing mail is sent directly and never persisted in email history/outbox.
      const key = env.RESEND_EMAIL_API_KEY || env.RESEND_API_KEY
      if (!key) fail('Email delivery is not configured.', 503)
      const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: sender({}), to: email, subject: body.isReset ? 'Your portal password has been reset' : 'Welcome to your Cloud Peak portal', html }) })
      if (!response.ok) fail('The account was saved, but the credential email failed. Retry from client management.', 502)
      const data = await response.json()
      await pool.query("INSERT INTO public.emails(direction,resend_id,from_email,to_email,subject,is_read) VALUES('outbound',$1,$2,$3,$4,true)", [data.id, sender({}), email, 'Portal credentials'])
      return { ok: true, data }
    }
    if (name === 'send-email-reply' || name === 'send-waitlist-campaign') {
      const subject = String(body.subject || '').trim(), message = String(body.message || '').trim()
      if (!subject || subject.length > 300 || !message || message.length > 20000) fail('Enter a subject and message within the size limits.')
      if (body.reply_to && !validEmail(body.reply_to)) fail('Enter a valid reply-to address.')
      const from = sender(body)
      if (name === 'send-email-reply') {
        const result = await mail.send({ from, to: body.to, subject, text: message, html: renderCampaignMarkdown(message), ...(body.reply_to ? { reply_to: body.reply_to } : {}), ...(env.FORWARD_TO_EMAIL ? { bcc: env.FORWARD_TO_EMAIL } : {}) })
        if (result.preview || result.queued) return result
        const { rows } = await pool.query('SELECT * FROM public.emails WHERE resend_id=$1 ORDER BY created_at DESC LIMIT 1', [result.data.id])
        if (body.thread_id && /^[0-9a-f-]{36}$/i.test(body.thread_id)) { await pool.query('UPDATE public.emails SET thread_id=$2 WHERE id=$1', [rows[0].id, body.thread_id]); rows[0].thread_id = body.thread_id }
        return { ...result, email: rows[0] }
      }
      const audience = String(body.audience || 'waitlists'), addresses = new Set()
      if (audience === 'custom') {
        if (!Array.isArray(body.recipients) || body.recipients.length > 1000 || !body.recipients.every(validEmail)) fail('Enter valid campaign recipients.')
        body.recipients.forEach(email => addresses.add(email.trim().toLowerCase()))
      } else {
        let query
        const args = []
        if (audience.startsWith('litter:')) {
          if (!/^litter:\d+$/.test(audience)) fail('Invalid litter audience.')
          query = 'SELECT email FROM public.waitlist WHERE litter_id=$1'; args.push(audience.slice(7))
        } else if (audience === 'everyone') query = 'SELECT email FROM public.waitlist UNION SELECT email FROM public.applications'
        else if (audience === 'applicants') query = 'SELECT email FROM public.applications'
        else if (audience === 'waitlists') query = 'SELECT email FROM public.waitlist'
        else fail('Invalid audience.')
        for (const row of (await pool.query(`${query} LIMIT 1001`, args)).rows) if (validEmail(row.email)) addresses.add(row.email.trim().toLowerCase())
      }
      if (addresses.size > 1000) fail('This campaign is too large.')
      if (mail.mode === 'live') {
        const result = await mail.enqueueMany([...addresses].map(to => ({ from, to, subject, text: message, html: renderCampaignMarkdown(message), ...(body.reply_to ? { reply_to: body.reply_to } : {}) })))
        return { sent: 0, failed: 0, total: addresses.size, queued: result.queued, preview: false, errors: [] }
      }
      let sent = 0, previews = 0, failed = 0
      const errors = []
      for (const to of addresses) {
        try {
          const result = await mail.send({ from, to, subject, text: message, html: renderCampaignMarkdown(message), ...(body.reply_to ? { reply_to: body.reply_to } : {}) })
          if (result.preview) previews++; else sent++
        } catch { failed++; errors.push('A delivery failed; review the saved email job.') }
      }
      return { sent, failed, total: addresses.size, preview: mail.mode === 'preview', preview_count: previews, errors: errors.slice(0, 3) }
    }
    if (name === 'notify-application') {
      // Public callers may only notify a recent application that already exists.
      if (!validEmail(body.email)) fail('Enter a valid applicant email address.')
      const { rows } = await pool.query("SELECT * FROM public.applications WHERE lower(email)=lower($1) AND first_name=$2 AND last_name=$3 AND created_at > now()-interval '15 minutes' ORDER BY created_at DESC LIMIT 1", [body.email, body.first_name, body.last_name])
      if (!rows.length) fail('No recent application was found.', 404)
      await notify(rows[0])
      // Public response never discloses administrator addresses.
      return { ok: true, preview: mail.mode === 'preview' }
    }
    if (name === 'resend-all-applications') {
      const { rows } = await pool.query(`SELECT * FROM public.applications ${body.unarchived_only ? "WHERE status IS DISTINCT FROM 'archived'" : ''} ORDER BY created_at LIMIT 1000`)
      let sent = 0, failed = 0
      for (const application of rows) { try { await notify(application); sent++ } catch { failed++ } }
      return { ok: true, total_applications: rows.length, sent_count: 0, queued_count: mail.mode === 'live' ? sent : 0, preview_count: mail.mode === 'preview' ? sent : 0, preview: mail.mode === 'preview', failed_count: failed, failures: [] }
    }
    if (name === 'receive-inbound-email') {
      if (!verifyWebhook(raw, headers, env.RESEND_WEBHOOK_SECRET)) fail('Invalid webhook signature.', 401)
      if (env.INBOUND_EMAIL_ENABLED === 'false') fail('Inbound processing awaits the live cutover.', 409)
      if (mail.mode !== 'live') fail('Inbound delivery is disabled in preview mode.', 409)
      if (body.type !== 'email.received') return { ok: true, ignored: true }
      const emailId = body.data?.email_id
      if (typeof emailId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(emailId)) fail('Invalid received email identifier.')
      const key = env.RESEND_EMAIL_API_KEY || env.RESEND_API_KEY
      if (!key) fail('Inbound email delivery is not configured.', 503)
      const receivedResponse = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) })
      if (!receivedResponse.ok) fail('Could not retrieve the incoming email.', 502)
      const received = await receivedResponse.json()
      const forwarded = await transaction(pool, async client => {
        const inserted = await client.query('INSERT INTO cloudpeak_internal.webhook_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [`received/${emailId}`])
        if (!inserted.rowCount) return false
        // Source inbox records copied at cutover must not be duplicated or
        // forwarded again when the provider retries an older delivery.
        if ((await client.query("SELECT 1 FROM public.emails WHERE direction='inbound' AND resend_id=$1 LIMIT 1", [emailId])).rowCount) return false
        await client.query("INSERT INTO public.emails(direction,resend_id,from_email,to_email,subject,text_body,html_body) VALUES('inbound',$1,$2,$3,$4,$5,$6)", [emailId, received.from || '', Array.isArray(received.to) ? received.to.join(', ') : received.to || '', received.subject || '(no subject)', received.text || '', received.html || ''])
        if (env.FORWARD_TO_EMAIL) await client.query("INSERT INTO cloudpeak_internal.email_outbox(dedupe_key,payload,status) VALUES($1,$2,'queued') ON CONFLICT DO NOTHING", [`forward/${emailId}`, JSON.stringify({ from: sender({}), to: env.FORWARD_TO_EMAIL, subject: `Fwd: ${received.subject || '(no subject)'}`.slice(0, 300), text: received.text || '', html: received.html || `<pre>${esc(received.text || '')}</pre>`, ...(validEmail(received.from) ? { reply_to: received.from } : {}) })])
        return true
      })
      if (env.FORWARD_TO_EMAIL) {
        const { rows } = await pool.query('SELECT id FROM cloudpeak_internal.email_outbox WHERE dedupe_key=$1', [`forward/${emailId}`])
        if (rows.length) await mail.deliver(rows[0].id)
      }
      return { ok: true, duplicate: !forwarded }
    }
  }
  return { invoke }
}
