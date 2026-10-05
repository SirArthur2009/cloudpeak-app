import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const app = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'))
const storage = parseEnv(readFileSync(resolve(root, 'storage-service/.env'), 'utf8'))
const key = storage.SUPABASE_SERVICE_ROLE_KEY || app.VITE_SUPABASE_SERVICE_KEY
if (!key) throw new Error('A local Supabase service-role key is needed for private file migration.')
const child = spawn(process.execPath, ['migrate.js', process.argv[2] || '--plan'], {
  cwd: resolve(root, 'storage-service'), stdio: 'inherit',
  env: { ...process.env, ...storage, SUPABASE_SERVICE_ROLE_KEY: key },
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code || 0 })
process.on('SIGINT', () => child.kill())
