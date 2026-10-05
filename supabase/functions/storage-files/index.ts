import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from 'npm:@aws-sdk/client-s3@3.1144.0'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.1144.0'
import { createClient } from 'npm:@supabase/supabase-js@2.105.3'
import { createStorageHandler } from './handler.js'

const required = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
const storageSetting = (name: string) => Deno.env.get(`CLOUDPEAK_STORAGE_${name}`) || required(name)
const supabaseUrl = Deno.env.get('CLOUDPEAK_SUPABASE_URL') || required('SUPABASE_URL')
const anonKey = Deno.env.get('CLOUDPEAK_SUPABASE_ANON_KEY') || required('SUPABASE_ANON_KEY')
const Bucket = storageSetting('AWS_S3_BUCKET_NAME')
const s3 = new S3Client({
  endpoint: storageSetting('AWS_ENDPOINT_URL'), region: Deno.env.get('CLOUDPEAK_STORAGE_AWS_DEFAULT_REGION') || Deno.env.get('AWS_DEFAULT_REGION') || 'auto',
  forcePathStyle: (Deno.env.get('CLOUDPEAK_STORAGE_S3_FORCE_PATH_STYLE') || Deno.env.get('S3_FORCE_PATH_STYLE')) === 'true',
  credentials: { accessKeyId: storageSetting('AWS_ACCESS_KEY_ID'), secretAccessKey: storageSetting('AWS_SECRET_ACCESS_KEY') },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
})
const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
Deno.serve(createStorageHandler({
  origins: new Set(storageSetting('ALLOWED_ORIGINS').split(',').map(value => value.trim()).filter(Boolean)),
  async getUser(token: string) {
    const { data, error } = await auth.auth.getUser(token)
    return error ? null : data.user
  },
  async getRole(token: string, id: string) {
    const user = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
    const { data, error } = await user.from('profiles').select('role').eq('id', id).single()
    return error ? null : data?.role
  },
  readUrl: (Key: string, expiresIn: number) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn }),
  uploadUrl: (Key: string, ContentType: string, ContentLength: number) => getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength, IfNoneMatch: '*' }), { expiresIn: 600 }),
  async remove(keys: string[]) {
    const result = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map(Key => ({ Key })) } }))
    if (result.Errors?.length) throw new Error('Some files could not be deleted.')
  },
  async health() { await s3.send(new HeadObjectCommand({ Bucket, Key: '_migration/ready.json' })) },
}))
