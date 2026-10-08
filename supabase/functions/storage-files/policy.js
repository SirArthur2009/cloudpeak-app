export const buckets = new Set(['admin-files', 'owner-puppy-photos', 'puppy-photos', 'dog-photos', 'pedigree-files'])
export const publicBuckets = new Set(['puppy-photos', 'dog-photos', 'pedigree-files'])

export function objectKey(bucket, path) {
  if (!buckets.has(bucket) || typeof path !== 'string' || !path || path.length > 900 ||
    path.split('/').some(part => !part || part === '.' || part === '..') ||
    [...path].some(char => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw Object.assign(new Error('Invalid file path.'), { status: 400 })
  }
  return `${bucket}/${path}`
}

export function canAccess(role, bucket, action) {
  return role === 'admin' || (publicBuckets.has(bucket) && action === 'sign-read')
}
