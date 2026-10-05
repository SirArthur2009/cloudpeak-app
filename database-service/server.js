import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { SignJWT } from 'jose'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { app, database, tables } from './settings.js'
import { installBackend, syncVerifiedProfile } from './backend-db.js'
import { createMailer } from './mail.js'
import { createActions, actionNames } from './actions.js'

if (!database.API_DATABASE_URL) throw new Error('Complete the isolated database copy first.')
const ssl = { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined }
const check = new pg.Client({ connectionString: database.DATABASE_URL, ssl })
await check.connect()
await check.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
await check.end()
const pool = new pg.Pool({ connectionString: database.API_DATABASE_URL, ssl, max: 4 })
const backendPool = new pg.Pool({ connectionString: database.DATABASE_URL, ssl, max: 3 })
await installBackend(backendPool)
const auth = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const serviceKey = database.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || app.SUPABASE_SERVICE_ROLE_KEY
const admin = serviceKey ? createClient(app.VITE_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin : null
const backendEnv = { ...database, ...process.env, PORTAL_URL: process.env.PORTAL_URL || database.PORTAL_URL || 'http://127.0.0.1:5173/' }
const mail = createMailer({ pool: backendPool, env: backendEnv })
const actions = createActions({ pool: backendPool, authAdmin: admin, mail, env: backendEnv })
const deliveryTimer = setInterval(() => { mail.drain().catch(() => console.error('Email queue unavailable.')) }, 2000)
deliveryTimer.unref()
const jwtSecret = randomBytes(32)
const port = Number(process.env.DATA_API_PORT || 3002)
const restPort = Number(process.env.REST_PORT || 3003)
const restUrl = `http://127.0.0.1:${restPort}`
const apiUrl = new URL(database.API_DATABASE_URL)
apiUrl.searchParams.set('sslmode', 'verify-ca')
apiUrl.searchParams.set('sslrootcert', resolve(import.meta.dirname, 'database-ca.pem'))
const rest = spawn(process.env.POSTGREST_BIN || resolve(import.meta.dirname, process.platform === 'win32' ? 'bin/postgrest.exe' : 'bin/postgrest'), [], {
  stdio: 'inherit', env: { ...process.env, PGRST_DB_URI: apiUrl.href,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'cloudpeak_anon',
    PGRST_JWT_SECRET: jwtSecret.toString('base64'), PGRST_JWT_SECRET_IS_BASE64: 'true',
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort), PGRST_DB_MAX_ROWS: '1000', PGRST_DB_POOL: '5',
  },
})
rest.on('error', error => { console.error(error.message); process.exitCode = 1; server.close() })
const origins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5177', 'http://127.0.0.1:5178'])
origins.add('http://127.0.0.1:5179'); origins.add('http://127.0.0.1:5180')
for (const origin of (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)) origins.add(new URL(origin.trim()).origin)
const actionRequests = new Map()
const server = createServer(async (request, response) => {
  const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)) }
  const origin = request.headers.origin
  if (origin && !origins.has(origin)) return send(403, { message: 'Origin is not allowed.' })
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,prefer,range,range-unit,x-client-info,accept-profile,content-profile')
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS')
    response.setHeader('Access-Control-Expose-Headers', 'Content-Range,Range-Unit,Preference-Applied')
  }
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/health') {
      const result = await fetch(`${restUrl}/puppies?select=id&limit=1`)
      await result.body?.cancel()
      return send(result.ok ? 200 : 503, { ok: result.ok, database: 'Railway', auth: 'Supabase', releaseMode: backendEnv.HOSTED_MODE || 'test', emailMode: mail.mode, authWrites: backendEnv.AUTH_WRITES_ENABLED === 'true', actionsRestricted: Boolean(backendEnv.EMAIL_ALLOWED_RECIPIENTS || backendEnv.AUTH_ALLOWED_EMAILS) })
    }
    const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)
    const action = url.pathname.match(/^\/functions\/v1\/([a-z-]+)$/)?.[1]
    if ((!match || !tables.includes(match[1])) && !actionNames.has(action)) return send(404, { message: 'Unknown data endpoint.' })
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
    let user = null, role = 'cloudpeak_anon'
    // The previous public anonymous key grants no user identity. Recognizing it
    // here lets cached website pages keep using public Railway data after the
    // legacy Supabase API keys are disabled. Private access still calls getUser.
    if (token && token !== app.VITE_SUPABASE_ANON_KEY && token !== app.SUPABASE_PREVIOUS_ANON_KEY) {
      const result = await auth.auth.getUser(token)
      if (result.error || !result.data.user) return send(401, { message: 'Supabase session is invalid or expired.' })
      user = result.data.user
      role = await syncVerifiedProfile(backendPool, user)
    }
    if (action) {
      if (request.method !== 'POST') return send(405, { error: 'Use POST for server actions.' })
      const address = request.socket.remoteAddress || 'unknown'
      const requestKey = `${address}/${user?.id || 'anonymous'}/${action}`
      const now = Date.now()
      // Bound memory even if many authenticated users call the same server.
      for (const [key, value] of actionRequests) if (now-value.start > 60000) actionRequests.delete(key)
      const window = actionRequests.get(requestKey) || { start: now, count: 0 }
      if (++window.count > 30 || actionRequests.size > 10000) return send(429, { error: 'Too many requests. Try again in a minute.' })
      actionRequests.set(requestKey, window)
      const chunks = []; let size = 0
      for await (const chunk of request) { size += chunk.length; if (size > 1024*1024) return send(413, { error: 'Request is too large.' }); chunks.push(chunk) }
      const raw = Buffer.concat(chunks).toString('utf8')
      let body
      try { body = JSON.parse(raw || '{}') } catch { return send(400, { error: 'Invalid JSON.' }) }
      return send(200, await actions.invoke(action, body, { user, role }, raw, new Headers(request.headers)))
    }
    const signed = await new SignJWT({ role, ...(user ? { sub: user.id, email: user.email } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30s').sign(jwtSecret)
    const headers = { Authorization: `Bearer ${signed}` }
    for (const name of ['accept', 'content-type', 'prefer', 'range', 'range-unit']) if (request.headers[name]) headers[name] = request.headers[name]
    let body
    if (!['GET', 'HEAD'].includes(request.method)) {
      const chunks = []; let size = 0
      for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) return send(413, { message: 'Request is too large.' }); chunks.push(chunk) }
      body = Buffer.concat(chunks)
    }
    const result = await fetch(`${restUrl}/${match[1]}${url.search}`, { method: request.method, headers, body })
    for (const name of ['content-type', 'content-range', 'range-unit', 'preference-applied']) if (result.headers.has(name)) response.setHeader(name, result.headers.get(name))
    response.writeHead(result.status)
    response.end(Buffer.from(await result.arrayBuffer()))
  } catch (error) {
    console.error('Database request failed:', error.code || error.name)
    if (!response.headersSent) send(error.status || 503, { error: error.status ? error.message : 'Railway database request failed.' })
    else response.end()
  }
})
server.listen(port, '127.0.0.1', () => console.log(`Railway test data API: http://127.0.0.1:${port} (Supabase login; email ${mail.mode})`))
let stopping = false
async function stop() { if (stopping) return; stopping = true; clearInterval(deliveryTimer); server.close(); rest.kill(); await Promise.all([pool.end(),backendPool.end()]) }
rest.on('exit', () => { stop(); process.exitCode = 1 })
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
