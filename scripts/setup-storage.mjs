import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'storage-service/.env')
if (existsSync(destination)) {
  console.log('storage-service/.env already exists; preserved your settings.')
} else {
  const app = existsSync(resolve(root, '.env')) ? parseEnv(readFileSync(resolve(root, '.env'), 'utf8')) : {}
  const quoted = value => JSON.stringify(value || '')
  let source = readFileSync(resolve(root, 'storage-service/.env.example'), 'utf8')
  source = source.replace(/^SUPABASE_URL=.*$/m, `SUPABASE_URL=${quoted(app.VITE_SUPABASE_URL)}`)
    .replace(/^SUPABASE_ANON_KEY=.*$/m, `SUPABASE_ANON_KEY=${quoted(app.VITE_SUPABASE_ANON_KEY)}`)
  writeFileSync(destination, source)
  console.log('Created ignored storage-service/.env with the existing public Supabase settings. Fill the two Railway credential fields in VS Code.')
}
console.log('Run npm run dev for the current app, or npm run dev:storage after filling Railway credentials.\nStorage test page: http://localhost:5173/storage-test.html')
