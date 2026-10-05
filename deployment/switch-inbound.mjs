import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'

if (!process.argv.includes('--approve-live-cutover')) throw new Error('Explicit live cutover approval required.')
const origin = 'https://cloudpeak-hosted-test-production.up.railway.app'
const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) }).then(response => response.json())
if (!health.ok || health.releaseMode !== 'live' || health.actionsRestricted) throw new Error('Verified live Railway deployment must be running first.')
const env = parseEnv(await readFile(new URL('./.env.release', import.meta.url), 'utf8'))
const id = 'c1ffabd1-536b-4de2-a5a8-00c6e7b94d63'
const previousEndpoint = 'https://bvnurkvvhlmdapvhvcje.supabase.co/functions/v1/receive-inbound-email'
const endpoint = `${origin}/railway-api/functions/v1/receive-inbound-email`
async function api(method, body) {
  const response = await fetch(`https://api.resend.com/webhooks/${id}`, { method, headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Receiver switch failed (${response.status}).`)
  return response.json()
}
const current = await api('GET')
if (![previousEndpoint, endpoint].includes(current.endpoint)) throw new Error('Existing receiver changed outside this plan; review before switching.')
await api('PATCH', { endpoint, events: ['email.received'], status: 'enabled' })
const verified = await api('GET')
if (verified.endpoint !== endpoint || verified.status !== 'enabled') throw new Error('Receiver switch verification failed.')
await writeFile(new URL('./inbound-cutover.json', import.meta.url), JSON.stringify({ id, previousEndpoint, endpoint, enabled: true, signingSecretUnchanged: true }, null, 2))
console.log('Existing inbound receiver moved to Railway; no duplicate subscription enabled.')
