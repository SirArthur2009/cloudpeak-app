import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGateway } from './gateway.mjs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:http'

test('Railway auth uses the edge client address and overwrites caller auth-IP headers', async t => {
  let headers
  const server = createGateway({ appOrigin: 'https://app.example', websiteOrigin: 'https://web.example', appRoot: '.', websiteRoot: '.', dataUrl: 'http://data.internal', storageUrl: 'http://storage.internal', supabaseUrl: 'https://auth.example', trustRailwayProxy: true,
    fetchImpl: async (_url, init) => { headers = init.headers; return new Response('{}', { headers: { 'content-type': 'application/json' } }) },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${server.address().port}/railway-api/api/auth/get-session`, { headers: { host: 'app.example', 'x-real-ip': '198.51.100.20', 'x-cloudpeak-client-ip': '198.51.100.10', 'x-forwarded-for': '198.51.100.30' } }, res => { res.resume(); res.on('end', resolve) })
    req.on('error', reject); req.end()
  })
  assert.equal(headers['x-cloudpeak-client-ip'], '198.51.100.20')
  assert.equal(headers['x-forwarded-for'], undefined)
})

test('auth proxy forwards bearer tokens, cookies and token response headers', async t => {
  let forwarded
  const server = createGateway({ appOrigin: 'https://app.example', websiteOrigin: 'https://web.example', appRoot: '.', websiteRoot: '.', dataUrl: 'http://data.internal', storageUrl: 'http://storage.internal', supabaseUrl: 'https://auth.example',
    fetchImpl: async (url, init) => {
      forwarded = { url, headers: init.headers }
      const headers = new Headers({ 'content-type': 'application/json', 'set-auth-token': 'test-signed-token' })
      headers.append('set-cookie', 'session=one; HttpOnly; Secure; Path=/')
      headers.append('set-cookie', 'session_data=two; HttpOnly; Secure; Path=/')
      return new Response('{}', { headers })
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${server.address().port}/railway-api/api/auth/get-session`, { headers: { host: 'app.example', authorization: 'Bearer test-token', cookie: 'session=one', 'x-cloudpeak-client-ip': '198.51.100.10', 'x-real-ip': '198.51.100.20' } }, res => {
      assert.equal(res.statusCode, 200)
      assert.equal(res.headers['set-auth-token'], 'test-signed-token')
      assert.equal(res.headers['set-cookie'].length, 2)
      res.resume(); res.on('end', resolve)
    })
    req.on('error', reject); req.end()
  })
  assert.equal(forwarded.url, 'http://data.internal/api/auth/get-session')
  assert.equal(forwarded.headers.authorization, 'Bearer test-token')
  assert.equal(forwarded.headers.cookie, 'session=one')
  assert.equal(forwarded.headers['x-cloudpeak-client-ip'], '127.0.0.1')
})

test('upload and response timeouts leave the gateway available', async t => {
  const upstream = createServer((req, res) => {
    req.resume()
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.write('partial response')
    }
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`
  const server = createGateway({ appOrigin: 'https://app.example', websiteOrigin: 'https://web.example', appRoot: '.', websiteRoot: '.', dataUrl: upstreamUrl, storageUrl: upstreamUrl, supabaseUrl: 'https://auth.example', proxyTimeoutMs: 50 })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); upstream.closeAllConnections()
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))])
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/railway-api/rest/v1/profiles`, { method: 'POST', headers: { host: 'app.example', 'content-type': 'application/json' } }, res => {
      res.resume()
      res.on('end', () => { resolve(res.statusCode); req.destroy() })
    })
    req.on('error', reject)
    req.end('{}')
  })
  assert.equal(status, 502)
  const nextStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/railway-api/rest/v1/profiles`, { headers: { host: 'app.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.end()
  })
  assert.equal(nextStatus, 502)
  await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/railway-storage/stream`, { headers: { host: 'app.example' } }, res => {
      assert.equal(res.statusCode, 200)
      res.resume()
      res.on('error', resolve)
      res.on('end', () => reject(new Error('Timed-out response should be interrupted')))
    })
    req.on('error', reject); req.end()
  })
  await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/railway-storage/stream`, { headers: { host: 'app.example' } }, res => {
      res.once('data', () => { res.destroy(); resolve() })
      res.on('error', reject)
    })
    req.on('error', reject); req.end()
  })
  // Let the upstream timeout fire after the downstream has gone away.
  await new Promise(resolve => setTimeout(resolve, 100))
  const alive = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/`, { headers: { host: 'unknown.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.end()
  })
  assert.equal(alive, 421)
})

