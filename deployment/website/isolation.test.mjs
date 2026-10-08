import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { createGateway } from '../gateway.mjs'

test('website stays ready and serves pages and assets through backend failure and recovery', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cloudpeak-isolation-'))
  await mkdir(join(dir, 'css'))
  for (const [name, value] of Object.entries({ 'index.html': '<h1>Cloud Peak</h1>', 'header.html': '<nav>Home</nav>', 'css/style.css': 'body{color:blue}', 'robots.txt': 'User-agent: *', 'release.json': '{"service":"website"}' })) await writeFile(join(dir, name), value)
  let backendDown = false
  const calls = []
  const server = createGateway({
    websiteOnly: true, appOrigin: 'https://portal.example', websiteOrigin: 'https://web.example',
    appRoot: join(dir, 'unused'), websiteRoot: dir, websiteAliases: ['https://preview.example'],
    dataUrl: 'https://portal.example/railway-api', storageUrl: 'https://portal.example/railway-storage',
    supabaseUrl: 'https://old.example', upstreamOrigin: 'https://web.example',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (backendDown) throw new Error('Backend crashed')
      return new Response('[{"photo_url":"https://portal.example/railway-storage/functions/v1/storage-files/public/puppy-photos/photo.jpg"}]', { headers: { 'content-type': 'application/json' } })
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }) })
  const get = (path, host = 'web.example', headers = {}) => new Promise((resolve, reject) => {
    request(`http://127.0.0.1:${server.address().port}${path}`, { headers: { host, ...headers } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    }).on('error', reject).end()
  })
  const photo = await get('/railway-api/rest/v1/puppy_photos', 'preview.example', { origin: 'https://preview.example' })
  assert.match(photo.body, /https:\/\/preview\.example\/railway-storage/)
  assert.equal(calls[0].init.headers.origin, 'https://web.example')
  backendDown = true
  assert.equal((await get('/railway-api/rest/v1/puppies')).status, 502)
  assert.equal((await get('/railway-storage/functions/v1/storage-files/public/photo.jpg')).status, 502)
  const count = calls.length
  for (const path of ['/', '/header.html', '/css/style.css', '/robots.txt', '/release.json', '/cloudpeak-test-config.js']) assert.equal((await get(path)).status, 200, path)
  assert.deepEqual(JSON.parse((await get('/health', 'railway-healthcheck')).body), { ok: true, service: 'website' })
  assert.equal(calls.length, count, 'static requests and readiness never contact the backend')
  assert.equal((await get('/', 'portal.example')).status, 421)
  assert.equal((await get('/.env')).status, 404)
  assert.equal((await get('/railway-api/rest/v1/puppies', 'web.example', { origin: 'https://evil.example' })).status, 403)
  backendDown = false
  assert.equal((await get('/railway-api/rest/v1/puppies')).status, 200)
  assert.equal((await get('/')).status, 200)
})
