import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createBetterAuth, legacyUser } from './better-auth.js'

test('imported bcrypt account keeps its password and UUID; sessions revoke on sign out', async () => {
  const db = { user: [], account: [], session: [], verification: [] }
  const auth = createBetterAuth(memoryAdapter(db), {
    BETTER_AUTH_SECRET: 'test-only-secret-with-more-than-32-characters',
    BETTER_AUTH_URL: 'http://localhost:3002', ALLOWED_ORIGINS: 'http://localhost:5173',
  })
  const context = await auth.$context
  const id = randomUUID()
  await context.internalAdapter.createUser({ id, name: 'Imported client', email: 'client@example.com', emailVerified: true, mustChangePassword: true, phone: '555' })
  await context.internalAdapter.createAccount({ userId: id, accountId: id, providerId: 'credential', password: await hash('existing-password', 10) })
  const call = (path, body, token) => auth.handler(new Request(`http://localhost:3002/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }))
  assert.equal((await call('sign-up/email', { email: 'new@example.com', password: 'existing-password', name: 'New' })).status, 400)
  assert.equal((await call('sign-in/email', { email: 'client@example.com', password: 'wrong-password' })).status, 401)
  const login = await call('sign-in/email', { email: 'client@example.com', password: 'existing-password' })
  assert.equal(login.status, 200)
  const token = login.headers.get('set-auth-token')
  assert.ok(token)
  const current = await (await call('get-session', null, token)).json()
  assert.equal(current.user.id, id)
  assert.equal(legacyUser(current.user).app_metadata.must_change_password, true)
  assert.equal((await call('sign-out', {}, token)).status, 200)
  assert.equal(await (await call('get-session', null, token)).json(), null)
  assert.equal(await auth.api.getSession({ headers: new Headers({ authorization: 'Bearer forged-token' }) }), null)
})
