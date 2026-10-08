import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createGateway } from './gateway.mjs'
import { hostedRuntimeConfig } from './runtime-config.mjs'

const root = resolve(import.meta.dirname, '..')
for (const name of ['APP_ORIGIN','WEBSITE_ORIGIN','DATABASE_URL','API_DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY']) if (!process.env[name]) throw new Error(`Missing ${name}`)
for (const name of ['APP_ORIGIN','WEBSITE_ORIGIN']) {
  const url = new URL(process.env[name])
  if (url.protocol !== 'https:' || url.origin !== process.env[name]) throw new Error(`${name} must be an exact HTTPS origin without a trailing slash.`)
}
const env = hostedRuntimeConfig(process.env)
const children = [spawn(process.execPath, ['database-service/server.js'], { cwd: root, stdio: 'inherit', env }), spawn(process.execPath, ['storage-service/server.js'], { cwd: root, stdio: 'inherit', env: { ...env, PORT: '3005', DATA_API_URL: 'http://127.0.0.1:3002' } })]
const gateway = createGateway({ appOrigin: env.APP_ORIGIN, websiteOrigin: env.WEBSITE_ORIGIN, appAliases: (env.APP_ALIASES || '').split(',').filter(Boolean), websiteAliases: (env.WEBSITE_ALIASES || '').split(',').filter(Boolean), appRoot: resolve(root, 'public/app'), websiteRoot: resolve(root, 'public/website'), dataUrl: 'http://127.0.0.1:3002', storageUrl: 'http://127.0.0.1:3005', supabaseUrl: env.SUPABASE_URL, trustRailwayProxy: true })
gateway.listen(Number(env.PORT || 8080), '0.0.0.0', () => console.log(`Hosted gateway started; email ${env.EMAIL_MODE}; Auth writes ${env.AUTH_WRITES_ENABLED}.`))
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; gateway.close(); for (const child of children) child.kill(); process.exitCode = code }
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', () => stop(1)) }
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop())
