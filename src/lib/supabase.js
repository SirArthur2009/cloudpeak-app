import { createClient } from '@supabase/supabase-js'
import { betterAuthCompat } from './betterAuth'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const dataUrl = import.meta.env.VITE_DATA_API_URL ? new URL(import.meta.env.VITE_DATA_API_URL, window.location.origin).href.replace(/\/$/, '') : null
const originalFetch = globalThis.fetch.bind(globalThis)
const testFetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (dataUrl && url.origin === new URL(supabaseUrl).origin) {
    if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) {
      const target = `${dataUrl}${url.pathname}${url.search}`
      if (import.meta.env.VITE_AUTH_PROVIDER === 'better-auth') {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
        const { data, error } = await betterAuthCompat.getSession()
        if (error) throw new Error(error.message || 'Session validation failed.')
        headers.set('Authorization', `Bearer ${data.session?.access_token || supabaseKey}`)
        return originalFetch(input instanceof Request ? new Request(target, input) : target, { ...init, headers })
      }
      return originalFetch(input instanceof Request ? new Request(target, input) : target, init)
    }
  }
  // Auth refresh requests must not leave the portal loading indefinitely.
  if (url.origin === new URL(supabaseUrl).origin && url.pathname.startsWith('/auth/v1/')) {
    const signal = init?.signal || (input instanceof Request ? input.signal : null)
    return originalFetch(input, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
  }
  return originalFetch(input, init)
}

if (import.meta.env.VITE_AUTH_PROVIDER === 'better-auth' && !dataUrl) throw new Error('Better Auth requires VITE_DATA_API_URL.')
export const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: testFetch },
  ...(import.meta.env.VITE_AUTH_PROVIDER === 'better-auth' ? { auth: { persistSession: false, autoRefreshToken: false } } : {}) })
if (import.meta.env.VITE_AUTH_PROVIDER === 'better-auth') supabase.auth = betterAuthCompat
