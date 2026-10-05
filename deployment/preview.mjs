import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { parseEnv } from 'node:util'
import { createGateway } from './gateway.mjs'

const root = resolve(import.meta.dirname, '..')
const { path } = JSON.parse(await readFile(resolve(root, 'deployment/bundle/latest.json'), 'utf8'))
const bundle = resolve(path)
if (!bundle.startsWith(resolve(root, 'deployment/bundle') + sep)) throw new Error('Invalid prepared bundle path.')
const health = await fetch('http://127.0.0.1:3002/health', {signal:AbortSignal.timeout(5000)}).then(async response => response.ok ? response.json() : null)
if (!health || health.emailMode !== 'preview' || health.authWrites !== false) throw new Error('Start npm run dev:railway first with email previews and blocked account changes.')
const app = parseEnv(await readFile(resolve(root, '.env'), 'utf8'))
const config = { appOrigin:'http://127.0.0.1:5179', websiteOrigin:'http://127.0.0.1:5180', appRoot:resolve(bundle,'public/app'), websiteRoot:resolve(bundle,'public/website'), dataUrl:'http://127.0.0.1:3002', storageUrl:'http://127.0.0.1:3005', supabaseUrl:app.VITE_SUPABASE_URL, upstreamOrigin:'http://127.0.0.1:5173' }
const servers = [createGateway(config),createGateway(config)]
for (const [index, server] of servers.entries()) server.listen(5179+index,'127.0.0.1')
console.log('Built deployment preview: app http://127.0.0.1:5179; website http://127.0.0.1:5180. Uses the existing Railway local backend.')
for (const server of servers) server.on('error', error => { console.error(error.code); for (const current of servers) current.close(); process.exitCode=1 })
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { for (const server of servers) server.close() })
