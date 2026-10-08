import { readFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { verifyRelease } from './verify-release.mjs'
const bundle = JSON.parse(await readFile('deployment/bundle/latest.json', 'utf8'))
if (bundle.buildMode !== 'live') throw new Error('CI must deploy a live bundle.')
const expected = JSON.parse(await readFile(`${bundle.path}/public/app/release.json`, 'utf8'))
for (const [repo, sha] of [['cloudpeak-app', expected.appSha], ['cloudpeak-web', expected.websiteSha]]) {
  const latest = execFileSync('git', ['ls-remote', `https://github.com/SirArthur2009/${repo}.git`, 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0]
  if (latest !== sha) throw new Error(`${repo} advanced during the build. A newer push will deploy the current revisions.`)
}
const result = spawnSync('railway', ['up', '--service', '11612220-77f2-4c35-85c9-dd99d1b0cb1b', '--environment', 'bd380cbe-c04c-4174-a8b7-5e126c99dc06', '--path-as-root', '--no-gitignore', '--detach', '--message', `app ${expected.appSha.slice(0, 12)} / website ${expected.websiteSha.slice(0, 12)}`, bundle.path], { stdio: 'inherit' })
if (result.status !== 0) throw new Error('Railway deployment failed.')
const origins = ['https://portal.cloudpeaksilverlabradors.com', 'https://cloudpeaksilverlabradors.com']
for (let attempt = 0; attempt < 36; attempt++) {
  const checks = await Promise.all(origins.map(async origin => {
    try {
      const read = async path => {
        const response = await fetch(`${origin}${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(10000), cache: 'no-store' })
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
        return response.json()
      }
      const release = await read('/release.json')
      const health = await read('/health')
      return { release, health }
    } catch (error) { console.log(`${origin}: ${error.message}`); return null }
  }))
  // Concurrent workflows in the two repositories can deploy the same revisions.
  // Require both domains to agree on one build, including a replacement build.
  if (checks.every(Boolean) && verifyRelease(checks, expected)) {
    console.log(`Both live domains verified at app ${expected.appSha} / website ${expected.websiteSha}, build ${checks[0].release.buildId}.`)
    process.exit(0)
  }
  console.log(`Waiting for both live domains at the expected revisions: ${JSON.stringify(checks)}`)
  await new Promise(resolve => setTimeout(resolve, 5000))
}
throw new Error('Live domains did not serve the expected healthy release within three minutes. Review Railway deployment status.')
