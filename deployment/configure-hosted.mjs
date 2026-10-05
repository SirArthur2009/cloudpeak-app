import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cli = process.env.RAILWAY_CLI_BIN
if (!cli) throw new Error('Set RAILWAY_CLI_BIN to the installed official Railway executable.')
const readEnv = async path => parseEnv(await readFile(resolve(root,path),'utf8'))
const app = await readEnv('.env')
const database = await readEnv('database-service/.env')
const storage = await readEnv('storage-service/.env')
const privateUrl = value => { const url = new URL(value); url.hostname='postgres.railway.internal'; url.port='5432'; return url.href }
const variables = {
  APP_ORIGIN:'https://cloudpeak-hosted-test-production.up.railway.app',
  WEBSITE_ORIGIN:'https://cloudpeak-hosted-test-production-0e41.up.railway.app',
  DATABASE_URL:privateUrl(database.DATABASE_URL), API_DATABASE_URL:privateUrl(database.API_DATABASE_URL),
  SUPABASE_URL:app.VITE_SUPABASE_URL, SUPABASE_ANON_KEY:app.VITE_SUPABASE_ANON_KEY,
  ...(app.SUPABASE_PREVIOUS_ANON_KEY ? { SUPABASE_PREVIOUS_ANON_KEY: app.SUPABASE_PREVIOUS_ANON_KEY } : {}),
  EMAIL_MODE:'preview', AUTH_WRITES_ENABLED:'false', PORT:'8080',
}
for (const key of ['AWS_ENDPOINT_URL','AWS_DEFAULT_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_S3_BUCKET_NAME','S3_FORCE_PATH_STYLE']) if (storage[key]) variables[key] = storage[key]
const serviceKey = database.SUPABASE_SERVICE_ROLE_KEY || app.SUPABASE_SERVICE_ROLE_KEY
if (serviceKey) variables.SUPABASE_SERVICE_ROLE_KEY = serviceKey
variables.HOSTED_MODE = 'test'
variables.LIVE_ACTIONS_APPROVED = 'false'
if (process.argv.includes('--staging')) {
  const release = await readEnv('deployment/.env.release')
  if (!release.RESEND_API_KEY || !release.RESEND_WEBHOOK_SECRET) throw new Error('Prepare the disabled Resend receiver first.')
  Object.assign(variables, release, { HOSTED_MODE: 'staging', LIVE_ACTIONS_APPROVED: 'true', EMAIL_ALLOWED_RECIPIENTS: 'levigbryan@gmail.com', AUTH_ALLOWED_EMAILS: 'levigbryan+cloudpeak-test@gmail.com' })
}
if (process.argv.includes('--live')) {
  if (!process.argv.includes('--approve-live-cutover')) throw new Error('Live configuration requires explicit cutover approval.')
  const release = await readEnv('deployment/.env.release')
  if (!release.RESEND_API_KEY || !release.RESEND_WEBHOOK_SECRET) throw new Error('Prepare the Resend receiver first.')
  Object.assign(variables, release, {
    HOSTED_MODE: 'live', LIVE_ACTIONS_APPROVED: 'true', EMAIL_ALLOWED_RECIPIENTS: '', AUTH_ALLOWED_EMAILS: '',
    APP_ORIGIN: 'https://portal.cloudpeaksilverlabradors.com', WEBSITE_ORIGIN: 'https://cloudpeaksilverlabradors.com',
    APP_ALIASES: 'https://cloudpeak-hosted-test-production.up.railway.app', WEBSITE_ALIASES: 'https://cloudpeak-hosted-test-production-0e41.up.railway.app',
    FORWARD_TO_EMAIL: app.FORWARD_TO_EMAIL || 'cloudpeaksilverlabs@yahoo.com',
  })
  // Move the existing receiver at cutover rather than subscribing twice.
  const sourceWebhook = await readEnv('deployment/.env.source-webhook')
  if (!sourceWebhook.RESEND_WEBHOOK_SECRET) throw new Error('Existing receiver signing secret is missing.')
  variables.RESEND_WEBHOOK_SECRET = sourceWebhook.RESEND_WEBHOOK_SECRET
}
const input = { projectId:'ba2498be-e030-473a-81b4-a14d05dd8120', environmentId:'bd380cbe-c04c-4174-a8b7-5e126c99dc06', serviceId:'11612220-77f2-4c35-85c9-dd99d1b0cb1b', skipDeploys:true, variables }
const mutation = 'mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}'
const child = spawn(cli,['api',mutation,'--variables','@-','--compact'],{stdio:['pipe','pipe','pipe']})
let stdout=''
child.stdout.on('data',chunk => { stdout += chunk })
// Do not echo provider errors or variables, which could contain credentials.
child.stderr.resume()
child.stdin.end(JSON.stringify({input}))
const code = await new Promise((resolve,reject) => { child.on('error',reject); child.on('close',resolve) })
let result
try { result = JSON.parse(stdout) } catch { throw new Error('Railway variable update failed; no credentials printed.') }
if (code !== 0 || result.errors || result.data?.variableCollectionUpsert !== true) throw new Error('Railway variable update failed; no credentials printed.')
console.log(`Configured ${Object.keys(variables).length} server variables on the hosted test only.`)
