import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hostedRuntimeConfig} from './runtime-config.mjs'
test('Better Auth releases validate public auth routing and use their own secret',()=>{
  const input={APP_ORIGIN:'https://app.example',WEBSITE_ORIGIN:'https://site.example',AUTH_PROVIDER:'better-auth',BETTER_AUTH_SECRET:'test-secret-at-least-32-characters-long',BETTER_AUTH_URL:'https://app.example/railway-api/api/auth'}
  assert.equal(hostedRuntimeConfig(input).AUTH_PROVIDER,'better-auth')
  assert.throws(()=>hostedRuntimeConfig({...input,BETTER_AUTH_SECRET:''}),/secret/)
  assert.throws(()=>hostedRuntimeConfig({...input,BETTER_AUTH_URL:'https://app.example/railway-api'}),/auth URL/)
  const live=hostedRuntimeConfig({...input,HOSTED_MODE:'live',LIVE_ACTIONS_APPROVED:'true',RESEND_API_KEY:'fake',RESEND_WEBHOOK_SECRET:'fake'})
  assert.equal(live.AUTH_WRITES_ENABLED,'true')
})
test('hosted test overrides live flags; release fails closed without approval and required credentials',()=>{
  const input={APP_ORIGIN:'https://app.example',WEBSITE_ORIGIN:'https://site.example',EMAIL_MODE:'live',AUTH_WRITES_ENABLED:'true'}
  const test=hostedRuntimeConfig(input)
  assert.equal(test.EMAIL_MODE,'preview');assert.equal(test.AUTH_WRITES_ENABLED,'false')
  assert.throws(()=>hostedRuntimeConfig({...input,HOSTED_MODE:'live'}),/approval/)
  assert.throws(()=>hostedRuntimeConfig({...input,HOSTED_MODE:'live',LIVE_ACTIONS_APPROVED:'true'}),/SUPABASE_SERVICE_ROLE_KEY/)
  assert.throws(()=>hostedRuntimeConfig({...input,HOSTED_MODE:'live',LIVE_ACTIONS_APPROVED:'true',SUPABASE_SERVICE_ROLE_KEY:'fake',RESEND_API_KEY:'fake'}),/RESEND_WEBHOOK_SECRET/)
  const live=hostedRuntimeConfig({...input,HOSTED_MODE:'live',LIVE_ACTIONS_APPROVED:'true',SUPABASE_SERVICE_ROLE_KEY:'fake',RESEND_API_KEY:'fake',RESEND_WEBHOOK_SECRET:'fake'})
  assert.equal(live.EMAIL_MODE,'live');assert.equal(live.AUTH_WRITES_ENABLED,'true')
  assert.equal(live.PORTAL_URL,'https://app.example/')
  assert.throws(()=>hostedRuntimeConfig({...live,HOSTED_MODE:'staging'}),/allowlists/)
  const staging=hostedRuntimeConfig({...live,HOSTED_MODE:'staging',EMAIL_ALLOWED_RECIPIENTS:'test@example.invalid',AUTH_ALLOWED_EMAILS:'account@example.invalid'})
  assert.equal(staging.INBOUND_EMAIL_ENABLED,'false')
  assert.equal(staging.EMAIL_MODE,'live')
})
