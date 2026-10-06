import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.pdf': 'application/pdf' }
export function createGateway({ appOrigin, websiteOrigin, appAliases = [], websiteAliases = [], appRoot, websiteRoot, dataUrl, storageUrl, supabaseUrl, upstreamOrigin, fetchImpl = fetch, proxyTimeoutMs = 30000 }) {
  const sites = new Map([[new URL(appOrigin).host, { origin: appOrigin, root: resolve(appRoot), app: true }], [new URL(websiteOrigin).host, { origin: websiteOrigin, root: resolve(websiteRoot), app: false }]])
  if (sites.size !== 2) throw new Error('App and website must use different hostnames.')
  for (const [aliases, root, app] of [[appAliases, appRoot, true], [websiteAliases, websiteRoot, false]]) {
    for (const origin of aliases) {
      const url = new URL(origin)
      if (url.protocol !== 'https:' || url.origin !== origin || sites.has(url.host)) throw new Error('Invalid or overlapping hostname alias.')
      sites.set(url.host, { origin, root: resolve(root), app })
    }
  }
  const siteOrigins = [...sites.values()].map(site => site.origin)
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      const url = new URL(req.url, 'http://gateway.invalid')
      if (url.pathname === '/health' && req.method === 'GET') {
        const [dataHealth, storageHealth] = await Promise.all([`${dataUrl}/health`, `${storageUrl}/functions/v1/storage-files/health`].map(async endpoint => {
          const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(5000) })
          return { ok: response.ok, body: await response.json() }
        }))
        const ok = dataHealth.ok && storageHealth.ok
        return send(ok ? 200 : 503, { ok, emailMode: dataHealth.body.emailMode ?? null, authWrites: dataHealth.body.authWrites ?? null, releaseMode: dataHealth.body.releaseMode ?? 'test', actionsRestricted: dataHealth.body.actionsRestricted ?? true })
      }
      const site = sites.get(req.headers.host)
      if (!site) return send(421, { error: 'Unknown test hostname.' })
      if (url.pathname === '/railway-api' || url.pathname.startsWith('/railway-api/') || url.pathname === '/railway-storage' || url.pathname.startsWith('/railway-storage/')) {
        if (req.headers.origin && !siteOrigins.includes(req.headers.origin)) return send(403, { error: 'Origin is not allowed.' })
        const data = url.pathname.startsWith('/railway-api')
        const prefix = data ? '/railway-api' : '/railway-storage'
        const headers = {}
        for (const name of ['authorization','apikey','content-type','prefer','range','range-unit','origin','x-client-info','accept','accept-profile','content-profile','svix-id','svix-timestamp','svix-signature']) if (req.headers[name]) headers[name] = req.headers[name]
        // Local built previews reuse an already-running localhost backend.
        if (upstreamOrigin && headers.origin) headers.origin = upstreamOrigin
        const init = { method: req.method, headers, signal: AbortSignal.timeout(proxyTimeoutMs), redirect: 'manual' }
        if (!['GET','HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half' }
        const upstream = await fetchImpl(`${data ? dataUrl : storageUrl}${url.pathname.slice(prefix.length) || '/'}${url.search}`, init)
        for (const name of ['content-type','content-range','range-unit','preference-applied','location','cache-control','access-control-allow-origin','access-control-allow-headers','access-control-allow-methods','access-control-expose-headers','vary']) if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name))
        // Copied photo records still contain the old Edge redirect URLs. Serve
        // these through Railway without mutating either database copy.
        if (data && upstream.headers.get('content-type')?.includes('application/json')) {
          const text = await upstream.text()
          const oldPrefix = `${supabaseUrl}/functions/v1/storage-files/public/`
          res.writeHead(upstream.status)
          res.end(text.replaceAll(oldPrefix, `${site.origin}/railway-storage/functions/v1/storage-files/public/`))
        } else {
          res.writeHead(upstream.status)
          if (req.method === 'HEAD' || !upstream.body) { await upstream.body?.cancel(); res.end() }
          // Pipeline owns Web Stream cancellation and errors directly, including
          // timeouts that arrive after the downstream client disconnects.
          else await pipeline(upstream.body, res)
        }
        return
      }
      if (!['GET','HEAD'].includes(req.method)) return send(405, { error: 'Use GET or HEAD.' })
      if (url.pathname === '/cloudpeak-test-config.js' && !site.app) {
        res.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' })
        return res.end(`window.CLOUDPEAK_DATA_API_URL=window.location.origin+"/railway-api";window.CLOUDPEAK_PORTAL_URL=${JSON.stringify(appOrigin)};`)
      }
      let path
      try { path = decodeURIComponent(url.pathname) } catch { return send(400, { error: 'Invalid path.' }) }
      if (path.includes('\0') || path.includes('\\') || path.split('/').some(part => part.startsWith('.') && part)) return send(404, { error: 'Not found.' })
      let file = resolve(site.root, `.${path === '/' ? '/index.html' : path}`)
      if (!file.startsWith(site.root + sep)) return send(404, { error: 'Not found.' })
      let info = await stat(file).catch(() => null)
      if ((!info?.isFile()) && site.app && !extname(path) && req.headers.accept?.includes('text/html')) { file = resolve(site.root, 'index.html'); info = await stat(file) }
      if (!info?.isFile()) return send(404, { error: 'Not found.' })
      const contents = await readFile(file)
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=300' })
      res.end(req.method === 'HEAD' ? undefined : contents)
    } catch {
      if (!res.headersSent) send(502, { error: 'Test service is unavailable.' })
      else res.destroy()
    }
  })
}
