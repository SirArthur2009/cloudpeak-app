import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'

const app = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
const key = app.RESEND_EMAIL_API_KEY || app.RESEND_API_KEY
if (!key) throw new Error('Server-only Resend key is missing.')
const endpoint = 'https://cloudpeak-hosted-test-production.up.railway.app/railway-api/functions/v1/receive-inbound-email'
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.resend.com${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Resend configuration request failed (${response.status}); credentials not printed.`)
  return response.json()
}
const existing = (await api('/webhooks')).data?.find(item => item.endpoint === endpoint)
const hook = existing ? await api(`/webhooks/${existing.id}`) : await api('/webhooks', 'POST', { endpoint, events: ['email.received'], status: 'disabled' })
// Keep the source Supabase webhook enabled. This new receiver is staged only.
await api(`/webhooks/${hook.id}`, 'PATCH', { status: 'disabled' })
const verified = await api(`/webhooks/${hook.id}`)
if (verified.status !== 'disabled') throw new Error('New receiver was not disabled.')
const secret = hook.signing_secret || verified.signing_secret
if (!secret) throw new Error('Signing secret unavailable; staged receiver remains disabled.')
await writeFile(new URL('./.env.release', import.meta.url), `RESEND_API_KEY=${key}\nRESEND_WEBHOOK_SECRET=${secret}\n`, { mode: 0o600 })
await writeFile(new URL('./resend-staged.json', import.meta.url), JSON.stringify({ id: hook.id, endpoint, status: 'disabled', existingSourceWebhookPreserved: true }, null, 2))
console.log('Prepared disabled Railway Resend receiver; secrets saved in ignored server-only release environment file.')
