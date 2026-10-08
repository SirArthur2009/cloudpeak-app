import { readFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'

const service = process.env.WEBSITE_RAILWAY_SERVICE_ID
if (!service) throw new Error('Configure WEBSITE_RAILWAY_SERVICE_ID before deploying the isolated website.')
const bundle = JSON.parse(await readFile('deployment/bundle/website-latest.json', 'utf8'))
const latest = execFileSync('git', ['ls-remote', 'https://github.com/SirArthur2009/cloudpeak-web.git', 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0]
if (latest !== bundle.release.websiteSha) throw new Error('Website advanced during the build; a newer push will deploy it.')
const upload = spawnSync('railway', ['up', '--service', service, '--environment', 'bd380cbe-c04c-4174-a8b7-5e126c99dc06', '--path-as-root', '--no-gitignore', '--detach', '--message', `website ${latest.slice(0, 12)}`, bundle.path], { stdio: 'inherit' })
if (upload.status !== 0) throw new Error('Website upload failed.')
const origin = process.env.WEBSITE_VERIFY_ORIGIN || 'https://cloudpeaksilverlabradors.com'
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const read = async path => {
      const response = await fetch(`${origin}${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
      return response.json()
    }
    const [release, health] = await Promise.all([read('/release.json'), read('/health')])
    if (release.service === 'website' && release.websiteSha === latest && release.runtimeSha === bundle.release.runtimeSha && health.ok === true && health.service === 'website') {
      console.log(`Independent website verified at ${latest}.`)
      process.exit(0)
    }
    console.log(`Waiting for website release: ${JSON.stringify({ release, health })}`)
  } catch (error) { console.log(`Waiting for website: ${error.message}`) }
  await new Promise(resolve => setTimeout(resolve, 5000))
}
throw new Error('Website did not become healthy at the expected revision.')
