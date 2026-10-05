import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { app, database } from './settings.js'
import { createActions } from './actions.js'
import { listAuthUsers, syncVerifiedProfile } from './backend-db.js'

if (!process.argv.includes('--authorized-disposable-account')) throw new Error('Explicit disposable-account test flag required.')
const email = 'levigbryan+cloudpeak-test@gmail.com'
const secret = database.SUPABASE_SERVICE_ROLE_KEY || app.SUPABASE_SERVICE_ROLE_KEY
if (!secret) throw new Error('Server-only Auth key is missing.')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const provider = createClient(app.VITE_SUPABASE_URL, secret, options)
const client = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, options)
const pool = new pg.Pool({ connectionString: database.DATABASE_URL, max: 2,
  ssl: { ca: await readFile(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
let createdId
let adminContext
let actions
const checks = {}
const hostedOrigin = process.env.TEST_HOSTED_ORIGIN
if (hostedOrigin && hostedOrigin !== 'https://cloudpeak-hosted-test-production.up.railway.app') throw new Error('Unexpected verification host.')
async function hosted(path, token, body) {
  return fetch(`${hostedOrigin}/railway-api${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
}
try {
  await pool.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  const users = await listAuthUsers(provider.auth.admin)
  assert.ok(!users.some(user => user.email?.toLowerCase() === email), 'Test address already exists; refusing to alter it.')
  for (const table of ['waitlist', 'applications']) {
    assert.equal((await pool.query(`SELECT 1 FROM public.${table} WHERE lower(email)=$1`, [email])).rowCount, 0, 'Existing customer record uses test address; refusing test.')
  }
  const admins = (await pool.query("SELECT id FROM public.profiles WHERE role='admin'")).rows
  const adminUser = users.find(user => admins.some(row => row.id === user.id))
  assert.ok(adminUser, 'No existing admin identity available for the internal action test.')
  adminContext = { user: adminUser, role: 'cloudpeak_admin' }
  // Capture creation before subsequent DB work, so failures still clean up Auth.
  const authAdmin = {
    listUsers: (...args) => provider.auth.admin.listUsers(...args),
    createUser: async payload => {
      assert.equal(payload.email, email)
      const result = await provider.auth.admin.createUser(payload)
      createdId = result.data?.user?.id
      return result
    },
    updateUserById: (id, payload) => {
      assert.equal(id, createdId, 'Refusing to change an existing account.')
      return provider.auth.admin.updateUserById(id, payload)
    },
    deleteUser: id => {
      assert.equal(id, createdId, 'Refusing to delete an existing account.')
      return provider.auth.admin.deleteUser(id)
    },
  }
  actions = createActions({ pool, authAdmin, env: { ...process.env, AUTH_WRITES_ENABLED: 'true' },
    mail: { mode: 'preview', send: () => { throw new Error('Account test must not send emails.') } } })
  const firstPassword = randomBytes(24).toString('base64url')
  const newPassword = randomBytes(24).toString('base64url')
  const created = await actions.invoke('create-client-user', { email, password: firstPassword, role: 'client', name: 'Disposable Railway migration test', must_change_password: true }, adminContext)
  assert.equal(created.created, true)
  checks.created = true
  const signedIn = await client.auth.signInWithPassword({ email, password: firstPassword })
  assert.ifError(signedIn.error)
  const verified = await client.auth.getUser(signedIn.data.session.access_token)
  assert.ifError(verified.error)
  assert.equal(verified.data.user.id, createdId)
  assert.equal(await syncVerifiedProfile(pool, verified.data.user), 'cloudpeak_user')
  assert.equal(verified.data.user.app_metadata.must_change_password, true)
  checks.loginAndRailwayClientRole = true
  if (hostedOrigin) {
    const profile = await hosted(`/rest/v1/profiles?select=id,role&id=eq.${createdId}`, signedIn.data.session.access_token)
    assert.equal(profile.status, 200)
    assert.equal((await profile.json())[0].role, 'client')
    assert.equal((await hosted('/functions/v1/create-client-user', signedIn.data.session.access_token, { email: 'unapproved@example.invalid', password: 'long-password' })).status, 403)
    const changed = await hosted('/functions/v1/complete-first-password-change', signedIn.data.session.access_token, { password: newPassword })
    assert.equal(changed.status, 200)
    checks.publicHttpsClientAccessAndPasswordChange = true
  } else await actions.invoke('complete-first-password-change', { password: newPassword }, { user: verified.data.user, role: 'cloudpeak_user' })
  const oldLogin = await client.auth.signInWithPassword({ email, password: firstPassword })
  assert.ok(oldLogin.error, 'Old password still works.')
  const newLogin = await client.auth.signInWithPassword({ email, password: newPassword })
  assert.ifError(newLogin.error)
  assert.equal(newLogin.data.user.app_metadata.must_change_password, false)
  checks.passwordChange = true
  await actions.invoke('delete-client-user', { email }, adminContext)
  checks.deleted = true
  assert.equal((await pool.query('SELECT 1 FROM public.profiles WHERE id=$1', [createdId])).rowCount, 0)
  await assert.rejects(syncVerifiedProfile(pool, newLogin.data.user), /removed/)
  const afterDelete = await client.auth.signInWithPassword({ email, password: newPassword })
  assert.ok(afterDelete.error, 'Deleted account can still log in.')
  assert.ok((await client.auth.getUser(newLogin.data.session.access_token)).error, 'Deleted user session still validates.')
  if (hostedOrigin) {
    assert.equal((await hosted('/rest/v1/profiles?select=id', newLogin.data.session.access_token)).status, 401)
    checks.publicHttpsDeletedSessionDenied = true
  }
  checks.deletedAccountAndSessionDenied = true
} finally {
  try {
    if (createdId) {
      const remaining = await provider.auth.admin.getUserById(createdId)
      if (remaining.data?.user) {
        assert.equal(remaining.data.user.email.toLowerCase(), email)
        await actions.invoke('delete-client-user', { email }, adminContext)
      }
      const stillPresent = await listAuthUsers(provider.auth.admin)
      assert.ok(!stillPresent.some(user => user.id === createdId), 'Temporary Auth account cleanup failed.')
      assert.equal((await pool.query('SELECT 1 FROM public.profiles WHERE id=$1', [createdId])).rowCount, 0)
      await pool.query('DELETE FROM auth.users WHERE id=$1', [createdId])
      checks.cleanupVerified = true
    }
    console.log(JSON.stringify({ checks, hostedAccountWritesChanged: false, emailSent: false }))
  } finally { await pool.end() }
}
