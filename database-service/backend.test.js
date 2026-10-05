import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { database } from './settings.js'
import { syncVerifiedProfile, listAuthUsers } from './backend-db.js'
import { createMailer } from './mail.js'
import { createActions, verifyWebhook } from './actions.js'

// All integration writes are rolled back on the existing Railway test copy.
// Auth and Resend are injected doubles: no account changes or real messages.
async function fixture(work) {
  const client = new pg.Client({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
  await client.connect()
  await client.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  await client.query('BEGIN')
  await client.query(`CREATE TABLE IF NOT EXISTS cloudpeak_internal.user_directory (
    id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    email text NOT NULL,name text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now())`)
  await client.query('ALTER TABLE cloudpeak_internal.email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now()')
  let sequence = 0
  const pool = {
    query: (sql, args) => client.query(sql, args),
    async connect() {
      let savepoint = null
      return {
        async query(sql, args) {
          if (sql === 'BEGIN') { savepoint = `nested_${++sequence}`; return client.query(`SAVEPOINT ${savepoint}`) }
          if (sql === 'COMMIT') { const name = savepoint; savepoint = null; return name ? client.query(`RELEASE SAVEPOINT ${name}`) : {} }
          if (sql === 'ROLLBACK') { const name = savepoint; savepoint = null; if (name) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); return client.query(`RELEASE SAVEPOINT ${name}`) } return {} }
          return client.query(sql, args)
        }, release() {},
      }
    },
  }
  try { await work(pool) } finally { await client.query('ROLLBACK'); await client.end() }
}
const adminContext = { user: { id: randomUUID(), email: 'admin@example.invalid' }, role: 'cloudpeak_admin' }
const previewEnv = { EMAIL_MODE: 'preview', AUTH_WRITES_ENABLED: 'false', ADMIN_EMAILS: 'admin@example.invalid', PORTAL_URL: 'http://127.0.0.1:5173/' }
const forbiddenNetwork = () => { throw new Error('Unexpected external side effect') }

test('user directory stays in Railway and preserves roles without storing authentication data', async () => fixture(async pool => {
  const user = { id: randomUUID(), email: 'Directory@Example.invalid', user_metadata: { name: 'Directory Test', phone: '555-0100', role: 'admin', password: 'DO_NOT_COPY' } }
  assert.equal(await syncVerifiedProfile(pool, user), 'cloudpeak_user')
  const actions = createActions({ pool, env: previewEnv, mail: {}, authAdmin: new Proxy({}, { get: forbiddenNetwork }) })
  const result = await actions.invoke('list-client-users', {}, adminContext)
  const saved = result.users.find(row => row.id === user.id)
  assert.deepEqual(saved, { id: user.id, email: 'directory@example.invalid', role: 'client', name: 'Directory Test', phone: '555-0100' })
  assert.ok(!JSON.stringify(result).includes('DO_NOT_COPY'))
  await pool.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [user.id])
  assert.equal(await syncVerifiedProfile(pool, { ...user, user_metadata: { name: 'Updated' } }), 'cloudpeak_admin')
  await pool.query('DELETE FROM public.profiles WHERE id=$1', [user.id])
  assert.equal((await pool.query('SELECT 1 FROM cloudpeak_internal.user_directory WHERE id=$1', [user.id])).rowCount, 0)
}))

