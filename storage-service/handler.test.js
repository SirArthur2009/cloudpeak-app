import test from 'node:test'
import assert from 'node:assert/strict'
import { createStorageHandler } from '../supabase/functions/storage-files/handler.js'

const handler = createStorageHandler({
  origins: new Set(['http://localhost:5173']),
  getUser: async token => token === 'expired' ? null : { id: 'user', user_metadata: { role: 'admin' } },
  getRole: async token => token === 'admin' ? 'admin' : 'client',
  readUrl: async key => `https://bucket.example/${key}?signature=test`,
  uploadUrl: async key => `https://bucket.example/${key}?upload=test`,
  remove: async () => {}, health: async () => {},
})
const request = (suffix, body, token = 'admin') => handler(new Request(`https://project.supabase.co/functions/v1/storage-files${suffix}`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))

test('function-prefixed routes allow anonymous public redirects but deny private ones', async () => {
  const publicRead = await handler(new Request('https://project.supabase.co/functions/v1/storage-files/public/puppy-photos/photo.png'))
  assert.equal(publicRead.status, 302)
  assert.equal(publicRead.headers.get('location'), 'https://bucket.example/puppy-photos/photo.png?signature=test')
  const privateRead = await handler(new Request('https://project.supabase.co/functions/v1/storage-files/public/admin-files/secret'))
  assert.equal(privateRead.status, 404)
})
test('expired sessions and spoofed user metadata cannot access private files', async () => {
  assert.equal((await request('/api/admin-files/sign-read', { paths: ['secret'] }, 'expired')).status, 401)
  assert.equal((await request('/api/admin-files/sign-read', { paths: ['secret'] }, 'client')).status, 403)
  assert.equal((await request('/api/admin-files/sign-read', { paths: ['secret'] })).status, 200)
})
test('signing rejects oversized input, cross-prefix paths, invalid JSON and invalid expiry', async () => {
  assert.equal((await request('/api/admin-files/sign-upload', { path: 'file', size: 52428801, contentType: 'application/pdf' })).status, 400)
  assert.equal((await request('/api/puppy-photos/sign-read', { paths: ['../admin-files/secret'] })).status, 400)
  assert.equal((await request('/api/admin-files/sign-read', null)).status, 400)
  assert.equal((await request('/api/admin-files/sign-read', { paths: ['file'], expiresIn: 'Infinity' })).status, 400)
  assert.equal((await request('/api/admin-files/sign-read', { paths: ['file'], padding: 'x'.repeat(65536) })).status, 413)
})

test('owner uploads stay private and require their own sold puppy for every path', async () => {
  const ownerHandler = createStorageHandler({
    origins: new Set(['http://localhost:5173']),
    getUser: async () => ({ id: 'owner', email: 'owner@example.invalid' }),
    getRole: async () => 'client',
    ownsSoldPuppy: async (_token, _user, puppyId) => puppyId === '42',
    readUrl: async key => `https://bucket.example/${key}?signature=test`,
    uploadUrl: async key => `https://bucket.example/${key}?upload=test`,
    remove: async () => assert.fail('An owner must never delete files'), health: async () => {},
  })
  const send = (action, body) => ownerHandler(new Request(`http://localhost/api/owner-puppy-photos/${action}`, {
    method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  assert.equal((await ownerHandler(new Request('http://localhost/public/owner-puppy-photos/owner/42/photo.jpg'))).status, 404)
  const upload = { path: 'owner/42/photo.jpg', size: 100, contentType: 'image/jpeg' }
  assert.equal((await send('sign-upload', upload)).status, 200)
  assert.equal((await send('sign-upload', { ...upload, path: 'other/42/photo.jpg' })).status, 403)
  assert.equal((await send('sign-upload', { ...upload, path: 'owner/43/photo.jpg' })).status, 403)
  assert.equal((await send('sign-upload', { ...upload, path: 'owner/42/subfolder/photo.jpg' })).status, 403)
  assert.equal((await send('sign-upload', { ...upload, size: 10485761 })).status, 400)
  assert.equal((await send('sign-upload', { ...upload, contentType: 'image/svg+xml' })).status, 400)
  assert.equal((await send('sign-read', { paths: ['owner/42/photo.jpg'] })).status, 200)
  assert.equal((await send('sign-read', { paths: ['owner/42/photo.jpg', 'other/42/photo.jpg'] })).status, 403)
  assert.equal((await send('delete', { paths: ['owner/42/photo.jpg'] })).status, 403)
})
