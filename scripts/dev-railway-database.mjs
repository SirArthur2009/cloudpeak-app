import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const preview = process.argv.includes('--preview')
const appPort = preview ? 5177 : 5173
const websitePort = preview ? 5178 : 5174
const appEnv = parseEnv(readFileSync(resolve(root,'.env'),'utf8'))
const databaseEnv = parseEnv(readFileSync(resolve(root,'database-service/.env'),'utf8'))
const authProvider = process.env.AUTH_PROVIDER || databaseEnv.AUTH_PROVIDER || 'supabase'
const storage = parseEnv(readFileSync(resolve(root,'storage-service/.env'),'utf8'))
const dataPort = preview ? 3102 : 3002
const restPort = preview ? 3103 : 3003
const storagePort = preview ? 3105 : 3005
const dataUrl = `http://127.0.0.1:${dataPort}`
const children = []
// The temporary preview can reuse a data API already started for verification.
if (!process.argv.includes('--existing-api')) children.push(spawn(process.execPath,['database-service/server.js'],{cwd:root,stdio:'inherit',env:{...process.env,AUTH_PROVIDER:authProvider,BETTER_AUTH_URL:`http://127.0.0.1:${dataPort}/api/auth`,ALLOWED_ORIGINS:`http://127.0.0.1:${appPort},http://localhost:${appPort}`,DATA_API_PORT:String(dataPort),REST_PORT:String(restPort),EMAIL_MODE:'preview',AUTH_WRITES_ENABLED:authProvider === 'better-auth' ? (databaseEnv.AUTH_WRITES_ENABLED || 'false') : 'false',PORTAL_URL:`http://127.0.0.1:${appPort}/`}}))
children.push(spawn(process.execPath,['storage-service/server.js'],{cwd:root,stdio:'inherit',env:{...process.env,...storage,AUTH_PROVIDER:authProvider,PORT:String(storagePort),DATA_API_URL:dataUrl,ALLOWED_ORIGINS:`http://127.0.0.1:${appPort},http://localhost:${appPort}`,SUPABASE_URL:appEnv.VITE_SUPABASE_URL,SUPABASE_ANON_KEY:appEnv.VITE_SUPABASE_ANON_KEY}}))
const appDataUrl = `http://127.0.0.1:${appPort}/railway-api`
children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','railway-test','--host','127.0.0.1','--port',String(appPort),'--strictPort'],{cwd:root,stdio:'inherit',env:{...process.env,VITE_AUTH_PROVIDER:authProvider,VITE_BETTER_AUTH_URL:`${appDataUrl}/api/auth`,CLOUDPEAK_DATA_PROXY_TARGET:dataUrl,CLOUDPEAK_STORAGE_PROXY_TARGET:`http://127.0.0.1:${storagePort}`,VITE_DATA_API_URL:appDataUrl,VITE_STORAGE_API_URL:`http://127.0.0.1:${appPort}/railway-storage/functions/v1/storage-files`,VITE_SUPABASE_FUNCTIONS_URL:`${appDataUrl}/functions/v1`,VITE_SUPABASE_SERVICE_KEY:''}}))
children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','scripts/website-vite.config.mjs','--host','127.0.0.1','--port',String(websitePort),'--strictPort'],{cwd:root,stdio:'inherit',env:{...process.env,CLOUDPEAK_DATA_PROXY_TARGET:dataUrl,CLOUDPEAK_TEST_DATA_API_URL:`http://127.0.0.1:${websitePort}/railway-api`}}))
console.log(`Railway database test app: http://127.0.0.1:${appPort}/\nRailway database test website: http://127.0.0.1:${websitePort}/\nAuth provider: ${authProvider}. Emails are previewed.`)
let stopping = false
function stop(code=0) {
  if(stopping) return
  stopping=true
  for(const child of children) {
    if(process.platform==='win32' && child.pid) spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'})
    else child.kill()
  }
  process.exitCode=code
}
for(const child of children) {child.on('error',error=>{console.error(error.message);stop(1)});child.on('exit',code=>stop(code||0))}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop())