test('preview events do not suppress live delivery; campaign queues drain without replaying previews', async () => fixture(async pool => {
  const payload = { from: 'noreply@cloudpeaksilverlabradors.com', to: 'queue@example.invalid', subject: 'Queue test', text: 'Hello' }
  const preview = createMailer({ pool, env: previewEnv, fetchImpl: forbiddenNetwork })
  await preview.send(payload, 'event/test')
  let calls = 0
  const env = { EMAIL_MODE: 'live', RESEND_API_KEY: 'fake', EMAIL_ALLOWED_RECIPIENTS: payload.to }
  const live = createMailer({ pool, env, fetchImpl: async () => { calls++; return Response.json({ id: `test_${randomUUID()}` }) } })
  const real = await live.send(payload, 'event/test')
  assert.equal(real.status, 'sent')
  assert.equal(calls, 1)
  const action = createActions({ pool, env, mail: live })
  const result = await action.invoke('send-waitlist-campaign', { audience: 'custom', recipients: [payload.to], subject: 'Queued campaign', message: 'Hello' }, adminContext)
  assert.equal(result.queued, 1)
  assert.equal(result.sent, 0)
  assert.equal(calls, 1)
  await live.drain()
  await live.drain()
  assert.equal(calls, 2)
  await pool.query("INSERT INTO cloudpeak_internal.email_outbox(dedupe_key,payload,status,created_at) VALUES('legacy-preview',$1,'preview',now()-interval '2 days')", [JSON.stringify(payload)])
  assert.equal((await live.send(payload, 'legacy-preview')).status, 'sent')
  assert.equal(calls, 3)
  await assert.rejects(live.send({ ...payload, to: 'customer@example.invalid' }), error => error.status === 409)
  const previewJob = (await pool.query("SELECT status FROM cloudpeak_internal.email_outbox WHERE dedupe_key='preview/event/test'")).rows[0]
  assert.equal(previewJob.status, 'preview')
}))

test('provider rate limits defer durable delivery and retry the same idempotency key', async () => fixture(async pool => {
  let calls = 0
  const keys = []
  const mail = createMailer({ pool, env: { EMAIL_MODE: 'live', RESEND_API_KEY: 'fake' }, fetchImpl: async (_url, request) => {
    keys.push(request.headers['Idempotency-Key'])
    return ++calls === 1 ? Response.json({}, { status: 429 }) : Response.json({ id: `rate_${randomUUID()}` })
  } })
  const result = await mail.send({ from: 'noreply@cloudpeaksilverlabradors.com', to: 'rate@example.invalid', subject: 'Rate test', text: 'Hello' })
  assert.equal(result.queued, true)
  await mail.drain()
  assert.equal(calls, 1)
  await pool.query("UPDATE cloudpeak_internal.email_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [result.job_id])
  await mail.drain()
  assert.equal(calls, 2)
  assert.equal(keys[0], keys[1])
}))

test('hosted staging blocks mutations to accounts outside the disposable allowlist', async () => fixture(async pool => {
  const env = { ...previewEnv, AUTH_WRITES_ENABLED: 'true', AUTH_ALLOWED_EMAILS: 'approved@example.invalid' }
  const actions = createActions({ pool, env, mail: createMailer({ pool, env, fetchImpl: forbiddenNetwork }), authAdmin: new Proxy({}, { get: forbiddenNetwork }) })
  for (const name of ['create-client-user', 'delete-client-user']) await assert.rejects(actions.invoke(name, { email: 'real-client@example.invalid', password: 'long-password' }, adminContext), error => error.status === 409)
  await assert.rejects(actions.invoke('complete-first-password-change', { password: 'long-password' }, { user: { email: 'real-client@example.invalid' }, role: 'cloudpeak_user' }), error => error.status === 409)
}))

test('profile synchronization ignores editable roles, preserves Railway roles, rejects tombstoned accounts', async () => fixture(async pool => {
  const user = { id: randomUUID(), email: 'test@example.invalid', user_metadata: { role: 'admin' } }
  assert.equal(await syncVerifiedProfile(pool, user), 'cloudpeak_user')
  await pool.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [user.id])
  assert.equal(await syncVerifiedProfile(pool, user), 'cloudpeak_admin')
  await pool.query('INSERT INTO cloudpeak_internal.deleted_accounts(id) VALUES($1)', [user.id])
  await assert.rejects(syncVerifiedProfile(pool, user), error => error.status === 403)
}))

test('Auth user listing paginates past 1000 users', async () => {
  const calls = []
  const users = await listAuthUsers({ async listUsers({ page }) { calls.push(page); return { data: { users: Array.from({ length: page === 1 ? 1000 : 2 }, (_, index) => ({ id: `${page}/${index}` })) } } } })
  assert.equal(users.length, 1002)
  assert.deepEqual(calls, [1, 2])
})

