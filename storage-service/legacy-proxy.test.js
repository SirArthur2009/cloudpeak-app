import test from 'node:test'
import assert from 'node:assert/strict'
import { createLegacyStorageProxy } from '../supabase/functions/storage-files/legacy-proxy.js'

test('legacy public links preserve Railway signed redirects and do not forward arbitrary query destinations', async () => {
  let destination
  const handler = createLegacyStorageProxy(async (url, options) => {
    destination = url
    assert.equal(options.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: 'https://t3.storageapi.dev/signed-photo', 'Cache-Control': 'public, max-age=300' } })
  })
  const result = await handler(new Request('https://source.supabase.co/functions/v1/storage-files/public/puppy-photos/a%20b.png?target=https://evil.invalid'))
  assert.equal(destination, 'https://portal.cloudpeaksilverlabradors.com/railway-storage/functions/v1/storage-files/public/puppy-photos/a%20b.png')
  assert.equal(result.status, 302)
  assert.equal(result.headers.get('location'), 'https://t3.storageapi.dev/signed-photo')
})

test('private requests preserve caller token and body; Railway denial is preserved', async () => {
  const handler = createLegacyStorageProxy(async (url, options) => {
    assert.equal(options.headers.get('authorization'), 'Bearer caller-session')
    assert.equal(options.headers.get('origin'), 'https://portal.cloudpeaksilverlabradors.com')
    assert.equal(new TextDecoder().decode(options.body), '{"paths":["private.pdf"]}')
    return new Response('{"error":"Admin access required."}', { status: 403, headers: { 'Content-Type': 'application/json' } })
  })
  const result = await handler(new Request('https://source.supabase.co/storage-files/api/admin-files/sign-read', { method: 'POST', headers: { Authorization: 'Bearer caller-session', Origin: 'https://portal.cloudpeaksilverlabradors.com' }, body: '{"paths":["private.pdf"]}' }))
  assert.equal(result.status, 403)
})

test('unrecognized function paths do not reach the upstream', async () => {
  const handler = createLegacyStorageProxy(() => { throw new Error('Must not be called') })
  assert.equal((await handler(new Request('https://source.supabase.co/storage-files-evil/public/puppy-photos/a.png'))).status, 404)
})

test('oversized private request bodies are rejected before forwarding', async () => {
  const handler = createLegacyStorageProxy(() => { throw new Error('Must not be called') })
  const request = new Request('https://source.supabase.co/storage-files/api/admin-files/sign-read', { method: 'POST', body: 'x'.repeat(65537) })
  assert.equal((await handler(request)).status, 413)
})
