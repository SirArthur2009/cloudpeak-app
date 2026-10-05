import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createStorageServer } from './server.js'
import { createServer } from 'node:http'

test('public links redirect directly to S3; private prefixes and API requests stay protected', async t => {
  const server = createStorageServer({
    AWS_ENDPOINT_URL: 'https://storage.example.com', AWS_ACCESS_KEY_ID: 'test-key', AWS_SECRET_ACCESS_KEY: 'test-secret',
    AWS_S3_BUCKET_NAME: 'test-bucket', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-anon',
    ALLOWED_ORIGINS: 'https://portal.example.com',
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const publicFile = await fetch(`${base}/public/puppy-photos/folder/photo.png`, { redirect: 'manual' })
  assert.equal(publicFile.status, 302)
  const destination = new URL(publicFile.headers.get('location'))
  assert.equal(destination.hostname, 'test-bucket.storage.example.com')
  assert.equal(destination.pathname, '/puppy-photos/folder/photo.png')
  assert.ok(destination.searchParams.has('X-Amz-Signature'))
  assert.equal((await fetch(`${base}/public/admin-files/secret.pdf`)).status, 404)
  assert.equal((await fetch(`${base}/public/puppy-photos/..%2Fadmin-files%2Fsecret.pdf`)).status, 400)
  assert.equal((await fetch(`${base}/api/admin-files/sign-read`, { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await fetch(`${base}/api/puppy-photos/delete`, { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await fetch(`${base}/public/puppy-photos/photo.png`, { headers: { Origin: 'https://untrusted.example.com' }, redirect: 'manual' })).status, 403)
  const preflight = await fetch(`${base}/api/admin-files/sign-upload`, { method: 'OPTIONS', headers: { Origin: 'https://portal.example.com' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://portal.example.com')
})

test('verified user profiles control private access even when user metadata claims admin', async t => {
  const source = createServer((req, res) => {
    const role = req.headers.authorization === 'Bearer admin-session' ? 'admin' : 'client'
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.startsWith('/auth/v1/user')
      ? { id: 'user-id', aud: 'authenticated', role: 'authenticated', user_metadata: { role: 'admin' } }
      : { role }))
  })
  source.listen(0, '127.0.0.1')
  await once(source, 'listening')
  t.after(() => { source.closeAllConnections(); source.close() })
  const server = createStorageServer({
    AWS_ENDPOINT_URL: 'https://storage.example.com', AWS_ACCESS_KEY_ID: 'test-key', AWS_SECRET_ACCESS_KEY: 'test-secret',
    AWS_S3_BUCKET_NAME: 'test-bucket', SUPABASE_URL: `http://127.0.0.1:${source.address().port}`, SUPABASE_ANON_KEY: 'test-anon',
    ALLOWED_ORIGINS: 'https://portal.example.com',
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (bucket, action, token, body) => fetch(`${base}/api/${bucket}/${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal((await request('admin-files', 'sign-read', 'client-session', { paths: ['secret.pdf'] })).status, 403)
  assert.equal((await request('puppy-photos', 'sign-upload', 'client-session', { path: 'photo.png', size: 4, contentType: 'image/png' })).status, 403)
  assert.equal((await request('puppy-photos', 'delete', 'client-session', { paths: ['photo.png'] })).status, 403)
  const privateRead = await request('admin-files', 'sign-read', 'admin-session', { paths: ['secret.pdf'] })
  assert.equal(privateRead.status, 200)
  assert.equal(new URL((await privateRead.json()).urls[0].signedUrl).pathname, '/admin-files/secret.pdf')
  const upload = await request('admin-files', 'sign-upload', 'admin-session', { path: 'secret.pdf', size: 4, contentType: 'application/pdf' })
  assert.equal(upload.status, 200)
  const signedUpload = new URL((await upload.json()).uploadUrl)
  assert.equal(signedUpload.pathname, '/admin-files/secret.pdf')
  assert.ok(signedUpload.searchParams.get('X-Amz-SignedHeaders').includes('if-none-match'))
})
