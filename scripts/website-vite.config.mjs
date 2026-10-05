import { resolve } from 'node:path'

export default {
  server: { proxy: process.env.CLOUDPEAK_DATA_PROXY_TARGET ? {
    '/railway-api': { target: process.env.CLOUDPEAK_DATA_PROXY_TARGET, rewrite: path => path.replace(/^\/railway-api/, '') },
  } : {} },
  plugins: [{ name: 'railway-database-test', transformIndexHtml(html) {
    const url = process.env.CLOUDPEAK_TEST_DATA_API_URL
    if (!url) return html
    return { html, tags: [{ tag: 'script', children: `window.CLOUDPEAK_DATA_API_URL=${JSON.stringify(url)};`, injectTo: 'head-prepend' }] }
  } }],
  root: resolve(import.meta.dirname, '../../cloudpeak-web'),
  cacheDir: resolve(import.meta.dirname, '../node_modules/.vite-website'),
  optimizeDeps: { noDiscovery: true, include: [] },
}
