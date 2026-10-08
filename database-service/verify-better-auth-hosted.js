import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { database } from './settings.js'
import { createBetterAuthAdmin } from './better-auth.js'

const origin = 'https://portal.cloudpeaksilverlabradors.com'
const health = await fetch(`${origin}/health`).then(response => response.json())
assert.equal(health.ok, true)
assert.equal(health.auth, 'Better Auth')
const ssl = { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined }
const pool = new pg.Pool({ connectionString: database.DATABASE_URL, ssl, max: 2 })
const authPool = new pg.Pool({ connectionString: database.DATABASE_URL, ssl, max: 2, options: '-c search_path=cloudpeak_auth' })
const admin = createBetterAuthAdmin(authPool)
const email = `deployment-check-${randomUUID()}@example.invalid`
const firstPassword = randomBytes(24).toString('base64url')
const nextPassword = randomBytes(24).toString('base64url')
let id
const call = (path, body, token) => fetch(`${origin}/railway-api${path}`, {
  method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
  headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})
async function login(password) {
  let response = await call('/api/auth/sign-in/email', { email, password })
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after') || 10)
    await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(seconds, 1), 30) * 1000 + 1000))
    response = await call('/api/auth/sign-in/email', { email, password })
  }
  assert.equal(response.status, 200)
  const token = response.headers.get('set-auth-token')
  assert.ok(token)
  return token
}
try {
  const created = await admin.createUser({ email, password: firstPassword, user_metadata: { name: 'Temporary deployment check' }, app_metadata: { must_change_password: true } })
  assert.equal(created.error, null)
  id = created.data.user.id
  const token = await login(firstPassword)
  const session = await (await call('/api/auth/get-session', null, token)).json()
  assert.equal(session.user.id, id)
  assert.equal(session.user.mustChangePassword, true)
  const address = (await authPool.query('SELECT "ipAddress" FROM session WHERE "userId"=$1', [id])).rows[0]?.ipAddress
  assert.ok(address && !['127.0.0.1', '::1'].includes(address), 'Hosted auth must receive the real client address from the edge.')
  const profile = await call(`/rest/v1/profiles?select=role&id=eq.${id}`, null, token)
  assert.equal(profile.status, 200)
  assert.equal((await profile.json())[0].role, 'client')
  assert.equal((await call('/functions/v1/list-client-users', {}, token)).status, 403)
  assert.equal((await call('/functions/v1/complete-first-password-change', { password: nextPassword }, token)).status, 200)
  assert.equal((await call('/auth-user', null, token)).status, 401)
  assert.equal((await call('/api/auth/sign-in/email', { email, password: firstPassword })).status, 401)
  const newToken = await login(nextPassword)
  const changed = await (await call('/api/auth/get-session', null, newToken)).json()
  assert.equal(changed.user.mustChangePassword, false)
  assert.equal((await call('/api/auth/sign-out', {}, newToken)).status, 200)
  assert.equal((await call('/auth-user', null, newToken)).status, 401)
  const lastToken = await login(nextPassword)
  assert.equal((await admin.deleteUser(id)).error, null)
  assert.equal((await call('/auth-user', null, lastToken)).status, 401)
  assert.equal((await call('/api/auth/sign-in/email', { email, password: nextPassword })).status, 401)
  assert.equal((await call('/auth-user', null, 'forged-token')).status, 401)
  console.log('Hosted login, UUID preservation, client role, admin denial, first password change, logout and deletion verified. No emails sent.')
} finally {
  if (id) {
    const removed = await admin.deleteUser(id)
    assert.ifError(removed.error)
    await pool.query('DELETE FROM public.profiles WHERE id=$1', [id])
    await pool.query('DELETE FROM auth.users WHERE id=$1', [id])
    assert.equal((await authPool.query('SELECT 1 FROM "user" WHERE id=$1', [id])).rowCount, 0)
    console.log('Temporary account, sessions and profile removed.')
  }
  await Promise.all([pool.end(), authPool.end()])
}
