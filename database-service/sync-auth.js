import pg from 'pg'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { app, database } from './settings.js'
import { installBackend, listAuthUsers, syncVerifiedProfile } from './backend-db.js'

const key = database.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || app.SUPABASE_SERVICE_ROLE_KEY
if (!key) throw new Error('Configure the server-only SUPABASE_SERVICE_ROLE_KEY.')
const auth = createClient(app.VITE_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin
const pool = new pg.Pool({ connectionString: database.DATABASE_URL, ssl: { ca: readFileSync(new URL('./database-ca.pem', import.meta.url)), checkServerIdentity: () => undefined }, max: 2 })
try {
  await pool.query('SELECT source FROM cloudpeak_internal.test_copy LIMIT 1')
  await installBackend(pool)
  const users = await listAuthUsers(auth)
  let synchronized = 0, blocked = 0
  for (const user of users) {
    try { await syncVerifiedProfile(pool, user); synchronized++ }
    catch (error) { if (error.status === 403) blocked++; else throw error }
  }
  console.log(`Railway profiles synchronized: ${synchronized}; blocked accounts skipped: ${blocked}. Existing Railway roles preserved; no Supabase accounts changed.`)
} finally { await pool.end() }
