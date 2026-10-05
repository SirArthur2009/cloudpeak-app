import { PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { clients } from './clients.js'

const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
if (!origins.length || origins.includes('*')) throw new Error('Set specific ALLOWED_ORIGINS before configuring bucket CORS.')
for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error('CORS origins must not contain paths.')
const { s3, bucket: Bucket } = clients()
await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{
  AllowedOrigins: origins, AllowedMethods: ['GET', 'HEAD', 'PUT'],
  AllowedHeaders: ['content-type', 'if-none-match', 'range', 'x-amz-*'], ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'], MaxAgeSeconds: 3600,
}] } }))
console.log('Configured direct upload/download CORS for the specified origins.')
