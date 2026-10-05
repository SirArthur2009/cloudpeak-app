// One authorized integration test. Does not change the running app's email mode.
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { app, database } from './settings.js'
import { createMailer } from './mail.js'

if (!process.argv.includes('--send-authorized-test')) throw new Error('Explicit test-send flag required.')
const key = app.RESEND_EMAIL_API_KEY || app.RESEND_API_KEY
if (!key) throw new Error('Server-only Resend key is missing.')
const pool = new pg.Pool({ connectionString: database.DATABASE_URL, max: 1,
  ssl: { ca: await readFile(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined } })
try {
  await pool.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  const mail = createMailer({ pool, env: { EMAIL_MODE: 'live', RESEND_API_KEY: key } })
  const previous = (await pool.query("SELECT id FROM cloudpeak_internal.email_outbox WHERE dedupe_key='authorized-delivery-test/2026-10-02/levigbryan' AND status='sent'")).rows[0]
  const result = previous ? await mail.deliver(previous.id).then(item => ({status:item.status,job_id:item.id,data:{id:item.provider_id}})) : await mail.send({
    from: 'Cloud Peak Silver Labradors <noreply@cloudpeaksilverlabradors.com>',
    to: 'levigbryan@gmail.com',
    subject: 'Cloudpeak Railway delivery test',
    text: 'This is your authorized Cloudpeak email delivery test. It uses the application email service and Railway database with Resend delivery. The hosted app remains in preview mode while migration testing continues.',
  }, 'authorized-delivery-test/2026-10-02/levigbryan')
  console.log(JSON.stringify({ accepted: result.status === 'sent', jobId: result.job_id, providerId: result.data.id, hostedModeChanged: false }))
} finally { await pool.end() }
