import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, '../cloudpeak-web')
const bundle = resolve(root, 'deployment/bundle', `website-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const website = join(bundle, 'public/website')
await mkdir(website, { recursive: true })
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.html')) {
    const html = await readFile(join(source, entry.name), 'utf8')
    await writeFile(join(website, entry.name), html.replace(/(<head[^>]*>)/i, '$1\n<script src="/cloudpeak-test-config.js"></script>'))
  }
}
for (const name of ['assets', 'css', 'js', 'sitemap.xml', 'robots.txt']) {
  await cp(join(source, name), join(website, name), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => part.startsWith('.')) })
}
await mkdir(join(bundle, 'deployment/website'), { recursive: true })
await cp(join(root, 'deployment/gateway.mjs'), join(bundle, 'deployment/gateway.mjs'))
await cp(join(root, 'deployment/website/start.mjs'), join(bundle, 'deployment/website/start.mjs'))
for (const name of ['Dockerfile', 'railway.json']) await cp(join(root, 'deployment/website', name), join(bundle, name))
await cp(join(root, 'deployment/.dockerignore'), join(bundle, '.dockerignore'))
const release = {
  websiteSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
  runtimeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  buildId: new Date().toISOString(), service: 'website',
}
await writeFile(join(website, 'release.json'), JSON.stringify(release))
await writeFile(join(root, 'deployment/bundle/website-latest.json'), JSON.stringify({ path: bundle, release }, null, 2))
console.log(`Prepared independent website bundle: ${bundle}`)