test('preview actions enforce admin access and block all real Auth mutations', async () => fixture(async pool => {
  const mail = createMailer({ pool, env: previewEnv, fetchImpl: forbiddenNetwork })
  const actions = createActions({ pool, env: previewEnv, mail, authAdmin: new Proxy({}, { get: forbiddenNetwork }), fetchImpl: forbiddenNetwork })
  const client = { user: { id: randomUUID(), email: 'client@example.invalid' }, role: 'cloudpeak_user' }
  for (const name of ['create-client-user', 'delete-client-user', 'send-email-reply', 'send-waitlist-campaign', 'email-previews', 'retry-email', 'list-client-users']) {
    await assert.rejects(actions.invoke(name, {}, client), error => error.status === 403)
    await assert.rejects(actions.invoke(name, {}, { user: null, role: 'cloudpeak_anon' }), error => error.status === 401)
  }
  for (const name of ['create-client-user', 'delete-client-user', 'complete-first-password-change']) await assert.rejects(actions.invoke(name, {}, adminContext), error => error.status === 409)
  const result = await actions.invoke('send-client-portal-credentials', { clientEmail: 'client@example.invalid', password: 'MUST_NOT_BE_STORED', clientName: '<script>unsafe</script>' }, adminContext)
  assert.equal(result.preview, true)
  const previews = await actions.invoke('email-previews', {}, adminContext)
  const serialized = JSON.stringify(previews)
  assert.ok(!serialized.includes('MUST_NOT_BE_STORED'))
  assert.ok(!serialized.includes('<script>'))
  await assert.rejects(actions.invoke('send-client-portal-credentials', { clientEmail: 'client@example.invalid', portalUrl: 'https://evil.example/' }, adminContext), error => error.status === 400)
}))

test('campaigns deduplicate recipients and preview without calling Resend; replies preserve HTML escaping', async () => fixture(async pool => {
  const mail = createMailer({ pool, env: previewEnv, fetchImpl: forbiddenNetwork })
  const actions = createActions({ pool, env: previewEnv, mail, fetchImpl: forbiddenNetwork })
  const result = await actions.invoke('send-waitlist-campaign', { audience: 'custom', recipients: ['a@example.invalid', 'A@example.invalid', 'b@example.invalid'], subject: 'Test', message: 'Hello **test**' }, adminContext)
  assert.equal(result.sent, 0)
  assert.equal(result.preview_count, 2)
  assert.equal(result.total, 2)
  const reply = await actions.invoke('send-email-reply', { to: 'a@example.invalid', subject: 'Reply test', message: '<script>alert(1)</script>' }, adminContext)
  assert.equal(reply.preview, true)
  const payload = (await pool.query('SELECT payload FROM cloudpeak_internal.email_outbox WHERE id=$1', [reply.job_id])).rows[0].payload
  assert.ok(!payload.html.includes('<script>'))
  await assert.rejects(actions.invoke('send-waitlist-campaign', { audience: "litter:1 OR true", subject: 'X', message: 'Y' }, adminContext), error => error.status === 400)
}))

test('public application notices only use stored recent records and deduplicate mail jobs', async () => fixture(async pool => {
  const email = `${randomUUID()}@example.invalid`
  await pool.query("INSERT INTO public.applications(first_name,last_name,email,status) VALUES('Test','Applicant',$1,'new')", [email])
  const mail = createMailer({ pool, env: previewEnv, fetchImpl: forbiddenNetwork })
  const actions = createActions({ pool, env: previewEnv, mail, fetchImpl: forbiddenNetwork })
  const payload = { email, first_name: 'Test', last_name: 'Applicant', other_questions: 'FORGED CONTENT' }
  const context = { user: null, role: 'cloudpeak_anon' }
  await actions.invoke('notify-application', payload, context)
  await actions.invoke('notify-application', payload, context)
  const rows = (await pool.query("SELECT payload FROM cloudpeak_internal.email_outbox WHERE payload->>'subject'='New puppy application — Test Applicant'")).rows
  assert.equal(rows.length, 1)
  assert.ok(!JSON.stringify(rows).includes('FORGED CONTENT'))
  await assert.rejects(actions.invoke('notify-application', { ...payload, email: 'missing@example.invalid' }, context), error => error.status === 404)
}))

