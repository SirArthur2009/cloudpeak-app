export function hostedRuntimeConfig(input) {
  if (input.AUTH_PROVIDER && !['supabase','better-auth'].includes(input.AUTH_PROVIDER)) throw new Error('Invalid AUTH_PROVIDER.')
  if (input.AUTH_PROVIDER === 'better-auth') {
    if (!input.BETTER_AUTH_SECRET || input.BETTER_AUTH_SECRET.length < 32) throw new Error('Better Auth requires a server-only secret of at least 32 characters.')
    if (!input.BETTER_AUTH_URL || new URL(input.BETTER_AUTH_URL).href !== `${input.APP_ORIGIN}/railway-api/api/auth`) throw new Error('BETTER_AUTH_URL must match the full public portal auth URL.')
  }
  const mode=input.HOSTED_MODE || 'test'
  if (!['test','staging','live'].includes(mode)) throw new Error('HOSTED_MODE must be test, staging or live.')
  if (mode!=='test') {
    if (input.LIVE_ACTIONS_APPROVED!=='true') throw new Error('Live actions require explicit release approval.')
    for (const name of [input.AUTH_PROVIDER === 'better-auth' ? 'BETTER_AUTH_SECRET' : 'SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','RESEND_WEBHOOK_SECRET']) {
      if (name==='RESEND_API_KEY' && input.RESEND_EMAIL_API_KEY) continue
      if (!input[name]) throw new Error(`Live configuration is missing ${name}.`)
    }
  }
  if (mode==='staging' && (!input.EMAIL_ALLOWED_RECIPIENTS || !input.AUTH_ALLOWED_EMAILS)) throw new Error('Staging requires approved recipient and account allowlists.')
  return {...input,HOSTED_MODE:mode,EMAIL_MODE:mode==='test'?'preview':'live',AUTH_WRITES_ENABLED:mode==='test'?'false':'true',INBOUND_EMAIL_ENABLED:mode==='live'?'true':'false',PORTAL_URL:`${input.APP_ORIGIN}/`,ALLOWED_ORIGINS:[input.APP_ORIGIN,input.WEBSITE_ORIGIN,input.APP_ALIASES,input.WEBSITE_ALIASES].filter(Boolean).join(','),DATA_API_PORT:'3002',REST_PORT:'3003'}
}
