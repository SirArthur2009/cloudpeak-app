import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { parseEnv } from 'node:util'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '..')
// A fresh directory avoids retaining old uploads or files from earlier bundles.
const bundle = resolve(root, 'deployment/bundle', new Date().toISOString().replace(/[:.]/g, '-'))
const sourceWebsite = resolve(root, '../cloudpeak-web')
const local = existsSync(resolve(root, '.env')) ? parseEnv(await readFile(resolve(root, '.env'), 'utf8')) : {}
const url = process.env.SUPABASE_URL || local.VITE_SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY || local.VITE_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Supabase public URL and anonymous key are required.')
Object.assign(process.env, { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, VITE_SUPABASE_SERVICE_KEY: '', VITE_DATA_API_URL: '/railway-api', VITE_STORAGE_API_URL: '/railway-storage/functions/v1/storage-files', VITE_SUPABASE_FUNCTIONS_URL: '/railway-api/functions/v1', VITE_PORTAL_URL: '' })
process.env.VITE_RELEASE_MODE = process.env.HOSTED_BUILD_MODE || 'test'
if (!['test','staging','live'].includes(process.env.VITE_RELEASE_MODE)) throw new Error('Invalid hosted build mode.')
await mkdir(bundle, { recursive: true })
await build({ root, mode: 'railway-hosted-test', build: { outDir: resolve(bundle, 'public/app'), emptyOutDir: true } })
const website = resolve(bundle, 'public/website')
await mkdir(website, { recursive: true })
for (const entry of await readdir(sourceWebsite, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.html')) {
    let html = await readFile(join(sourceWebsite, entry.name), 'utf8')
    if (/<head[\s>]/i.test(html)) html = html.replace(/(<head[^>]*>)/i, '$1\n<script src="/cloudpeak-test-config.js"></script>')
    await writeFile(join(website, entry.name), html)
  }
}
for (const directory of ['assets','css','js']) await cp(join(sourceWebsite, directory), join(website, directory), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => part.startsWith('.')) })
const release = { appSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), websiteSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceWebsite, encoding: 'utf8' }).trim() }
for (const directory of [resolve(bundle, 'public/app'), website]) await writeFile(join(directory, 'release.json'), JSON.stringify(release))
const files = {
  'database-service': ['server.js','settings.js','backend-db.js','backend-schema.sql','actions.js','mail.js','database-ca.pem','package.json','package-lock.json','test-authorized-account.js','send-delivery-test.js'],
  'storage-service': ['server.js','clients.js','package.json','package-lock.json'],
  'supabase/functions/storage-files': ['handler.js','policy.js'],
  'supabase/functions/_shared': ['campaignMarkdown.js'],
  deployment: ['gateway.mjs','start.mjs','runtime-config.mjs'],
}
for (const [directory, names] of Object.entries(files)) {
  await mkdir(join(bundle, directory), { recursive: true })
  for (const name of names) await cp(join(root, directory, name), join(bundle, directory, name))
}
for (const name of ['Dockerfile','railway.json','.dockerignore']) await cp(join(root, 'deployment', name), join(bundle, name))
// Assert that the known local privileged key cannot leak into frontend output.
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await scan(path)
    else {
      if (entry.name === '.env' || entry.name.startsWith('.env.') || /snapshot|report|\.sql$/.test(entry.name) && !path.endsWith('backend-schema.sql')) throw new Error('Unexpected private file in bundle.')
      if (local.VITE_SUPABASE_SERVICE_KEY && (await readFile(path)).includes(Buffer.from(local.VITE_SUPABASE_SERVICE_KEY))) throw new Error('Privileged key found in bundle.')
    }
  }
}
await scan(bundle)
await writeFile(resolve(root, 'deployment/bundle/latest.json'), JSON.stringify({ path: bundle, createdAt: new Date().toISOString(), buildMode: process.env.VITE_RELEASE_MODE, emailMode: process.env.VITE_RELEASE_MODE === 'test' ? 'preview' : 'live', authWrites: process.env.VITE_RELEASE_MODE !== 'test' }, null, 2))
console.log(`Prepared secret-free Railway bundle: ${bundle}`)
