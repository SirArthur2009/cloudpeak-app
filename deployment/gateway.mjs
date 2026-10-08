import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isIP } from 'node:net'

const mime = { '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.pdf': 'application/pdf' }
export function createGateway({ appOrigin, websiteOrigin, appAliases = [], websiteAliases = [], appRoot, websiteRoot, dataUrl, storageUrl, supabaseUrl, upstreamOrigin, trustRailwayProxy = false, fetchImpl = fetch, proxyTimeoutMs = 30000, websiteOnly = false }) {
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
  if (websiteOnly) for (const [host, site] of sites) if (site.app) sites.delete(host)
  const readPublicIds = async table => {
    const ids = []
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
      const response = await fetchImpl(`${dataUrl}/rest/v1/${table}?select=id`, {
        headers: { Range: `${offset}-${offset + pageSize - 1}`, 'Range-Unit': 'items' },
        signal: AbortSignal.timeout(proxyTimeoutMs),
      })
      if (!response.ok) throw new Error(`Public ${table} query failed with HTTP ${response.status}.`)
      const rows = await response.json()
      if (!Array.isArray(rows) || rows.some(row => !row || row.id == null)) throw new Error(`Public ${table} query returned invalid rows.`)
      ids.push(...rows.map(row => String(row.id)))
      if (rows.length < pageSize) return ids
    }
  }
  const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  const createSitemap = async () => {
    const staticXml = await readFile(resolve(websiteRoot, 'sitemap.xml'), 'utf8')
    const urls = [...staticXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
    if (!urls.length) throw new Error('Static sitemap contains no URLs.')
    const canonicalOrigin = new URL(websiteOrigin).origin
    if (urls.some(value => new URL(value).origin !== canonicalOrigin)) throw new Error('Static sitemap contains an unexpected origin.')
    const [litters, puppies] = await Promise.all([readPublicIds('litters'), readPublicIds('puppies')])
    for (const [path, parameter, ids] of [
      ['/litter-gallery.html', 'litter', litters],
      ['/puppy.html', 'puppy', puppies],
    ]) {
      for (const id of ids) {
        const url = new URL(path, canonicalOrigin)
        url.searchParams.set(parameter, id)
        urls.push(url.href)
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map(value => `  <url><loc>${escapeXml(value)}</loc></url>`).join('\n')}\n</urlset>\n`
  }
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      const url = new URL(req.url, 'http://gateway.invalid')
      if (url.pathname === '/health' && req.method === 'GET') {
        // The isolated website's readiness depends only on its own files.
        if (websiteOnly) {
          await stat(resolve(websiteRoot, 'index.html'))
          return send(200, { ok: true, service: 'website' })
        }
        const [dataHealth, storageHealth] = await Promise.all([`${dataUrl}/health`, `${storageUrl}/functions/v1/storage-files/health`].map(async endpoint => {
          const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(5000) })
          return { ok: response.ok, body: await response.json() }
        }))
        const ok = dataHealth.ok && storageHealth.ok
        return send(ok ? 200 : 503, { ok, auth: dataHealth.body.auth ?? null, emailMode: dataHealth.body.emailMode ?? null, authWrites: dataHealth.body.authWrites ?? null, releaseMode: dataHealth.body.releaseMode ?? 'test', actionsRestricted: dataHealth.body.actionsRestricted ?? true })
      }
      const site = sites.get(req.headers.host)
      if (!site) return send(421, { error: 'Unknown test hostname.' })
      if (url.pathname === '/railway-api' || url.pathname.startsWith('/railway-api/') || url.pathname === '/railway-storage' || url.pathname.startsWith('/railway-storage/')) {
        if (req.headers.origin && !siteOrigins.includes(req.headers.origin)) return send(403, { error: 'Origin is not allowed.' })
        const data = url.pathname.startsWith('/railway-api')
        const prefix = data ? '/railway-api' : '/railway-storage'
        const headers = {}
        // Railway's edge supplies X-Real-IP. Never forward a caller's auth-IP header.
        const edgeIp = trustRailwayProxy ? req.headers['x-real-ip'] : null
        headers['x-cloudpeak-client-ip'] = typeof edgeIp === 'string' && isIP(edgeIp) ? edgeIp : req.socket.remoteAddress
        for (const name of ['authorization','cookie','apikey','content-type','prefer','range','range-unit','origin','x-client-info','accept','accept-profile','content-profile','svix-id','svix-timestamp','svix-signature']) if (req.headers[name]) headers[name] = req.headers[name]
        // Local built previews reuse an already-running localhost backend.
        if (upstreamOrigin && headers.origin) headers.origin = upstreamOrigin
        const init = { method: req.method, headers, signal: AbortSignal.timeout(proxyTimeoutMs), redirect: 'manual' }
        if (!['GET','HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half' }
        const upstream = await fetchImpl(`${data ? dataUrl : storageUrl}${url.pathname.slice(prefix.length) || '/'}${url.search}`, init)
        const cookies = upstream.headers.getSetCookie?.() || []
        if (cookies.length) res.setHeader('set-cookie', cookies)
        for (const name of ['set-auth-token', 'access-control-allow-credentials']) if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name))
        for (const name of ['content-type','content-range','range-unit','preference-applied','location','cache-control','access-control-allow-origin','access-control-allow-headers','access-control-allow-methods','access-control-expose-headers','vary']) if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name))
        // Copied photo records still contain the old Edge redirect URLs. Serve
        // these through Railway without mutating either database copy.
        if (data && upstream.headers.get('content-type')?.includes('application/json')) {
          const text = await upstream.text()
          const oldPrefix = `${supabaseUrl}/functions/v1/storage-files/public/`
          res.writeHead(upstream.status)
          const publicPrefix = `${site.origin}/railway-storage/functions/v1/storage-files/public/`
          res.end(text.replaceAll(oldPrefix, publicPrefix).replaceAll(`${storageUrl}/functions/v1/storage-files/public/`, publicPrefix))
        } else {
          res.writeHead(upstream.status)
          if (req.method === 'HEAD' || !upstream.body) { await upstream.body?.cancel(); res.end() }
          // Pipeline owns Web Stream cancellation and errors directly, including
          // timeouts that arrive after the downstream client disconnects.
          else await pipeline(upstream.body, res)
        }
        return
      }
      if (url.pathname === '/sitemap.xml' && !site.app) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Use GET or HEAD.' })
        try {
          const sitemap = await createSitemap()
          res.writeHead(200, { 'Content-Type': mime['.xml'], 'Cache-Control': 'public, max-age=300' })
          return res.end(req.method === 'HEAD' ? undefined : sitemap)
        } catch (error) {
          console.error('Sitemap generation failed:', error.message)
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
          return res.end(req.method === 'HEAD' ? undefined : 'Sitemap temporarily unavailable.')
        }
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
