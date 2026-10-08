import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

const cli = process.env.RAILWAY_CLI_BIN
if (!cli) throw new Error('Set RAILWAY_CLI_BIN to the official Railway executable.')
const local = parseEnv(await readFile('database-service/.env', 'utf8'))
const env = { ...process.env, ...parseEnv(await readFile('deployment/.env.ci', 'utf8')) }
const identity = { projectId: 'ba2498be-e030-473a-81b4-a14d05dd8120', environmentId: 'bd380cbe-c04c-4174-a8b7-5e126c99dc06', serviceId: '11612220-77f2-4c35-85c9-dd99d1b0cb1b' }
function api(query, variables) {
  const result = spawnSync(cli, ['api', query, '--variables', '@-', '--compact'], { env, input: JSON.stringify(variables), encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Railway API request failed; credentials withheld.')
  const body = JSON.parse(result.stdout)
  if (body.errors) throw new Error('Railway API returned errors; credentials withheld.')
  return body.data
}
const variables = api('query($projectId:String!,$environmentId:String!,$serviceId:String!){variables(projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId)}', identity).variables
if (variables.HOSTED_MODE !== 'live') throw new Error('Expected the existing live deployment.')
const source = new URL(local.DATABASE_URL), target = new URL(variables.DATABASE_URL)
if (source.username !== target.username || source.password !== target.password || source.pathname !== target.pathname || target.hostname !== 'postgres.railway.internal') throw new Error('Deployed database differs from the verified import target.')
if (variables.APP_ORIGIN !== 'https://portal.cloudpeaksilverlabradors.com') throw new Error('Unexpected portal origin.')
console.log('Production targets the verified account-import database and portal.')
if (!process.argv.includes('--deploy')) process.exit(0)
if (!local.BETTER_AUTH_SECRET || local.BETTER_AUTH_SECRET.length < 32) throw new Error('Local Better Auth secret missing.')
const bundle = JSON.parse(await readFile('deployment/bundle/latest.json', 'utf8'))
const release = JSON.parse(await readFile(`${bundle.path}/public/app/release.json`, 'utf8'))
if (bundle.buildMode !== 'live' || release.authProvider !== 'better-auth' || !release.buildId) throw new Error('Prepare a live Better Auth bundle first.')
await writeFile('deployment/.ci-tools/better-auth-rollback.json', JSON.stringify({ createdAt: new Date().toISOString(), authProvider: variables.AUTH_PROVIDER || 'supabase', betterAuthUrl: variables.BETTER_AUTH_URL || null, buildId: release.buildId }))
api('mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}', { input: { ...identity, skipDeploys: true, variables: {
  AUTH_PROVIDER: 'better-auth', BETTER_AUTH_SECRET: variables.BETTER_AUTH_SECRET || local.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: `${variables.APP_ORIGIN}/railway-api/api/auth`,
} } })
console.log('Better Auth server settings saved without restarting the old release.')
const result = spawnSync(cli, ['up', '--project', identity.projectId, '--service', identity.serviceId, '--environment', identity.environmentId, '--path-as-root', '--no-gitignore', '--detach', '--message', `Better Auth migration ${release.buildId}`, bundle.path], { env, stdio: 'inherit' })
if (result.status !== 0) throw new Error('Upload failed; review deployment before restarting the old service.')
console.log(`Uploaded Better Auth release ${release.buildId}. Verify health and public auth endpoints before marking complete.`)
