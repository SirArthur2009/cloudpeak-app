import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const dataUrl = import.meta.env.VITE_DATA_API_URL ? new URL(import.meta.env.VITE_DATA_API_URL, window.location.origin).href.replace(/\/$/, '') : null
const originalFetch = globalThis.fetch.bind(globalThis)
const testFetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (dataUrl && url.origin === new URL(supabaseUrl).origin) {
    if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) {
      const target = `${dataUrl}${url.pathname}${url.search}`
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

export const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: testFetch } })
