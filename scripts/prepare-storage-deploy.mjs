import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const app = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'))
const storage = parseEnv(readFileSync(resolve(root, 'storage-service/.env'), 'utf8'))
const secrets = {}
for (const name of ['AWS_ENDPOINT_URL', 'AWS_S3_BUCKET_NAME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION', 'S3_FORCE_PATH_STYLE']) {
  if (!storage[name]) throw new Error(`Missing local ${name}`)
  secrets[`CLOUDPEAK_STORAGE_${name}`] = storage[name]
}
const origins = new Set(['https://cloudpeaksilverlabradors.com', 'https://www.cloudpeaksilverlabradors.com', 'http://127.0.0.1:5173', 'http://localhost:5173'])
if (app.VITE_PORTAL_URL) origins.add(new URL(app.VITE_PORTAL_URL).origin)
secrets.CLOUDPEAK_STORAGE_ALLOWED_ORIGINS = [...origins].join(',')
writeFileSync(resolve(root, 'storage-service/.env.deploy'), Object.entries(secrets).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n')
console.log('Prepared scoped storage function secrets in an ignored file; no service-role key included.')
console.log(`Allowed origins: ${[...origins].join(', ')}`)