test('host routing, SPA refresh, traversal denial and Railway proxy behavior', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cloudpeak-gateway-'))
  await mkdir(join(dir,'app')); await mkdir(join(dir,'web'))
  await writeFile(join(dir,'app/index.html'), '<html>APP</html>')
  await writeFile(join(dir,'web/index.html'), '<html>WEBSITE</html>')
  const calls = []
  const server = createGateway({ appOrigin:'https://app.example', websiteOrigin:'https://web.example', appAliases:['https://old-app.example'], websiteAliases:['https://old-web.example'], appRoot:join(dir,'app'), websiteRoot:join(dir,'web'), dataUrl:'http://data', storageUrl:'http://storage', supabaseUrl:'https://auth.example', fetchImpl: async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/health')) return new Response(JSON.stringify({emailMode:'preview',authWrites:false}))
    if (url.includes('storage')) return new Response(null, { status:302, headers:{location:'https://bucket.example/signed'} })
    return new Response(JSON.stringify([{ photo_url:'https://auth.example/functions/v1/storage-files/public/puppy-photos/test.png' }]), {headers:{'content-type':'application/json','content-range':'0-0/1'}})
  } })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true}) })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (path, host='app.example', options={}) => new Promise((resolve, reject) => {
    const req = httpRequest(base+path, { ...options, headers:{host,...options.headers} }, response => {
      const chunks=[]
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {status:response.statusCode,headers:response.headers})))
    })
    req.on('error',reject); req.end()
  })
  assert.match(await (await request('/')).text(), /APP/)
  assert.match(await (await request('/','web.example')).text(), /WEBSITE/)
  assert.match(await (await request('/','old-app.example')).text(), /APP/)
  assert.match(await (await request('/','old-web.example')).text(), /WEBSITE/)
  assert.match(await (await request('/admin','app.example',{headers:{accept:'text/html'}})).text(), /APP/)
  assert.equal((await request('/missing.js')).status,404)
  assert.equal((await request('/.env')).status,404)
  assert.equal((await request('/%2e%2e%5c.env')).status,404)
  assert.equal((await request('/','evil.example')).status,421)
  assert.equal((await request('/admin','web.example')).status,404)
  assert.equal((await request('/railway-api/rest/v1/profiles','app.example',{headers:{origin:'https://evil.example'}})).status,403)
  const config = await (await request('/cloudpeak-test-config.js','web.example')).text()
  assert.match(config,/window.location.origin/); assert.match(config,/https:\/\/app.example/)
  const response = await request('/railway-api/rest/v1/puppy_photos?select=photo_url','web.example',{headers:{authorization:'Bearer test-session','svix-id':'signed-event','svix-timestamp':'123','svix-signature':'v1,test'}})
  assert.equal(response.headers.get('content-range'),'0-0/1')
  assert.equal((await response.json())[0].photo_url,'https://web.example/railway-storage/functions/v1/storage-files/public/puppy-photos/test.png')
  assert.equal(calls.at(-1).init.headers.authorization,'Bearer test-session')
  assert.equal(calls.at(-1).init.headers['svix-signature'],'v1,test')
  assert.equal(calls.at(-1).url,'http://data/rest/v1/puppy_photos?select=photo_url')
  const redirect = await request('/railway-storage/functions/v1/storage-files/public/puppy-photos/test.png')
  assert.equal(redirect.status,302); assert.equal(redirect.headers.get('location'),'https://bucket.example/signed')
  const health = await request('/health','railway-healthcheck')
  assert.equal(health.status,200)
  assert.deepEqual(await health.json(), {ok:true,auth:null,emailMode:'preview',authWrites:false,releaseMode:'test',actionsRestricted:true})
})

test('website sitemap includes current litter and puppy detail URLs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cloudpeak-sitemap-'))
  await mkdir(join(dir, 'web'))
  await writeFile(join(dir, 'web/sitemap.xml'), '<?xml version="1.0"?><urlset><url><loc>https://web.example/</loc></url><url><loc>https://web.example/dogs.html</loc></url></urlset>')
  const requests = []
  const server = createGateway({
    appOrigin: 'https://app.example', websiteOrigin: 'https://web.example',
    appRoot: join(dir, 'web'), websiteRoot: join(dir, 'web'),
    dataUrl: 'http://data.internal', storageUrl: 'http://storage.internal', supabaseUrl: 'https://auth.example',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      const rows = url.includes('/litters?')
        ? [{ id: 'litter-1' }]
        : [{ id: 'puppy-1' }]
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  const response = await new Promise((resolve, reject) => {
    httpRequest(`http://127.0.0.1:${server.address().port}/sitemap.xml`, { headers: { host: 'web.example' } }, result => {
      const chunks = []
      result.on('data', chunk => chunks.push(chunk))
      result.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: result.statusCode, headers: result.headers })))
    }).on('error', reject).end()
  })
  const xml = await response.text()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/xml/)
  assert.match(xml, /https:\/\/web\.example\/dogs\.html/)
  assert.match(xml, /https:\/\/web\.example\/litter-gallery\.html\?litter=litter-1/)
  assert.match(xml, /https:\/\/web\.example\/puppy\.html\?puppy=puppy-1/)
  assert.deepEqual(requests.map(request => request.url), [
    'http://data.internal/rest/v1/litters?select=id',
    'http://data.internal/rest/v1/puppies?select=id',
  ])
  assert.equal(requests[0].init.headers.Range, '0-999')
})

test('website sitemap reports public-data failures instead of serving a stale list', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cloudpeak-sitemap-error-'))
  await mkdir(join(dir, 'web'))
  await writeFile(join(dir, 'web/sitemap.xml'), '<urlset><url><loc>https://web.example/</loc></url></urlset>')
  const server = createGateway({
    appOrigin: 'https://app.example', websiteOrigin: 'https://web.example',
    appRoot: join(dir, 'web'), websiteRoot: join(dir, 'web'),
    dataUrl: 'http://data.internal', storageUrl: 'http://storage.internal', supabaseUrl: 'https://auth.example',
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  const response = await new Promise((resolve, reject) => {
    httpRequest(`http://127.0.0.1:${server.address().port}/sitemap.xml`, { headers: { host: 'web.example' } }, result => {
      result.resume()
      result.on('end', () => resolve(result.statusCode))
    }).on('error', reject).end()
  })
  assert.equal(response, 503)
})
