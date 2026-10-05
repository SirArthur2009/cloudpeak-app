import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { clients } from '../storage-service/clients.js'

const require = createRequire(new URL('../storage-service/package.json',import.meta.url))
const { GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3')
const env = parseEnv(await readFile(new URL('../storage-service/.env',import.meta.url),'utf8'))
const {s3,bucket:Bucket} = clients(env)
let rules
try { rules = (await s3.send(new GetBucketCorsCommand({Bucket}))).CORSRules || [] }
catch (error) { if (error.name === 'NoSuchCORSConfiguration') rules=[]; else throw new Error(`Unable to read existing bucket CORS (${error.name}); not overwriting it.`) }
const origins = ['https://cloudpeak-hosted-test-production.up.railway.app','https://cloudpeak-hosted-test-production-0e41.up.railway.app']
if (process.argv.includes('--live')) origins.push('https://cloudpeaksilverlabradors.com','https://portal.cloudpeaksilverlabradors.com')
const id = 'cloudpeak-hosted-test'
const existing = rules.find(rule => rule.ID===id)
const rule = { ID:id, AllowedOrigins:origins, AllowedMethods:['GET','HEAD','PUT'], AllowedHeaders:['content-type','if-none-match','range','x-amz-*'], ExposeHeaders:['ETag','Content-Length','Content-Type'], MaxAgeSeconds:3600 }
if (existing) Object.assign(existing,rule)
else rules.push(rule)
await s3.send(new PutBucketCorsCommand({Bucket,CORSConfiguration:{CORSRules:rules}}))
const verified = (await s3.send(new GetBucketCorsCommand({Bucket}))).CORSRules || []
if (!origins.every(origin => verified.some(rule => rule.AllowedOrigins?.includes(origin)))) throw new Error('Hosted origin verification failed.')
console.log(`Added and verified ${origins.length} Cloudpeak origins; preserved existing bucket CORS rules.`)
