import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'))
const checks = [
  ['App', 'http://127.0.0.1:5173/'],
  ['Website', 'http://127.0.0.1:5174/'],
  ['Local storage signer', 'http://127.0.0.1:3001/functions/v1/storage-files/api/admin-files/sign-read', { method: 'POST', body: '{}' }],
  ['Supabase Auth', `${env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY } }],
  ['Supabase Database', `${env.VITE_SUPABASE_URL}/rest/v1/puppies?select=id&limit=1`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY } }],
]
await Promise.all(checks.map(async ([label, url, options]) => {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) })
    await response.body?.cancel()
    console.log(`${label}: HTTP ${response.status}${label === 'Local storage signer' && response.status === 401 ? ' (running; login required)' : ''}`)
  } catch (error) { console.log(`${label}: ${error.cause?.code || error.name} (${error.message})`) }
}))
