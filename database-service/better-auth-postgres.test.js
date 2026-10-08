import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { database } from './settings.js'
import { createBetterAuth, createBetterAuthAdmin } from './better-auth.js'

test('Postgres schema supports account management, login, password revocation and deletion', async () => {
  const client = new pg.Client({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
  await client.connect()
  try {
    await client.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
    await client.query('BEGIN')
    const schema = `auth_test_${randomUUID().replaceAll('-', '')}`
    await client.query(readFileSync(new URL('./better-auth-schema.sql', import.meta.url), 'utf8').replaceAll('cloudpeak_auth', schema))
    let sequence = 0
    const pool = {
      query: (sql, args) => client.query(sql, args),
      async connect() {
        let savepoint
        return { release() {}, async query(sql, args) {
          if (sql.toLowerCase() === 'begin') { savepoint = `nested_${++sequence}`; return client.query(`SAVEPOINT ${savepoint}`) }
          if (sql.toLowerCase() === 'commit') return client.query(`RELEASE SAVEPOINT ${savepoint}`)
          if (sql.toLowerCase() === 'rollback') return client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          return client.query(sql, args)
        } }
      },
      async end() {},
    }
    const auth = createBetterAuth(pool, { BETTER_AUTH_SECRET: 'isolated-test-secret-with-more-than-32-chars', BETTER_AUTH_URL: 'https://app.example/railway-api/api/auth', ALLOWED_ORIGINS: 'https://app.example' })
    const admin = createBetterAuthAdmin(pool)
    const created = await admin.createUser({ email: 'client@example.com', password: 'first-password', user_metadata: { name: 'Test client', phone: '555' }, app_metadata: { must_change_password: true } })
    assert.equal(created.error, null)
    const id = created.data.user.id
    assert.match(id, /^[0-9a-f-]{36}$/)
    const call = (path, body) => auth.handler(new Request(`https://app.example/railway-api/api/auth/${path}`, { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    const first = await call('sign-in/email', { email: 'client@example.com', password: 'first-password' })
    assert.equal(first.status, 200)
    const headers = new Headers({ authorization: `Bearer ${first.headers.get('set-auth-token')}` })
    assert.equal((await auth.api.getSession({ headers })).user.id, id)
    const updated = await admin.updateUserById(id, { password: 'second-password', app_metadata: { must_change_password: false } })
    assert.equal(updated.error, null)
    assert.equal(await auth.api.getSession({ headers }), null)
    assert.equal((await call('sign-in/email', { email: 'client@example.com', password: 'first-password' })).status, 401)
    const second = await call('sign-in/email', { email: 'client@example.com', password: 'second-password' })
    assert.equal(second.status, 200)
    assert.equal(updated.data.user.app_metadata.must_change_password, false)
    assert.equal((await admin.listUsers({ page: 1, perPage: 1000 })).data.users.length, 1)
    assert.equal((await admin.deleteUser(id)).error, null)
    assert.equal(await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${second.headers.get('set-auth-token')}` }) }), null)
    assert.equal((await client.query('SELECT * FROM account')).rowCount, 0)
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})