test('live mail uses durable idempotency and Railway history, reports provider failures accurately', async () => fixture(async pool => {
  let sent = 0
  const requests = []
  const env = { EMAIL_MODE: 'live', RESEND_API_KEY: 'injected-test-only' }
  const mail = createMailer({ pool, env, fetchImpl: async (_url, options) => { sent++; requests.push(options); return Response.json({ id: `fake_${randomUUID()}` }) } })
  const payload = { from: 'Cloud Peak <noreply@cloudpeaksilverlabradors.com>', to: 'test@example.invalid', subject: 'Idempotent test', html: '<p>test</p>' }
  const first = await mail.send(payload, 'unique-test-key')
  const second = await mail.send(payload, 'unique-test-key')
  assert.equal(first.job_id, second.job_id)
  assert.equal(sent, 1)
  assert.equal(requests[0].headers['Idempotency-Key'], `cloudpeak/${first.job_id}`)
  assert.equal((await pool.query('SELECT id FROM public.emails WHERE resend_id=$1', [first.data.id])).rowCount, 1)
  const failedMailer = createMailer({ pool, env, fetchImpl: async () => Response.json({ message: 'Private provider detail' }, { status: 422 }) })
  await assert.rejects(failedMailer.send(payload, 'failed-test-key'), error => error.status === 502 && !error.message.includes('Private provider detail'))
  assert.equal((await pool.query("SELECT status FROM cloudpeak_internal.email_outbox WHERE dedupe_key='failed-test-key'")).rows[0].status, 'failed')
}))

