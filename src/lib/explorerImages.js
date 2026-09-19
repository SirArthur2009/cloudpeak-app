import { supabase } from './supabase'
import * as tus from 'tus-js-client'

const IMAGE_EXTENSION = /\.(heic|heif|webp|gif|avif|bmp|tiff?|svg)$/i

export function isImageFile(file) {
  return file.type?.startsWith('image/') || IMAGE_EXTENSION.test(file.name)
}

export async function prepareExplorerFile(file) {
  if (!isImageFile(file)) return file
  const stem = file.name.replace(/\.[^.]+$/, '')
  if (file.type === 'image/jpeg') return /\.jpe?g$/i.test(file.name) ? file : new File([file], `${stem}.jpg`, { type: 'image/jpeg' })
  if (file.type === 'image/png') return /\.png$/i.test(file.name) ? file : new File([file], `${stem}.png`, { type: 'image/png' })
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type)) {
    const { default: heic2any } = await import('heic2any')
    try {
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      return new File([Array.isArray(converted) ? converted[0] : converted], `${stem}.jpg`, { type: 'image/jpeg' })
    } catch (error) {
      const readableType = error.message?.match(/Image is already browser readable: (image\/(?:jpeg|png|webp|gif))/i)?.[1]
      if (!readableType) throw error
      return prepareExplorerFile(new File([file], `${stem}.${readableType.split('/')[1]}`, { type: readableType }))
    }
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error(`Could not read ${file.name} as an image.`))
      element.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    if (!canvas.width || !canvas.height) throw new Error(`Could not read ${file.name} as an image.`)
    canvas.getContext('2d').drawImage(image, 0, 0)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(`Could not convert ${file.name}.`)), 'image/png'))
    return new File([blob], `${stem}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function publishExplorerImage(file, bucket) {
  const { data: current, error: lookupError } = await supabase.from('admin_files').select('*').eq('id', file.id).single()
  if (lookupError) throw lookupError
  file = current
  if (!isImageFile({ name: file.name, type: file.content_type })) throw new Error('Choose an image file.')
  if (file.storage_bucket && file.storage_bucket !== 'admin-files') {
    return supabase.storage.from(file.storage_bucket).getPublicUrl(file.storage_path).data.publicUrl
  }
  const { data, error } = await supabase.storage.from('admin-files').download(file.storage_path)
  if (error) throw error
  const prepared = await prepareExplorerFile(new File([data], file.name, { type: file.content_type || data.type }))
  const extension = prepared.type === 'image/png' ? 'png' : 'jpg'
  const path = `${crypto.randomUUID()}.${extension}`
  if (prepared.size > 6 * 1024 * 1024) {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session) throw new Error('Please sign in again before adding this image.')
    await new Promise((resolve, reject) => new tus.Upload(prepared, {
      endpoint: `${import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${session.access_token}` },
      metadata: { bucketName: bucket, objectName: path, contentType: prepared.type },
      chunkSize: 6 * 1024 * 1024, retryDelays: [0, 3000, 5000, 10000], removeFingerprintOnSuccess: true,
      onError: reject, onSuccess: resolve
    }).start())
  } else {
    const result = await supabase.storage.from(bucket).upload(path, prepared, { contentType: prepared.type })
    if (result.error) throw result.error
  }
  const { error: updateError } = await supabase.from('admin_files').update({ storage_bucket: bucket, storage_path: path, name: prepared.name, content_type: prepared.type, size_bytes: prepared.size }).eq('id', file.id)
  if (updateError) {
    await supabase.storage.from(bucket).remove([path])
    throw updateError
  }
  await supabase.storage.from('admin-files').remove([file.storage_path])
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
