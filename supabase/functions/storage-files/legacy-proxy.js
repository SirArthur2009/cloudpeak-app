// Compatibility for saved Supabase file URLs. Railway owns storage and access checks.
const target = 'https://portal.cloudpeaksilverlabradors.com/railway-storage/functions/v1/storage-files'
export function createLegacyStorageProxy(fetchImpl = fetch) {
  return async request => {
    const path = new URL(request.url).pathname
    const match = path.match(/^(?:\/functions\/v1)?\/storage-files(\/.*)?$/)
    if (!match || !['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method)) {
      return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    const headers = new Headers()
    for (const name of ['authorization', 'content-type', 'origin', 'apikey', 'x-client-info']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    const init = { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(30000) }
    try {
      if (request.method === 'POST') {
        const reader = request.body?.getReader()
        const chunks = []; let size = 0
        if (reader) while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.length
          if (size > 65536) { await reader.cancel(); return new Response(null, { status: 413 }) }
          chunks.push(value)
        }
        const body = new Uint8Array(size); let offset = 0
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
        init.body = body
      }
      const response = await fetchImpl(`${target}${match[1] || '/'}`, init)
      const output = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      for (const name of ['content-type', 'location', 'cache-control', 'access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'vary']) {
        const value = response.headers.get(name)
        if (value) output.set(name, value)
      }
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: output })
    } catch {
      return new Response(JSON.stringify({ error: 'File service unavailable.' }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
  }
}
