import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

const cli = process.env.RAILWAY_CLI_BIN
if (!cli) throw new Error('Set RAILWAY_CLI_BIN.')
const env = { ...process.env, ...parseEnv(await readFile('deployment/.env.ci', 'utf8')) }
const identity = { projectId: 'ba2498be-e030-473a-81b4-a14d05dd8120', environmentId: 'bd380cbe-c04c-4174-a8b7-5e126c99dc06', serviceId: '11612220-77f2-4c35-85c9-dd99d1b0cb1b' }
function api(query, variables) {
  const result = spawnSync(cli, ['api', query, '--variables', '@-', '--compact'], { env, input: JSON.stringify(variables), encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Railway request failed; credentials withheld.')
  const body = JSON.parse(result.stdout)
  if (body.errors) throw new Error('Railway request returned errors; credentials withheld.')
  return body.data
}
const current = api('query($projectId:String!,$environmentId:String!,$serviceId:String!){variables(projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId)}', identity).variables
if (current.HOSTED_MODE !== 'live' || current.AUTH_PROVIDER !== 'better-auth' || current.APP_ORIGIN !== 'https://portal.cloudpeaksilverlabradors.com') throw new Error('Unexpected production configuration.')
const bundle = JSON.parse(await readFile('deployment/bundle/latest.json', 'utf8'))
const expected = JSON.parse(await readFile(`${bundle.path}/public/app/release.json`, 'utf8'))
if (bundle.buildMode !== 'live' || expected.authProvider !== 'better-auth') throw new Error('Expected a live Better Auth build.')
api('mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}', { input: { ...identity, skipDeploys: true, variables: { APPLICATION_EMAILS: 'cloudpeaksilverlabs@yahoo.com' } } })
console.log('Application recipient set to the business inbox; production configuration verified.')
const upload = spawnSync(cli, ['up', '--project', identity.projectId, '--service', identity.serviceId, '--environment', identity.environmentId, '--path-as-root', '--no-gitignore', '--detach', '--message', `Email formatting and message navigation ${expected.buildId}`, bundle.path], { env, stdio: 'inherit' })
if (upload.status !== 0) throw new Error('Release upload failed.')
console.log(`Uploaded release ${expected.buildId}.`)
