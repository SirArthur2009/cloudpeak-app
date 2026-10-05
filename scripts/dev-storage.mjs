import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const includeWebsite = process.argv.includes('--website')
const deployedStorage = process.argv.includes('--deployed-storage')
const includeStorage = !process.argv.includes('--without-storage') && !deployedStorage
const storageUrl = deployedStorage ? 'https://bvnurkvvhlmdapvhvcje.supabase.co/functions/v1/storage-files' : 'http://127.0.0.1:3001/functions/v1/storage-files'
const appEnv = existsSync(resolve(root, '.env')) ? parseEnv(readFileSync(resolve(root, '.env'), 'utf8')) : {}
const serverFile = resolve(root, 'storage-service/.env')
const storageEnv = existsSync(serverFile) ? parseEnv(readFileSync(serverFile, 'utf8')) : {}
const env = { ...process.env, ...storageEnv,
  SUPABASE_URL: storageEnv.CLOUDPEAK_SUPABASE_URL || storageEnv.SUPABASE_URL || appEnv.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: storageEnv.CLOUDPEAK_SUPABASE_ANON_KEY || storageEnv.SUPABASE_ANON_KEY || appEnv.VITE_SUPABASE_ANON_KEY,
  ALLOWED_ORIGINS: storageEnv.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173', PORT: '3001',
}
const names = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME', 'AWS_ENDPOINT_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']
const missing = names.filter(name => !env[name])
if (includeStorage && missing.length) {
  console.error(`Railway test setup needs: ${missing.join(', ')}.\nFill storage-service/.env from .env.example; credentials stay on the server.\nUse npm run dev to launch the current Supabase-backed app without Railway credentials.`)
  process.exit(1)
}
const children = [
  ...(includeStorage ? [spawn(process.execPath, ['storage-service/server.js'], { cwd: root, env, stdio: 'inherit' })] : []),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(includeStorage || deployedStorage ? ['--mode', deployedStorage ? 'storage-deployed' : 'storage-local'] : []), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: root, env: includeStorage || deployedStorage ? { ...process.env, VITE_STORAGE_API_URL: storageUrl } : process.env, stdio: 'inherit',
  }),
  ...(includeWebsite ? [spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'scripts/website-vite.config.mjs', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    cwd: root, env: process.env, stdio: 'inherit',
  })] : []),
]
if (deployedStorage) console.log(`Testing deployed Railway storage: ${storageUrl}`)
if (includeWebsite) console.log('Cloudpeak app: http://127.0.0.1:5173/\nCloudpeak website: http://127.0.0.1:5174/\nStop this launch to stop both servers.')
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => stop(code || 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
