import { S3Client } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

export function clients(env = process.env) {
  for (const name of ['AWS_ENDPOINT_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    if (!env[name]) throw new Error(`Missing ${name}`)
  }
  const s3 = new S3Client({
    endpoint: env.AWS_ENDPOINT_URL, region: env.AWS_DEFAULT_REGION || 'auto',
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  })
  return { s3, bucket: env.AWS_S3_BUCKET_NAME, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY,
    auth: createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) }
}
