import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const local = parseEnv(readFileSync(new URL('../storage-service/.env', import.meta.url), 'utf8'))
const deployment = parseEnv(readFileSync(new URL('../storage-service/.env.deploy', import.meta.url), 'utf8'))
Object.assign(process.env, local, { ALLOWED_ORIGINS: deployment.CLOUDPEAK_STORAGE_ALLOWED_ORIGINS })
await import('../storage-service/configure-cors.js')
