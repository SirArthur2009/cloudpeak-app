import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyRelease } from './verify-release.mjs'

const expected = { appSha: 'app-current', websiteSha: 'website-current', buildId: 'original', authProvider: 'better-auth' }
const check = (release = {}, health = {}) => ({
  release: { ...expected, ...release },
  health: { ok: true, releaseMode: 'live', auth: 'Better Auth', ...health },
})

test('accepts the original build and a concurrent build of the same revisions on both domains', () => {
  assert.equal(verifyRelease([check(), check()], expected), true)
  assert.equal(verifyRelease([check({ buildId: 'replacement' }), check({ buildId: 'replacement' })], expected), true)
})

test('rejects partial rollouts, stale revisions, missing build identity, and unhealthy releases', () => {
  for (const bad of [
    check({ buildId: 'replacement' }), check({ appSha: 'old-app' }),
    check({ websiteSha: 'old-website' }), check({ buildId: undefined }),
    check({ authProvider: 'supabase' }), check({}, { ok: false }),
    check({}, { releaseMode: 'test' }), check({}, { auth: 'Supabase' }),
  ]) assert.equal(verifyRelease([check(), bad], expected), false)
  assert.equal(verifyRelease([], expected), false)
})
