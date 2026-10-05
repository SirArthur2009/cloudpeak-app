import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGateway } from './gateway.mjs'
import { request as httpRequest } from 'node:http'

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
  assert.deepEqual(await health.json(), {ok:true,emailMode:'preview',authWrites:false,releaseMode:'test',actionsRestricted:true})
})