test('webhook verification rejects tampering, stale signatures, wrong versions', () => {
  const secret = Buffer.from('test-only-signing-key').toString('base64'), raw = JSON.stringify({ type: 'email.received' }), id = 'test-webhook'
  const timestamp = String(Math.floor(Date.now()/1000))
  const signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64')
  const headers = new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` })
  assert.equal(verifyWebhook(raw, headers, `whsec_${secret}`), true)
  assert.equal(verifyWebhook(`${raw} `, headers, secret), false)
  assert.equal(verifyWebhook(raw, headers, secret, Date.now()+301000), false)
  headers.set('svix-signature', `v2,${signature}`)
  assert.equal(verifyWebhook(raw, headers, secret), false)
})

test('enabled account actions use only Auth admin and Railway profiles; omitted roles stay unchanged', async () => fixture(async pool => {
  const created = { id: randomUUID(), email: 'account-test@example.invalid', app_metadata: {}, user_metadata: {} }
  let existing = false
  const writes = []
  const authAdmin = {
    async listUsers() { return { data: { users: existing ? [created] : [] } } },
    async createUser(payload) { writes.push(['create', payload]); existing = true; return { data: { user: created } } },
    async updateUserById(id, payload) { writes.push(['update', id, payload]); return { data: { user: created } } },
    async deleteUser() { throw new Error('Unexpected Auth deletion') },
  }
  const env = { ...previewEnv, AUTH_WRITES_ENABLED: 'true' }
  const mail = createMailer({ pool, env, fetchImpl: forbiddenNetwork })
  const actions = createActions({ pool, env, mail, authAdmin, fetchImpl: forbiddenNetwork })
  const result = await actions.invoke('create-client-user', { email: created.email, password: 'temporary-test-password', role: 'admin', name: 'Test account' }, adminContext)
  assert.equal(result.created, true)
  assert.equal((await pool.query('SELECT role FROM public.profiles WHERE id=$1', [created.id])).rows[0].role, 'admin')
  await actions.invoke('create-client-user', { email: created.email, name: 'Updated name' }, adminContext)
  assert.equal((await pool.query('SELECT role FROM public.profiles WHERE id=$1', [created.id])).rows[0].role, 'admin')
  assert.equal(writes[0][1].app_metadata.must_change_password, true)
  await actions.invoke('complete-first-password-change', { password: 'changed-test-password' }, { user: created, role: 'cloudpeak_admin' })
  assert.equal(writes.at(-1)[1], created.id)
  assert.equal(writes.at(-1)[2].app_metadata.must_change_password, false)
  await assert.rejects(actions.invoke('delete-client-user', { email: created.email }, adminContext), error => error.status === 400)
}))

test('client waitlist policy rejects a puppy outside the assigned litter', async () => fixture(async pool => {
  const email = `${randomUUID()}@example.invalid`, userId = randomUUID()
  const litter = (await pool.query("SELECT litter_id,id FROM public.puppies WHERE status='available' AND litter_id IS NOT NULL LIMIT 1")).rows[0]
  const other = (await pool.query('SELECT id FROM public.puppies WHERE litter_id<>$1 LIMIT 1', [litter.litter_id])).rows[0]
  const entry = (await pool.query('INSERT INTO public.waitlist(name,email,litter_id,is_active) VALUES($1,$2,$3,true) RETURNING id', ['Test client', email, litter.litter_id])).rows[0]
  const client = await pool.connect()
  await client.query('BEGIN')
  try {
    await client.query('SET LOCAL ROLE cloudpeak_user')
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, email })])
    assert.equal((await client.query('UPDATE public.waitlist SET selected_puppy_id=$2 WHERE id=$1', [entry.id, litter.id])).rowCount, 1)
    await assert.rejects(client.query('UPDATE public.waitlist SET selected_puppy_id=$2 WHERE id=$1', [entry.id, other.id]), error => error.code === '42501')
  } finally { await client.query('ROLLBACK'); client.release() }
}))

test('inbound retry stores one email and forwards once across duplicate deliveries', async () => fixture(async pool => {
  const secret = Buffer.from('test-webhook-key').toString('base64'), emailId = `test_${randomUUID()}`
  const raw = JSON.stringify({ type: 'email.received', data: { email_id: emailId } })
  const timestamp = String(Math.floor(Date.now()/1000)), eventId = `event_${randomUUID()}`
  const signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64')
  const headers = new Headers({ 'svix-id': eventId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` })
  const env = { EMAIL_MODE: 'live', RESEND_API_KEY: 'fake-key', RESEND_WEBHOOK_SECRET: secret, FORWARD_TO_EMAIL: 'forward@example.invalid' }
  let sent = 0
  const fetchImpl = async url => url.includes('/receiving/') ? Response.json({ from: 'source@example.invalid', to: ['inbox@example.invalid'], subject: 'Inbound test', text: 'Hello' }) : (sent++, Response.json({ id: `sent_${randomUUID()}` }))
  const mail = createMailer({ pool, env, fetchImpl })
  const actions = createActions({ pool, env, mail, fetchImpl })
  const context = { user: null, role: 'cloudpeak_anon' }
  assert.equal((await actions.invoke('receive-inbound-email', JSON.parse(raw), context, raw, headers)).duplicate, false)
  assert.equal((await actions.invoke('receive-inbound-email', JSON.parse(raw), context, raw, headers)).duplicate, true)
  assert.equal((await pool.query('SELECT id FROM public.emails WHERE resend_id=$1', [emailId])).rowCount, 1)
  assert.equal(sent, 1)
  const historicalId = `historical_${randomUUID()}`
  await pool.query("INSERT INTO public.emails(direction,resend_id,from_email,to_email,subject) VALUES('inbound',$1,'source@example.invalid','inbox@example.invalid','Already copied')", [historicalId])
  const historicalRaw = JSON.stringify({ type: 'email.received', data: { email_id: historicalId } })
  const historicalSignature = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${eventId}.${timestamp}.${historicalRaw}`).digest('base64')
  headers.set('svix-signature', `v1,${historicalSignature}`)
  assert.equal((await actions.invoke('receive-inbound-email', JSON.parse(historicalRaw), context, historicalRaw, headers)).duplicate, true)
  assert.equal((await pool.query('SELECT id FROM public.emails WHERE resend_id=$1', [historicalId])).rowCount, 1)
  assert.equal(sent, 1)
}))
