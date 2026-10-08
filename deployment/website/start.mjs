import { resolve } from 'node:path'
import { createGateway } from '../gateway.mjs'

const root = resolve(import.meta.dirname, '../..')
for (const name of ['APP_ORIGIN', 'WEBSITE_ORIGIN', 'BACKEND_ORIGIN']) {
  const url = new URL(process.env[name])
  if (url.protocol !== 'https:' || url.origin !== process.env[name]) throw new Error(`${name} must be an exact HTTPS origin.`)
}
// Proxy via the portal gateway, preserving the website's same-origin API URLs.
// No database, mail, storage, or authentication secrets belong in this service.
const gateway = createGateway({
  websiteOnly: true,
  appOrigin: process.env.APP_ORIGIN,
  websiteOrigin: process.env.WEBSITE_ORIGIN,
  websiteAliases: (process.env.WEBSITE_ALIASES || '').split(',').filter(Boolean),
  appRoot: resolve(root, 'unused-app'),
  websiteRoot: resolve(root, 'public/website'),
  dataUrl: `${process.env.BACKEND_ORIGIN}/railway-api`,
  storageUrl: `${process.env.BACKEND_ORIGIN}/railway-storage`,
  upstreamOrigin: process.env.WEBSITE_ORIGIN,
  // Portal API responses already rewrite legacy image URLs; the gateway also
  // rewrites that portal storage prefix to the website's same-origin proxy.
  supabaseUrl: `${process.env.BACKEND_ORIGIN}/railway-api`,
  proxyTimeoutMs: 8000,
})
gateway.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Independent website started.'))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => gateway.close())
