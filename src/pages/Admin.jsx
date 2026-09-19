import { useState, useEffect, useRef, useMemo } from 'react'
import DOMPurify from 'dompurify'
import * as tus from 'tus-js-client'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import AdminFiles from './AdminFiles'
import AdminCampaigns from './AdminCampaigns'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const PORTAL_URL = import.meta.env.VITE_PORTAL_URL

const inputStyle = {
  padding: '0.6rem', border: '1px solid #ddd',
  borderRadius: '6px', fontSize: '16px', width: '100%'
}

const btnStyle = {
  padding: '0.5rem 1rem', borderRadius: '6px',
  border: 'none', cursor: 'pointer', fontSize: '0.9rem'
}

async function callFunction(name, body) {
  const baseUrl = (FUNCTIONS_URL || `${SUPABASE_URL}/functions/v1`).replace(/\/$/, '')
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token

  if (!accessToken) {
    throw new Error('Not authenticated. Please sign in again.')
  }

  const res = await fetch(`${baseUrl}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `Function ${name} failed with status ${res.status}`)
  }
  return data
}

function generateTemporaryPassword() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
  let out = ''
  for (let i = 0; i < 9; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  const specials = '!@#$%&*'
  out += specials[Math.floor(Math.random() * specials.length)]
  out += Math.floor(Math.random() * 90 + 10)
  return out
}

function isMissingLitterIdColumnError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes("could not find the 'litter_id' column") || msg.includes('column "litter_id" does not exist')
}
// ── Upload a single file to Supabase storage ──
async function uploadFile(bucket, file) {
  file = await browserReadablePhoto(file)
  const ext = file.name.split('.').pop()
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  if (file.size > 6 * 1024 * 1024) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Please sign in again before uploading.')
    await new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`,
        headers: { authorization: `Bearer ${session.access_token}` },
        metadata: { bucketName: bucket, objectName: path, contentType: file.type },
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000],
        removeFingerprintOnSuccess: true,
        onError: reject,
        onSuccess: resolve
      })
      upload.start()
    })
  } else {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type })
    if (error) throw error
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

async function browserReadablePhoto(file) {
  if (!/\.(heic|heif)$/i.test(file.name) && !/^image\/hei[cf]$/i.test(file.type)) return file
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  const jpeg = Array.isArray(converted) ? converted[0] : converted
  return new File([jpeg], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' })
}

// ── Single photo upload with crop ──
function PhotoUpload({ value, onChange, bucket }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [cropSrc, setCropSrc] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [Cropper, setCropper] = useState(null)

  useEffect(() => {
    import('react-easy-crop').then(m => setCropper(() => m.default))
  }, [])

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    try {
      const readable = await browserReadablePhoto(file)
      const reader = new FileReader()
      reader.onload = () => setCropSrc(reader.result)
      reader.onerror = () => alert(`Could not read ${file.name}.`)
      reader.readAsDataURL(readable)
    } catch (error) {
      alert(`Could not convert ${file.name}: ${error.message}`)
    }
  }

  async function getCroppedBlob(imageSrc, pixelCrop) {
    const image = await new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = imageSrc
    })
    const canvas = document.createElement('canvas')
    canvas.width = pixelCrop.width
    canvas.height = pixelCrop.height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height)
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92))
  }

  async function handleCropConfirm() {
    setUploading(true)
    try {
      const blob = await getCroppedBlob(cropSrc, croppedAreaPixels)
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      const { data } = supabase.storage.from(bucket).getPublicUrl(path)
      onChange(data.publicUrl)
      setCropSrc(null)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {cropSrc && Cropper && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1rem' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '360px', height: '360px', background: '#000' }}>
            <Cropper image={cropSrc} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', width: '100%', maxWidth: '360px' }}>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: '100%' }} />
            <p style={{ color: '#ccc', fontSize: '0.8rem' }}>Drag to reposition · Slider to zoom</p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', width: '100%', maxWidth: '360px' }}>
            <button onClick={handleCropConfirm} disabled={uploading} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>
              {uploading ? 'Uploading...' : 'Crop & Save'}
            </button>
            <button onClick={() => setCropSrc(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
          </div>
        </div>
      )}
      {value && <img src={value} alt="preview" style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e0e0e0' }} />}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button type="button" onClick={() => fileRef.current.click()} style={{ ...btnStyle, background: '#f0f0f0', border: '1px solid #ddd', fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}>
          {value ? 'Change Photo' : 'Upload Photo'}
        </button>
        {value && <button type="button" onClick={() => onChange('')} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', border: '1px solid #fcc', fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}>Remove</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

// ── Multi-photo manager for puppy_photos table ──
function PuppyPhotosManager({ puppyId }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [caption, setCaption] = useState('')
  const [cropQueue, setCropQueue] = useState([])   // [{file, dataUrl}]
  const [cropIndex, setCropIndex] = useState(0)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [Cropper, setCropper] = useState(null)
  const fileRef = useRef()
  const videoRef = useRef()

  async function handleVideoSelected(e) {
    const files = Array.from(e.target.files)
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) throw new Error('Choose an MP4, WebM, or MOV video.')
        const url = await uploadFile('puppy-photos', file)
        const { error } = await supabase.from('puppy_photos').insert({ puppy_id: puppyId, photo_url: url, caption: null, sort_order: photos.length + 1 })
        if (error) throw error
      }
      await fetchPhotos()
    } catch (err) {
      alert('Video upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    import('react-easy-crop').then(m => setCropper(() => m.default))
  }, [])

  useEffect(() => {
    if (puppyId && puppyId !== 'new') fetchPhotos()
  }, [puppyId])

  async function fetchPhotos() {
    const { data } = await supabase
      .from('puppy_photos')
      .select('*')
      .eq('puppy_id', puppyId)
      .order('sort_order')
      .order('created_at')
    setPhotos(data || [])
    setLoading(false)
  }

  // When files are selected, load them all into the crop queue
  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    e.target.value = ''
    setUploading(true)
    try {
      const queue = await Promise.all(files.map(async file => {
        const readable = await browserReadablePhoto(file)
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
          reader.readAsDataURL(readable)
        })
        return { file: readable, dataUrl }
      }))
      setCropQueue(queue)
      setCropIndex(0)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setCroppedAreaPixels(null)
    } catch (error) {
      alert(`Could not prepare photos: ${error.message}`)
    } finally {
      setUploading(false)
    }
  }

  async function getCroppedBlob(imageSrc, pixelCrop) {
    const image = await new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = imageSrc
    })
    const canvas = document.createElement('canvas')
    canvas.width = pixelCrop.width
    canvas.height = pixelCrop.height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height)
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92))
  }

  // Crop current photo and upload, then advance to next
  async function handleCropAndNext() {
    if (!croppedAreaPixels) return
    setUploading(true)
    try {
      const current = cropQueue[cropIndex]
      const blob = await getCroppedBlob(current.dataUrl, croppedAreaPixels)
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      const { error } = await supabase.storage.from('puppy-photos').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      const { data } = supabase.storage.from('puppy-photos').getPublicUrl(path)
      const { error: insertError } = await supabase.from('puppy_photos').insert({
        puppy_id: puppyId,
        photo_url: data.publicUrl,
        caption: caption || null,
        sort_order: photos.length + cropIndex
      })
      if (insertError) {
        await supabase.storage.from('puppy-photos').remove([path])
        throw insertError
      }

      if (cropIndex < cropQueue.length - 1) {
        // More photos to crop
        setCropIndex(i => i + 1)
        setCrop({ x: 0, y: 0 })
        setZoom(1)
        setCroppedAreaPixels(null)
      } else {
        // All done
        setCropQueue([])
        setCropIndex(0)
        setCaption('')
        await fetchPhotos()
      }
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
  }

  // Skip cropping current photo, upload as-is
  async function handleSkipCrop() {
    setUploading(true)
    try {
      const current = cropQueue[cropIndex]
      const url = await uploadFile('puppy-photos', current.file)
      const { error: insertError } = await supabase.from('puppy_photos').insert({
        puppy_id: puppyId,
        photo_url: url,
        caption: caption || null,
        sort_order: photos.length + cropIndex
      })
      if (insertError) throw insertError

      if (cropIndex < cropQueue.length - 1) {
        setCropIndex(i => i + 1)
        setCrop({ x: 0, y: 0 })
        setZoom(1)
        setCroppedAreaPixels(null)
      } else {
        setCropQueue([])
        setCropIndex(0)
        setCaption('')
        await fetchPhotos()
      }
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
  }

  function handleCancelQueue() {
    setCropQueue([])
    setCropIndex(0)
    setCroppedAreaPixels(null)
  }

  async function handleDelete(photoId) {
    if (!confirm('Delete this photo or video?')) return
    await supabase.from('puppy_photos').delete().eq('id', photoId)
    fetchPhotos()
  }

  async function handleCaptionUpdate(photoId, newCaption) {
    await supabase.from('puppy_photos').update({ caption: newCaption }).eq('id', photoId)
    fetchPhotos()
  }

  async function handleMoveUp(index) {
    if (index === 0) return
    const updated = [...photos]
    const [moved] = updated.splice(index, 1)
    updated.splice(index - 1, 0, moved)
    await Promise.all(updated.map((ph, i) =>
      supabase.from('puppy_photos').update({ sort_order: i }).eq('id', ph.id)
    ))
    fetchPhotos()
  }

  async function handleMoveDown(index) {
    if (index === photos.length - 1) return
    const updated = [...photos]
    const [moved] = updated.splice(index, 1)
    updated.splice(index + 1, 0, moved)
    await Promise.all(updated.map((ph, i) =>
      supabase.from('puppy_photos').update({ sort_order: i }).eq('id', ph.id)
    ))
    fetchPhotos()
  }

  if (puppyId === 'new') {
    return <p style={{ fontSize: '0.85rem', color: '#888' }}>Save the puppy first, then you can add photos.</p>
  }

  const currentPhoto = cropQueue[cropIndex]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Crop modal — shown when queue has items */}
      {cropQueue.length > 0 && Cropper && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1rem' }}>
          {/* Progress */}
          <p style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 600 }}>
            Photo {cropIndex + 1} of {cropQueue.length} — {currentPhoto.file.name}
          </p>

          {/* Cropper */}
          <div style={{ position: 'relative', width: '100%', maxWidth: '380px', height: '380px', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
            <Cropper
              image={currentPhoto.dataUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
            />
          </div>

          {/* Zoom slider */}
          <div style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: '100%' }} />
            <p style={{ color: '#aaa', fontSize: '0.75rem', textAlign: 'center' }}>Drag to reposition · Slider to zoom</p>
          </div>

          {/* Caption for this photo */}
          <input
            style={{ width: '100%', maxWidth: '380px', padding: '0.6rem', borderRadius: '6px', border: '1px solid #555', background: '#222', color: '#fff', fontSize: '0.9rem' }}
            placeholder={`Caption for photo ${cropIndex + 1} (optional)`}
            value={caption}
            onChange={e => setCaption(e.target.value)}
          />

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', width: '100%', maxWidth: '380px' }}>
            <button
              onClick={handleCropAndNext}
              disabled={uploading}
              style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 2, padding: '0.75rem', border: '2px solid #fff' }}
            >
              {uploading ? 'Uploading...' : cropIndex < cropQueue.length - 1 ? `Crop & Save → Next` : `Crop & Save ✓`}
            </button>
            <button
              onClick={handleSkipCrop}
              disabled={uploading}
              style={{ ...btnStyle, background: '#333', color: '#ccc', flex: 1, padding: '0.75rem' }}
            >
              {cropIndex < cropQueue.length - 1 ? 'Skip crop →' : 'Skip crop ✓'}
            </button>
          </div>
          <button
            onClick={handleCancelQueue}
            disabled={uploading}
            style={{ color: '#888', background: 'none', border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            Cancel all remaining
          </button>
        </div>
      )}

      {/* Upload area */}
      <div style={{ background: '#f5f5f3', border: '2px dashed #ddd', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p style={{ fontSize: '0.85rem', color: '#666', fontWeight: 500 }}>Add photos — you'll crop each one before it saves</p>
        <button
          type="button"
          onClick={() => fileRef.current.click()}
          style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', padding: '0.65rem' }}
        >
          + Select Photos
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFilesSelected} />
        <button type="button" disabled={uploading} onClick={() => videoRef.current.click()} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', padding: '0.65rem' }}>
          {uploading ? 'Uploading...' : '+ Select Videos'}
        </button>
        <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mov" multiple style={{ display: 'none' }} onChange={handleVideoSelected} />
      </div>

      {/* Photo list */}
      {loading && <p style={{ color: '#888', fontSize: '0.85rem' }}>Loading photos...</p>}
      {!loading && photos.length === 0 && <p style={{ color: '#aaa', fontSize: '0.85rem' }}>No photos yet.</p>}
      {photos.map((ph, i) => (
        <PhotoRow
          key={ph.id}
          photo={ph}
          index={i}
          total={photos.length}
          onDelete={() => handleDelete(ph.id)}
          onMoveUp={() => handleMoveUp(i)}
          onMoveDown={() => handleMoveDown(i)}
          onCaptionUpdate={newCaption => handleCaptionUpdate(ph.id, newCaption)}
        />
      ))}
    </div>
  )
}

function PhotoRow({ photo, index, total, onDelete, onMoveUp, onMoveDown, onCaptionUpdate }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(photo.caption || '')

  return (
    <div style={{ display: 'flex', gap: '0.75rem', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '0.75rem', alignItems: 'flex-start' }}>
      {/\.(mp4|webm|mov)(?:\?|$)/i.test(photo.photo_url)
        ? <video src={photo.photo_url} muted playsInline preload="metadata" style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
        : <img src={photo.photo_url} alt={photo.caption || `Photo ${index + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              style={{ ...inputStyle, fontSize: '0.85rem', flex: 1 }}
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Caption..."
            />
            <button onClick={() => { onCaptionUpdate(caption); setEditing(false) }} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ ...btnStyle, background: '#f0f0f0', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>✕</button>
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: photo.caption ? '#333' : '#aaa', marginBottom: '0.35rem' }}>
            {photo.caption || 'No caption'}
            <button onClick={() => setEditing(true)} style={{ ...btnStyle, background: 'none', border: 'none', color: '#888', fontSize: '0.75rem', padding: '0 0.4rem', marginLeft: '0.25rem' }}>edit</button>
          </p>
        )}
        <p style={{ fontSize: '0.75rem', color: '#aaa' }}>Photo {index + 1} of {total}</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
        <button onClick={onMoveUp} disabled={index === 0} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.25rem 0.5rem', fontSize: '0.8rem', opacity: index === 0 ? 0.3 : 1 }}>↑</button>
        <button onClick={onMoveDown} disabled={index === total - 1} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.25rem 0.5rem', fontSize: '0.8rem', opacity: index === total - 1 ? 0.3 : 1 }}>↓</button>
        <button onClick={onDelete} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>✕</button>
      </div>
    </div>
  )
}

// ── Pedigree upload ──
function PedigreeUpload({ value, onChange }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadFile('pedigree-files', file)
      onChange(url)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => fileRef.current.click()} disabled={uploading} style={{ ...btnStyle, background: '#f0f0f0', border: '1px solid #ddd', fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}>
          {uploading ? 'Uploading...' : value ? 'Replace File' : 'Upload PDF / Image'}
        </button>
        {value && <a href={value} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: '#1a1a1a', textDecoration: 'underline' }}>View current file</a>}
      </div>
      <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

function FormGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
      {children}
    </div>
  )
}

// ── COLLAR COLOR OPTIONS ──
const COLLAR_COLORS = [
  { label: 'Yellow', hex: '#f5c842' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Purple', hex: '#a855f7' },
  { label: 'Red', hex: '#ef4444' },
  { label: 'Green', hex: '#22c55e' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Teal', hex: '#14b8a6' },
  { label: 'White', hex: '#e5e7eb' },
  { label: 'Black', hex: '#374151' },
  { label: 'Brown', hex: '#92400e' },
  { label: 'Lime', hex: '#84cc16' },
]

function CollarColorPicker({ value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Collar color</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {COLLAR_COLORS.map(c => (
          <button
            key={c.label}
            type="button"
            title={c.label}
            onClick={() => onChange(c.label)}
            style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: c.hex, border: value === c.label ? '3px solid #1a1a1a' : '2px solid rgba(0,0,0,0.1)',
              cursor: 'pointer', flexShrink: 0, transition: 'transform 0.1s',
              transform: value === c.label ? 'scale(1.2)' : 'scale(1)'
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange('')}
          title="None"
          style={{ ...btnStyle, fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: '#f0f0f0', border: '1px solid #ddd' }}
        >
          None
        </button>
      </div>
      {value && (
        <p style={{ fontSize: '0.8rem', color: '#666' }}>
          Selected: <strong>{value}</strong>
        </p>
      )}
    </div>
  )
}

// ── PUPPIES TAB (updated with collar_color + unlimited photos) ──
function PuppiesTab() {
  const [puppies, setPuppies] = useState([])
  const [litters, setLitters] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [photosTab, setPhotosTab] = useState(false)
  const [form, setForm] = useState({
    name: '', gender: '', color: '', collar_color: '',
    status: 'available', litter_id: '', notes: '', photo_url: ''
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [reservers, setReservers] = useState({})

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: p }, { data: l }, { data: r }] = await Promise.all([
      supabase.from('puppies').select('*, litters(name)').order('id'),
      supabase.from('litters').select('*').order('id'),
      supabase.from('waitlist').select('selected_puppy_id, name').not('selected_puppy_id', 'is', null)
    ])
    setPuppies(p || [])
    setLitters(l || [])
    setReservers(Object.fromEntries((r || []).map(e => [e.selected_puppy_id, e.name])))
    setLoading(false)
  }

  function startEdit(puppy) {
    setEditing(puppy.id)
    setPhotosTab(false)
    setForm({
      name: puppy.name || '',
      gender: puppy.gender || '',
      color: puppy.color || '',
      collar_color: puppy.collar_color || '',
      status: puppy.status || 'available',
      litter_id: puppy.litter_id || '',
      notes: puppy.notes || '',
      photo_url: puppy.photo_url || ''
    })
  }

  function startNew() {
    setEditing('new')
    setPhotosTab(false)
    setForm({ name: '', gender: '', color: '', collar_color: '', status: 'available', litter_id: '', notes: '', photo_url: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const payload = {
      name: form.name,
      gender: form.gender,
      color: form.color,
      collar_color: form.collar_color || null,
      status: form.status,
      litter_id: form.litter_id || null,
      notes: form.notes,
      photo_url: form.photo_url
    }
    const { error, data } = editing === 'new'
      ? await supabase.from('puppies').insert(payload).select().single()
      : await supabase.from('puppies').update(payload).eq('id', editing).select().single()

    if (error) {
      setMessage('Error: ' + error.message)
    } else {
      setMessage('Saved!')
      // If new puppy, switch to photos tab so they can add photos immediately
      if (editing === 'new' && data?.id) {
        setEditing(data.id)
        setPhotosTab(true)
      } else {
        setEditing(null)
      }
      fetchAll()
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this puppy and all their photos?')) return
    await supabase.from('puppy_photos').delete().eq('puppy_id', id)
    await supabase.from('puppies').delete().eq('id', id)
    fetchAll()
  }

  async function handleUnreserve(puppy) {
    if (!confirm(`Mark ${puppy.name || 'this puppy'} as available again?`)) return
    setSaving(true)
    await supabase.from('puppies').update({ status: 'available' }).eq('id', puppy.id)
    await supabase.from('waitlist').update({ selected_puppy_id: null, pending_approval: false, is_active: true }).eq('selected_puppy_id', puppy.id)
    setMessage(`${puppy.name || 'Puppy'} is now available again.`)
    fetchAll()
    setSaving(false)
  }

  if (loading) return <p style={{ color: '#888' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 600 }}>Puppies</h3>
        <button onClick={startNew} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>+ Add Puppy</button>
      </div>

      {message && <p style={{ color: message.startsWith('Error') ? 'red' : 'green', marginBottom: '1rem' }}>{message}</p>}

      {editing && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h4 style={{ fontWeight: 600 }}>{editing === 'new' ? 'Add New Puppy' : 'Edit Puppy'}</h4>
            {editing !== 'new' && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setPhotosTab(false)}
                  style={{ ...btnStyle, background: !photosTab ? '#1a1a1a' : '#f0f0f0', color: !photosTab ? '#fff' : '#333', fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                >
                  Details
                </button>
                <button
                  onClick={() => setPhotosTab(true)}
                  style={{ ...btnStyle, background: photosTab ? '#1a1a1a' : '#f0f0f0', color: photosTab ? '#fff' : '#333', fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                >
                  Photos
                </button>
              </div>
            )}
          </div>

          {!photosTab ? (
            <>
              <FormGrid>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label>
                  <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Blue collar male" />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Gender</label>
                  <select style={inputStyle} value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Color</label>
                  <input style={inputStyle} value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} placeholder="Silver, Charcoal..." />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Status</label>
                  <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="sold">Sold</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Litter</label>
                  <select style={inputStyle} value={form.litter_id} onChange={e => setForm({ ...form, litter_id: e.target.value })}>
                    <option value="">None</option>
                    {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Cover photo (thumbnail)</label>
                  <PhotoUpload value={form.photo_url} onChange={url => setForm({ ...form, photo_url: url })} bucket="puppy-photos" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <CollarColorPicker value={form.collar_color} onChange={val => setForm({ ...form, collar_color: val })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Notes</label>
                  <textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </FormGrid>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>
                  {saving ? 'Saving...' : editing === 'new' ? 'Save & Add Photos →' : 'Save'}
                </button>
                <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }}>
                Add as many photos as you like. The first photo (or cover photo from Details) is used as the thumbnail in the gallery. All photos appear on the puppy's individual page.
              </p>
              <PuppyPhotosManager puppyId={editing} />
              <div style={{ marginTop: '1rem' }}>
                <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', padding: '0.65rem 1.5rem' }}>Done</button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {puppies.map(p => {
          const collarColor = COLLAR_COLORS.find(c => c.label === p.collar_color)
          return (
            <div key={p.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              {p.photo_url
                ? <img src={p.photo_url} alt={p.name} style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
                : <div style={{ width: '56px', height: '56px', background: '#f0f0f0', borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: '1.5rem' }}>🐾</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {collarColor && (
                      <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: collarColor.hex, border: '1.5px solid rgba(0,0,0,0.15)', flexShrink: 0, display: 'inline-block' }} title={collarColor.label} />
                    )}
                    <p style={{ fontWeight: 600 }}>{p.name || `${p.collar_color || p.color || '—'} collar`}</p>
                  </div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'capitalize', padding: '0.2rem 0.5rem', borderRadius: '20px', whiteSpace: 'nowrap', background: p.status === 'available' ? '#e6f4ea' : p.status === 'reserved' ? '#fff4e5' : '#f0f0f0', color: p.status === 'available' ? '#2d7a3a' : p.status === 'reserved' ? '#b36200' : '#888' }}>
                    {p.status}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#666' }}>
                  {[p.gender, p.color, p.collar_color ? `${p.collar_color} collar` : null].filter(Boolean).join(' · ')}
                </p>
                {p.litters?.name && <p style={{ fontSize: '0.8rem', color: '#888' }}>{p.litters.name}</p>}
                {p.status === 'reserved' && reservers[p.id] && <p style={{ fontSize: '0.8rem', color: '#888' }}>Reserved by {reservers[p.id]}</p>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
                {p.status === 'reserved' && (
                  <button onClick={() => handleUnreserve(p)} style={{ ...btnStyle, background: '#fff4e5', color: '#b36200', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Unreserve</button>
                )}
                <button onClick={() => { startEdit(p); setPhotosTab(true) }} style={{ ...btnStyle, background: '#e6f4ea', color: '#2d7a3a', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Photos</button>
                <button onClick={() => startEdit(p)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
                <button onClick={() => handleDelete(p.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── LITTERS TAB ──
// Portal uses: birth_date, mother_id, father_id (existing columns)
// Public site uses: born_date, sire, dam, expected_date, go_home_date, colors, status
// We write to both so both work
function LittersTab() {
  const [litters, setLitters] = useState([])
  const [dogs, setDogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({
    name: '', sire: '', dam: '', birth_date: '',
    expected_date: '', go_home_date: '',
    colors: '', status: 'upcoming', notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: l }, { data: d }] = await Promise.all([
      supabase.from('litters').select('*, mother:dogs!litters_mother_id_fkey(name), father:dogs!litters_father_id_fkey(name)').order('created_at', { ascending: false }),
      supabase.from('dogs').select('*').order('name')
    ])
    setLitters(l || [])
    setDogs(d || [])
    setLoading(false)
  }

  function startEdit(litter) {
    setEditing(litter.id)
    setForm({
      name: litter.name || '',
      sire: litter.sire || litter.father?.name || '',
      dam: litter.dam || litter.mother?.name || '',
      birth_date: litter.birth_date || litter.born_date || '',
      expected_date: litter.expected_date || '',
      go_home_date: litter.go_home_date || '',
      colors: litter.colors || '',
      status: litter.status || 'upcoming',
      notes: litter.notes || ''
    })
  }

  function startNew() {
    setEditing('new')
    setForm({ name: '', sire: '', dam: '', birth_date: '', expected_date: '', go_home_date: '', colors: '', status: 'upcoming', notes: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    // Write to both portal columns and public site columns
    const payload = {
      name: form.name,
      sire: form.sire || null,
      dam: form.dam || null,
      birth_date: form.birth_date || null,   // portal uses birth_date
      born_date: form.birth_date || null,    // public site uses born_date
      expected_date: form.expected_date || null,
      go_home_date: form.go_home_date || null,
      colors: form.colors || null,
      status: form.status,
      notes: form.notes
    }
    const { error } = editing === 'new'
      ? await supabase.from('litters').insert(payload)
      : await supabase.from('litters').update(payload).eq('id', editing)
    if (error) setMessage('Error: ' + error.message)
    else { setMessage('Saved!'); setEditing(null); fetchAll() }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this litter?')) return
    await supabase.from('litters').delete().eq('id', id)
    fetchAll()
  }

  if (loading) return <p style={{ color: '#888' }}>Loading...</p>

  const statusColors = { upcoming: '#EEF2FF', available: '#e6f4ea', limited: '#fff4e5', placed: '#f0f0f0' }
  const statusText = { upcoming: '#3730A3', available: '#2d7a3a', limited: '#b36200', placed: '#888' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 600 }}>Litters</h3>
        <button onClick={startNew} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>+ Add Litter</button>
      </div>

      {message && <p style={{ color: message.startsWith('Error') ? 'red' : 'green', marginBottom: '1rem' }}>{message}</p>}

      {editing && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>{editing === 'new' ? 'Add New Litter' : 'Edit Litter'}</h4>
          <FormGrid>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Litter name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ozzie & Sadie 2026" /></div>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#666' }}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="upcoming">Upcoming</option>
                <option value="available">Available</option>
                <option value="limited">Limited</option>
                <option value="placed">Fully placed</option>
              </select>
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Sire (dad)</label><input style={inputStyle} value={form.sire} onChange={e => setForm({ ...form, sire: e.target.value })} placeholder="Ozzie" /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Dam (mom)</label><input style={inputStyle} value={form.dam} onChange={e => setForm({ ...form, dam: e.target.value })} placeholder="Sadie" /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Expected date</label><input type="date" style={inputStyle} value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Born date</label><input type="date" style={inputStyle} value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Go home date</label><input type="date" style={inputStyle} value={form.go_home_date} onChange={e => setForm({ ...form, go_home_date: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Colors</label><input style={inputStyle} value={form.colors} onChange={e => setForm({ ...form, colors: e.target.value })} placeholder="Silver, Charcoal" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '0.8rem', color: '#666' }}>Notes</label><textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </FormGrid>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {litters.map(l => (
          <div key={l.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <p style={{ fontWeight: 600 }}>{l.name}</p>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '20px', background: statusColors[l.status] || '#f0f0f0', color: statusText[l.status] || '#888', textTransform: 'capitalize' }}>{l.status || 'upcoming'}</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#666' }}>
                {[l.sire || l.father?.name, l.dam || l.mother?.name].filter(Boolean).join(' × ') || 'No parents set'}
              </p>
              <p style={{ fontSize: '0.8rem', color: '#aaa' }}>
                {l.birth_date || l.born_date ? `Born ${l.birth_date || l.born_date}` : l.expected_date ? `Expected ${l.expected_date}` : 'No dates set'}
                {l.colors ? ` · ${l.colors}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
              <button onClick={() => startEdit(l)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
              <button onClick={() => handleDelete(l.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── DOGS TAB (unchanged from original) ──
function DogsTab() {
  const [dogs, setDogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', registration_number: '', pedigree_url: '', photo_url: '', embark_url: '', ofa_url: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const { data } = await supabase.from('dogs').select('*').order('name')
    setDogs(data || [])
    setLoading(false)
  }

  function startEdit(dog) {
    setEditing(dog.id)
    setForm({ name: dog.name || '', registration_number: dog.registration_number || '', pedigree_url: dog.pedigree_url || '', photo_url: dog.photo_url || '', embark_url: dog.embark_url || '', ofa_url: dog.ofa_url || '', notes: dog.notes || '' })
  }

  function startNew() {
    setEditing('new')
    setForm({ name: '', registration_number: '', pedigree_url: '', photo_url: '', embark_url: '', ofa_url: '', notes: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const payload = { name: form.name, registration_number: form.registration_number, pedigree_url: form.pedigree_url, photo_url: form.photo_url, embark_url: form.embark_url, ofa_url: form.ofa_url, notes: form.notes }
    const { error } = editing === 'new'
      ? await supabase.from('dogs').insert(payload)
      : await supabase.from('dogs').update(payload).eq('id', editing)
    if (error) setMessage('Error: ' + error.message)
    else { setMessage('Saved!'); setEditing(null); fetchAll() }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this dog?')) return
    await supabase.from('dogs').delete().eq('id', id)
    fetchAll()
  }

  if (loading) return <p style={{ color: '#888' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 600 }}>Our dogs</h3>
        <button onClick={startNew} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>+ Add Dog</button>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '1rem' }}>These sync with the Pedigrees tab in the client portal and photos on the public site.</p>

      {message && <p style={{ color: message.startsWith('Error') ? 'red' : 'green', marginBottom: '1rem' }}>{message}</p>}

      {editing && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>{editing === 'new' ? 'Add Dog' : 'Edit Dog'}</h4>
          <FormGrid>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Registration #</label><input style={inputStyle} value={form.registration_number} onChange={e => setForm({ ...form, registration_number: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Photo</label><PhotoUpload value={form.photo_url} onChange={url => setForm({ ...form, photo_url: url })} bucket="dog-photos" /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Embark URL</label><input style={inputStyle} value={form.embark_url} onChange={e => setForm({ ...form, embark_url: e.target.value })} placeholder="http://embk.me/..." /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>OFA URL</label><input style={inputStyle} value={form.ofa_url} onChange={e => setForm({ ...form, ofa_url: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Pedigree file</label><PedigreeUpload value={form.pedigree_url} onChange={url => setForm({ ...form, pedigree_url: url })} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '0.8rem', color: '#666' }}>Notes</label><textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </FormGrid>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {dogs.map(d => (
          <div key={d.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            {d.photo_url ? <img src={d.photo_url} alt={d.name} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '50%', flexShrink: 0 }} /> : <div style={{ width: '48px', height: '48px', background: '#f0f0f0', borderRadius: '50%', flexShrink: 0 }} />}
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600 }}>{d.name}</p>
              {d.registration_number && <p style={{ fontSize: '0.8rem', color: '#888' }}>Reg: {d.registration_number}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                {d.embark_url && <a href={d.embark_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#5b4fcf' }}>Embark ↗</a>}
                {d.ofa_url && <a href={d.ofa_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#1a6b3c' }}>OFA ↗</a>}
                {d.pedigree_url && <a href={d.pedigree_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#333' }}>Pedigree ↗</a>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
              <button onClick={() => startEdit(d)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
              <button onClick={() => handleDelete(d.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WaitlistTab() {
  const [waitlist, setWaitlist] = useState([])
  const [litters, setLitters] = useState([])
  const [selectedLitterId, setSelectedLitterId] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', position: '', notes: '', password: '', litter_id: '' })
  const [saving, setSaving] = useState(false)
  const [resettingWaitlistId, setResettingWaitlistId] = useState(null)
  const [message, setMessage] = useState('')
  const [activePerson, setActivePerson] = useState(null)
  const [pendingPerson, setPendingPerson] = useState(null)
  const [nextInLine, setNextInLine] = useState(null)
  const [showMoveNext, setShowMoveNext] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll(forLitterId = selectedLitterId) {
    const [{ data: waitlistData }, { data: littersData }, { data: puppiesData }] = await Promise.all([
      supabase.from('waitlist').select('*, puppies(name, color, gender)').order('position'),
      supabase.from('litters').select('id, name').order('created_at', { ascending: false }),
      supabase.from('puppies').select('litter_id, status')
    ])
    const litterList = littersData || []
    const puppyStatsByLitter = new Map()

    for (const puppy of puppiesData || []) {
      const litterId = String(puppy.litter_id || '')
      if (!litterId) continue
      const current = puppyStatsByLitter.get(litterId) || { total: 0, available: 0 }
      current.total += 1
      if (puppy.status === 'available') current.available += 1
      puppyStatsByLitter.set(litterId, current)
    }

    const eligibleLitters = litterList.filter((litter) => {
      const stats = puppyStatsByLitter.get(String(litter.id))
      return !stats || stats.total === 0 || stats.available > 0
    })

    setLitters(eligibleLitters)

    const eligibleLitterIds = new Set(eligibleLitters.map(litter => String(litter.id)))
    const currentLitterId = eligibleLitterIds.has(String(forLitterId || ''))
      ? String(forLitterId)
      : (eligibleLitters[0] ? String(eligibleLitters[0].id) : '')

    if (currentLitterId !== selectedLitterId) {
      setSelectedLitterId(currentLitterId)
    }

    const listForLitter = (waitlistData || []).filter(w => String(w.litter_id || '') === currentLitterId)
    const list = listForLitter.sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    setWaitlist(list)
    const active = list.find(w => w.is_active && !w.pending_approval) || null
    const pending = list.find(w => w.pending_approval) || null
    setActivePerson(active)
    setPendingPerson(pending)
    const waiting = list.filter(w => !w.is_active && !w.selected_puppy_id && !w.pending_approval)
    const next = waiting[0] || null
    setNextInLine(next)
    setShowMoveNext(!active && !pending && !!next)
    setLoading(false)
  }

  useEffect(() => {
    if (!selectedLitterId) return
    fetchAll()
  }, [selectedLitterId])

  function startNew() {
    if (!selectedLitterId) {
      setMessage('Choose a litter first.')
      return
    }
    setEditing('new')
    setForm({ name: '', email: '', phone: '', position: waitlist.length + 1, notes: '', password: generateTemporaryPassword(), litter_id: selectedLitterId })
  }

  function startEdit(person) {
    setEditing(person.id)
    setForm({ name: person.name || '', email: person.email || '', phone: person.phone || '', position: person.position || '', notes: person.notes || '', password: '', litter_id: String(person.litter_id || selectedLitterId || '') })
  }

  async function handleResetPasswordForWaitlist(person) {
    if (!person.email) {
      setMessage('Error: This person has no email address.')
      return
    }
    if (!confirm(`Reset portal password for ${person.name} (${person.email}) and email them a new temporary password?`)) return

    setResettingWaitlistId(person.id)
    setMessage('')
    try {
      const tempPassword = generateTemporaryPassword()
      await callFunction('create-client-user', {
        email: person.email,
        password: tempPassword,
        name: person.name,
        phone: person.phone,
        role: 'client',
        must_change_password: true
      })
      await callFunction('send-client-portal-credentials', {
        clientName: person.name,
        clientEmail: person.email,
        password: tempPassword,
        portalUrl: PORTAL_URL,
        isReset: true,
        mustChangePassword: true
      })
      setMessage(`Password for ${person.name} reset to "${tempPassword}" and emailed to ${person.email}!`)
    } catch (err) {
      setMessage(`Error: ${err.message || 'Failed to reset password'}`)
    }
    setResettingWaitlistId(null)
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    let migrationWarning = ''
    if (!form.litter_id) { setMessage('Please select a litter.'); setSaving(false); return }

    if (editing === 'new') {
      if (!form.email || !form.password) { setMessage('Email and password are required for new entries.'); setSaving(false); return }

      const email = form.email.trim().toLowerCase()
      const fullName = form.name.trim() || 'New Client'
      const phone = form.phone.trim()

      let highestPositionRow = null
      const highestByLitter = await supabase
        .from('waitlist')
        .select('position')
        .eq('litter_id', form.litter_id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (highestByLitter.error && isMissingLitterIdColumnError(highestByLitter.error)) {
        const fallbackHighest = await supabase
          .from('waitlist')
          .select('position')
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()
        highestPositionRow = fallbackHighest.data || null
      } else {
        highestPositionRow = highestByLitter.data || null
      }

      const defaultPosition = Number(highestPositionRow?.position || 0) + 1
      const position = Number(form.position || defaultPosition)

      let { error } = await supabase.from('waitlist').insert({
        name: fullName,
        email,
        phone,
        position,
        notes: form.notes,
        litter_id: form.litter_id
      })
      if (error && isMissingLitterIdColumnError(error)) {
        const retry = await supabase.from('waitlist').insert({
          name: fullName,
          email,
          phone,
          position,
          notes: form.notes
        })
        error = retry.error
        if (!error) {
          migrationWarning = 'Added without litter assignment. Run the waitlist litter_id migration to enable per-litter queueing.'
        }
      }

      if (error) {
        setMessage('Error: ' + error.message)
      } else {
        try {
          await callFunction('create-client-user', {
            email,
            password: form.password,
            name: fullName,
            phone,
            role: 'client',
            must_change_password: true
          })
          await callFunction('send-client-portal-credentials', {
            clientName: fullName,
            clientEmail: email,
            password: form.password,
            portalUrl: PORTAL_URL,
            mustChangePassword: true
          })
        } catch (authErr) {
          console.error('Failed to create client auth account:', authErr)
          migrationWarning += ` (Note on account setup: ${authErr.message || 'Check Users tab'})`
        }

        await supabase
          .from('applications')
          .update({ status: 'reviewed' })
          .eq('email', email)
          .or('status.is.null,status.eq.new')

        const nextLitterId = String(form.litter_id)
        setMessage(migrationWarning || `Added ${fullName} to waitlist and emailed credentials!`)
        setEditing(null)
        setSelectedLitterId(nextLitterId)
        fetchAll(nextLitterId)
      }
    } else {
      let { error } = await supabase.from('waitlist').update({
        name: form.name,
        email: form.email,
        phone: form.phone,
        position: Number(form.position),
        notes: form.notes,
        litter_id: form.litter_id
      }).eq('id', editing)
      if (error && isMissingLitterIdColumnError(error)) {
        const retry = await supabase.from('waitlist').update({
          name: form.name,
          email: form.email,
          phone: form.phone,
          position: Number(form.position),
          notes: form.notes
        }).eq('id', editing)
        error = retry.error
        if (!error) {
          migrationWarning = 'Saved without litter assignment. Run the waitlist litter_id migration to enable per-litter queueing.'
        }
      }
      if (error) setMessage('Error: ' + error.message)
      else {
        const nextLitterId = String(form.litter_id)
        setMessage(migrationWarning || 'Saved!')
        setEditing(null)
        setSelectedLitterId(nextLitterId)
        fetchAll(nextLitterId)
      }
    }
    setSaving(false)
  }

  async function handleApprove(person) {
    setSaving(true)
    setMessage('')
    await Promise.all([
      supabase.from('waitlist').update({ pending_approval: false }).eq('id', person.id),
      supabase.from('puppies').update({ status: 'reserved' }).eq('id', person.selected_puppy_id)
    ])
    setMessage(`${person.name}'s selection approved!`)
    fetchAll()
    setSaving(false)
  }

  async function handleMoveToNext() {
  if (!nextInLine) return
  if (!confirm(`Let ${nextInLine.name} choose their puppy now?`)) return
  setSaving(true)
  setMessage('')
  await supabase.from('waitlist').update({ is_active: true }).eq('id', nextInLine.id)
  try {
    const result = await callFunction('send-turn-email', {
      clientName: nextInLine.name,
      clientEmail: nextInLine.email,
      portalUrl: PORTAL_URL
    })
    console.log('send-turn-email result:', result)
    setMessage(`${nextInLine.name} has been notified and can now choose their puppy.`)
  } catch (err) {
    console.error('send-turn-email error:', err)
    setMessage(`${nextInLine.name} is now active. Email failed — notify them manually.`)
  }
  fetchAll()
  setSaving(false)
}

  async function handleUnselect(person) {
    if (!confirm(`Clear ${person.name}'s selection?`)) return
    setSaving(true)
    await Promise.all([
      supabase.from('waitlist').update({ selected_puppy_id: null, pending_approval: false, is_active: true }).eq('id', person.id),
      supabase.from('puppies').update({ status: 'available' }).eq('id', person.selected_puppy_id)
    ])
    setMessage(`${person.name}'s selection has been cleared.`)
    fetchAll()
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this person from the waitlist and delete their account?')) return
    setSaving(true)
    setMessage('')
    const person = waitlist.find(w => w.id === id)
    if (!person?.email) {
      setMessage('Error: This person has no email address, so their related records cannot be safely removed.')
      setSaving(false)
      return
    }

    try {
      const result = await callFunction('delete-client-user', { id: person.id, email: person.email })
      if (!result?.waitlist_entries_deleted) {
        throw new Error('The waitlist entry was not found. Refresh the page and try again.')
      }
      setMessage(`${person.name}'s account and related records have been deleted.`)
    } catch (err) {
      console.error('Failed to delete client records:', err)
      setMessage(`Error: ${err.message || 'Unable to delete this person.'}`)
      setSaving(false)
      return
    }

    fetchAll()
    setSaving(false)
  }

  if (loading) return <p style={{ color: '#888' }}>Loading...</p>

  return (
    <div>
      {showMoveNext && (
        <div style={{ background: '#f0faf2', border: '1px solid #b2dfb8', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Ready to move to the next person</p>
          <p style={{ color: '#555', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{nextInLine.name} is next (position #{nextInLine.position})</p>
          <button onClick={handleMoveToNext} disabled={saving} style={{ ...btnStyle, background: '#2d7a3a', color: '#fff', width: '100%', padding: '0.75rem' }}>Let {nextInLine.name} Pick</button>
        </div>
      )}
      {pendingPerson && (
        <div style={{ background: '#fff8e5', border: '1px solid #ffe08a', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>⏳ Approval needed</p>
          <p style={{ color: '#555', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{pendingPerson.name} has selected {pendingPerson.puppies?.name}</p>
          <button onClick={() => handleApprove(pendingPerson)} disabled={saving} style={{ ...btnStyle, background: '#b36200', color: '#fff', width: '100%', padding: '0.75rem' }}>Approve Selection</button>
        </div>
      )}
      {activePerson && (
        <div style={{ background: '#f5f5ff', border: '1px solid #c5c5f0', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.15rem' }}>🐾 {activePerson.name} is currently choosing</p>
          <p style={{ color: '#555', fontSize: '0.85rem' }}>Waiting for them to make a selection...</p>
        </div>
      )}

      {message && <p style={{ color: message.startsWith('Error') ? 'red' : 'green', marginBottom: '1rem' }}>{message}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 600 }}>Waitlist</h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select style={{ ...inputStyle, minWidth: '200px' }} value={selectedLitterId} onChange={e => setSelectedLitterId(e.target.value)}>
            <option value="">Select litter</option>
            {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button onClick={startNew} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>+ Add Person</button>
        </div>
      </div>

      {!selectedLitterId && <p style={{ color: '#888', marginBottom: '1rem' }}>Select a litter to view and manage its waitlist.</p>}

      {editing && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>{editing === 'new' ? 'Add to Waitlist' : 'Edit Entry'}</h4>
          <FormGrid>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#666' }}>Litter</label>
              <select style={inputStyle} value={form.litter_id} onChange={e => setForm({ ...form, litter_id: e.target.value })}>
                <option value="">Select litter</option>
                {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Email</label><input type="email" style={inputStyle} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Phone</label><input style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Position #</label><input type="number" style={inputStyle} value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></div>
            {editing === 'new' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.8rem', color: '#666' }}>Password (required)</label>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, password: generateTemporaryPassword() }))}
                    style={{ background: 'none', border: 'none', color: '#084298', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                  >
                    Generate
                  </button>
                </div>
                <input style={inputStyle} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Set their portal password" />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '0.8rem', color: '#666' }}>Notes</label><textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </FormGrid>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
          </div>
        </div>
      )}

      {waitlist.length === 0 && !editing && <p style={{ color: '#888' }}>No one on the waitlist yet.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {waitlist.map(w => (
          <div key={w.id} style={{ background: w.pending_approval ? '#fff8e5' : w.is_active ? '#f5f5ff' : '#fff', border: `1px solid ${w.pending_approval ? '#ffe08a' : w.is_active ? '#c5c5f0' : '#e0e0e0'}`, borderRadius: '10px', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ fontWeight: 700, color: '#aaa', fontSize: '0.85rem' }}>#{w.position}</span>
                <span style={{ fontWeight: w.is_active || w.pending_approval ? 600 : 400 }}>{w.name}</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#666' }}>{w.email}</p>
              {w.phone && <p style={{ fontSize: '0.8rem', color: '#888' }}>{w.phone}</p>}
              <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {w.pending_approval ? <span style={{ color: '#b36200', fontWeight: 600 }}>⏳ Pending approval</span>
                  : w.is_active ? <span style={{ color: '#5555cc', fontWeight: 600 }}>🐾 Choosing now</span>
                  : w.selected_puppy_id ? <span style={{ color: '#2d7a3a' }}>✓ Reserved: {w.puppies?.name}</span>
                  : <span style={{ color: '#aaa' }}>Waiting</span>}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
              {(w.selected_puppy_id || w.pending_approval) && (
                <button onClick={() => handleUnselect(w)} style={{ ...btnStyle, background: '#fff4e5', color: '#b36200', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Unselect</button>
              )}
              <button
                onClick={() => handleResetPasswordForWaitlist(w)}
                disabled={resettingWaitlistId === w.id}
                style={{ ...btnStyle, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                title="Reset password and email new credentials"
              >
                {resettingWaitlistId === w.id ? 'Resetting...' : 'Reset Password'}
              </button>
              <button onClick={() => startEdit(w)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
              <button onClick={() => handleDelete(w.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ApplicationsTab() {
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [statusSavingId, setStatusSavingId] = useState(null)
  const [editingAppId, setEditingAppId] = useState(null)
  const [editAppForm, setEditAppForm] = useState({})
  const [appSaving, setAppSaving] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [density, setDensity] = useState('comfortable')
  const [showAddress, setShowAddress] = useState(true)
  const [showPreferences, setShowPreferences] = useState(true)
  const [showHomeLifestyle, setShowHomeLifestyle] = useState(true)
  const [showQuestions, setShowQuestions] = useState(true)

  useEffect(() => {
    fetchApplications()
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  async function fetchApplications() {
    setLoading(true)
    setError('')
    setSuccess('')
    const { data, error: fetchError } = await supabase
      .from('applications')
      .select('*')
      .or('status.is.null,status.neq.archived')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message || 'Unable to load applications')
      setApplications([])
      setLoading(false)
      return
    }

    setApplications(data || [])
    setLoading(false)
  }

  function startEditApp(app) {
    setEditingAppId(app.id)
    setEditAppForm({
      first_name: app.first_name || '',
      last_name: app.last_name || '',
      email: app.email || '',
      phone: app.phone || '',
      address_line1: app.address_line1 || '',
      address_line2: app.address_line2 || '',
      city: app.city || '',
      state: app.state || '',
      zip: app.zip || '',
      country: app.country || '',
      gender_preference: app.gender_preference || '',
      color_preference: app.color_preference || '',
      registration_type: app.registration_type || '',
      home_situation: app.home_situation || '',
      has_fence: app.has_fence || '',
      indoor_outdoor: app.indoor_outdoor || '',
      vet_info: app.vet_info || '',
      training_goals: app.training_goals || '',
      how_found: app.how_found || '',
      purchase_agreement_questions: app.purchase_agreement_questions || '',
      other_questions: app.other_questions || '',
      status: app.status || 'new'
    })
  }

  async function handleSaveAppEdit(appId) {
    setAppSaving(true)
    setError('')
    setSuccess('')
    const { error: updateError } = await supabase
      .from('applications')
      .update(editAppForm)
      .eq('id', appId)

    if (updateError) {
      setError(updateError.message || 'Unable to update application')
    } else {
      setApplications(prev => prev.map(a => a.id === appId ? { ...a, ...editAppForm } : a))
      setSuccess('Application updated successfully!')
      setEditingAppId(null)
    }
    setAppSaving(false)
  }

  async function handleDeleteApplicationOnly(app) {
    const applicantName = [app.first_name, app.last_name].filter(Boolean).join(' ') || 'this application'
    if (!confirm(`Delete application for ${applicantName}? This will ONLY delete this application entry.`)) return

    setDeletingId(app.id)
    setError('')
    setSuccess('')
    const { error: deleteError } = await supabase
      .from('applications')
      .delete()
      .eq('id', app.id)

    if (deleteError) {
      setError(deleteError.message || 'Unable to delete application')
      setDeletingId(null)
      return
    }

    setApplications(prev => prev.filter(item => item.id !== app.id))
    setSuccess(`Deleted application for ${applicantName}.`)
    setDeletingId(null)
  }

  async function handleSetApplicationStatus(app, nextStatus) {
    setStatusSavingId(app.id)
    const { error: updateError } = await supabase
      .from('applications')
      .update({ status: nextStatus })
      .eq('id', app.id)

    if (updateError) {
      setError(updateError.message || 'Unable to update application status')
      setStatusSavingId(null)
      return
    }

    setApplications(prev => prev.map(item => (
      item.id === app.id ? { ...item, status: nextStatus } : item
    )))
    setStatusSavingId(null)
  }

  function formatDate(value) {
    if (!value) return 'Unknown date'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown date'
    return date.toLocaleString()
  }

  const statusCounts = useMemo(() => {
    const counts = { total: applications.length, new: 0, reviewed: 0, archived: 0, other: 0 }
    for (const app of applications) {
      const status = (app.status || '').toLowerCase()
      if (status === 'new') counts.new += 1
      else if (status === 'reviewed') counts.reviewed += 1
      else if (status === 'archived') counts.archived += 1
      else counts.other += 1
    }
    return counts
  }, [applications])

  const filteredApplications = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...applications]

    if (statusFilter !== 'all') {
      list = list.filter(app => (app.status || 'unknown').toLowerCase() === statusFilter)
    }

    if (q) {
      list = list.filter(app => {
        const haystack = [
          app.first_name,
          app.last_name,
          app.email,
          app.phone,
          app.city,
          app.state,
          app.color_preference,
          app.gender_preference,
          app.registration_type,
          app.how_found,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return haystack.includes(q)
      })
    }

    if (sortBy === 'oldest') {
      list.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    } else if (sortBy === 'name') {
      list.sort((a, b) => {
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase()
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase()
        return nameA.localeCompare(nameB)
      })
    } else {
      list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    }

    return list
  }, [applications, query, statusFilter, sortBy])

  if (loading) return <p style={{ color: '#888' }}>Loading applications...</p>

  const cardPadding = density === 'compact' ? '0.6rem 0.7rem' : '0.9rem 1rem'
  const sectionGap = density === 'compact' ? '0.45rem' : '0.75rem'
  const bodyColumns = isMobile ? '1fr' : 'minmax(0, 1.15fr) minmax(260px, 0.85fr)'
  const controlPanel = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
          <p style={{ fontSize: '0.72rem', color: '#777' }}>Total</p>
          <p style={{ fontSize: '1rem', fontWeight: 700 }}>{statusCounts.total}</p>
        </div>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
          <p style={{ fontSize: '0.72rem', color: '#777' }}>New</p>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#2d7a3a' }}>{statusCounts.new}</p>
        </div>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
          <p style={{ fontSize: '0.72rem', color: '#777' }}>Reviewed</p>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#5555cc' }}>{statusCounts.reviewed}</p>
        </div>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
          <p style={{ fontSize: '0.72rem', color: '#777' }}>Archived/Other</p>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#666' }}>{statusCounts.archived + statusCounts.other}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.65rem' }}>
        <div>
          <label style={{ fontSize: '0.78rem', color: '#666', display: 'block', marginBottom: '0.2rem' }}>Search</label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ ...inputStyle, fontSize: '0.88rem' }}
            placeholder="Name, email, phone, city..."
          />
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', color: '#666', display: 'block', marginBottom: '0.2rem' }}>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, fontSize: '0.88rem' }}>
            <option value="all">All</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', color: '#666', display: 'block', marginBottom: '0.2rem' }}>Sort</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...inputStyle, fontSize: '0.88rem' }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A-Z</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', color: '#666', display: 'block', marginBottom: '0.2rem' }}>Density</label>
          <select value={density} onChange={e => setDensity(e.target.value)} style={{ ...inputStyle, fontSize: '0.88rem' }}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: isMobile ? '0.55rem' : '0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.78rem', color: '#666', width: isMobile ? '100%' : 'auto' }}>Visible sections:</span>
        <label style={{ fontSize: '0.82rem', color: '#444', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={showAddress} onChange={e => setShowAddress(e.target.checked)} /> Address
        </label>
        <label style={{ fontSize: '0.82rem', color: '#444', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={showPreferences} onChange={e => setShowPreferences(e.target.checked)} /> Preferences
        </label>
        <label style={{ fontSize: '0.82rem', color: '#444', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={showHomeLifestyle} onChange={e => setShowHomeLifestyle(e.target.checked)} /> Home & lifestyle
        </label>
        <label style={{ fontSize: '0.82rem', color: '#444', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={showQuestions} onChange={e => setShowQuestions(e.target.checked)} /> Questions
        </label>
      </div>
    </>
  )

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f7f1 100%)',
        border: '1px solid #e9e2c7',
        borderRadius: '18px',
        padding: isMobile ? '1rem' : '1.15rem 1.2rem',
        marginBottom: '1rem',
        boxShadow: '0 10px 28px rgba(17, 24, 39, 0.06)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a6d1f', marginBottom: '0.35rem' }}>
              Application inbox
            </p>
            <h3 style={{ fontWeight: 800, fontSize: isMobile ? '1.2rem' : '1.45rem', marginBottom: '0.25rem' }}>Applications</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: 1.55 }}>
              Review every submission in one place, edit application details, and archive or remove applications.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
            <button onClick={fetchApplications} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', minHeight: '42px', flex: isMobile ? 1 : 'none', padding: '0.65rem 1rem' }}>
              Refresh
            </button>
            <button
              onClick={() => {
                setQuery('')
                setStatusFilter('all')
                setSortBy('newest')
                setDensity('comfortable')
                setShowAddress(true)
                setShowPreferences(true)
                setShowHomeLifestyle(true)
                setShowQuestions(true)
              }}
              style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', minHeight: '42px', flex: isMobile ? 1 : 'none', padding: '0.65rem 1rem' }}
            >
              Reset
            </button>
          </div>
        </div>

      </div>

      <div style={{ background: 'linear-gradient(180deg, #fafafa 0%, #f6f6f6 100%)', border: '1px solid #e8e8e8', borderRadius: '12px', padding: isMobile ? '0.7rem' : '0.9rem', marginBottom: '1rem', display: 'grid', gap: '0.75rem' }}>
        {isMobile ? (
          <details open={controlsOpen} onToggle={(e) => setControlsOpen(e.currentTarget.open)}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#333', marginBottom: '0.65rem' }}>Filters & View Options</summary>
            <div style={{ display: 'grid', gap: '0.75rem' }}>{controlPanel}</div>
          </details>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>{controlPanel}</div>
        )}
      </div>

      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</p>}
      {success && <p style={{ color: '#1f7a35', marginBottom: '1rem' }}>{success}</p>}

      {!error && filteredApplications.length === 0 && (
        <p style={{ color: '#888' }}>No applications found yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: density === 'compact' ? '0.55rem' : '0.8rem' }}>
        {filteredApplications.map((app) => (
          <details
            key={app.id}
            open={editingAppId === app.id ? true : undefined}
            style={{
              background: '#fff',
              border: '1px solid #e8e8e8',
              borderRadius: '16px',
              padding: cardPadding,
              boxShadow: '0 10px 24px rgba(17, 24, 39, 0.05)',
              borderLeft: app.status === 'new' ? '5px solid #2d7a3a' : app.status === 'reviewed' ? '5px solid #5555cc' : '5px solid #d4d4d4',
              overflow: 'hidden'
            }}
          >
            <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: isMobile ? 'flex-start' : 'center', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 800, fontSize: isMobile ? '1rem' : '1.05rem', lineHeight: 1.3 }}>
                    {[app.first_name, app.last_name].filter(Boolean).join(' ') || 'Unnamed Applicant'}
                  </p>
                  <p style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.2rem', lineHeight: 1.45 }}>
                    {app.email || 'No email'}{app.phone ? ` • ${app.phone}` : ''}
                  </p>
                </div>
                <div style={{ textAlign: isMobile ? 'left' : 'right', width: isMobile ? '100%' : 'auto' }}>
                  <p style={{ fontSize: '0.75rem', color: '#666' }}>{formatDate(app.created_at)}</p>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      textTransform: 'capitalize',
                      padding: '0.22rem 0.58rem',
                      borderRadius: '999px',
                      background: app.status === 'new' ? '#e6f4ea' : '#f0f0f0',
                      color: app.status === 'new' ? '#2d7a3a' : '#555'
                    }}
                  >
                    {app.status || 'unknown'}
                  </span>
                </div>
              </div>
            </summary>

            <div style={{ marginTop: density === 'compact' ? '0.65rem' : '0.85rem', borderTop: '1px solid #f0f0f0', paddingTop: density === 'compact' ? '0.75rem' : '0.95rem', display: 'grid', gap: sectionGap }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={() => editingAppId === app.id ? setEditingAppId(null) : startEditApp(app)}
                  style={{
                    ...btnStyle,
                    fontSize: '0.8rem',
                    color: '#1a1a1a',
                    background: '#f0f0f0',
                    border: '1px solid #ddd',
                    borderRadius: '999px',
                    padding: isMobile ? '0.42rem 0.82rem' : '0.24rem 0.6rem',
                    minHeight: '36px'
                  }}
                >
                  {editingAppId === app.id ? 'Cancel Edit' : 'Edit Application'}
                </button>

                {(app.status || '').toLowerCase() === 'archived' ? (
                  <button
                    onClick={() => handleSetApplicationStatus(app, 'new')}
                    disabled={statusSavingId === app.id}
                    style={{
                      ...btnStyle,
                      fontSize: '0.8rem',
                      color: '#1f4f9b',
                      background: '#eef4ff',
                      border: '1px solid #c9dcff',
                      borderRadius: '999px',
                      padding: isMobile ? '0.42rem 0.82rem' : '0.24rem 0.6rem',
                      minHeight: '36px'
                    }}
                  >
                    {statusSavingId === app.id ? 'Saving...' : 'Mark New'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSetApplicationStatus(app, 'archived')}
                    disabled={statusSavingId === app.id}
                    style={{
                      ...btnStyle,
                      fontSize: '0.8rem',
                      color: '#6b5a19',
                      background: '#fff8e6',
                      border: '1px solid #f0dd9c',
                      borderRadius: '999px',
                      padding: isMobile ? '0.42rem 0.82rem' : '0.24rem 0.6rem',
                      minHeight: '36px'
                    }}
                  >
                    {statusSavingId === app.id ? 'Saving...' : 'Archive'}
                  </button>
                )}

                <button
                  onClick={() => handleDeleteApplicationOnly(app)}
                  disabled={deletingId === app.id}
                  style={{
                    ...btnStyle,
                    fontSize: '0.8rem',
                    color: '#b42318',
                    background: '#fff1f1',
                    border: '1px solid #f3c7c7',
                    borderRadius: '999px',
                    padding: isMobile ? '0.42rem 0.82rem' : '0.24rem 0.6rem',
                    minHeight: '36px'
                  }}
                >
                  {deletingId === app.id ? 'Deleting...' : 'Delete Application'}
                </button>
              </div>

              {editingAppId === app.id ? (
                <div style={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: '12px', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
                  <h4 style={{ fontWeight: 600, fontSize: '0.95rem' }}>Edit Application Details</h4>
                  <FormGrid>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>First Name</label><input style={inputStyle} value={editAppForm.first_name} onChange={e => setEditAppForm({ ...editAppForm, first_name: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Last Name</label><input style={inputStyle} value={editAppForm.last_name} onChange={e => setEditAppForm({ ...editAppForm, last_name: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Email</label><input style={inputStyle} value={editAppForm.email} onChange={e => setEditAppForm({ ...editAppForm, email: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Phone</label><input style={inputStyle} value={editAppForm.phone} onChange={e => setEditAppForm({ ...editAppForm, phone: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Address Line 1</label><input style={inputStyle} value={editAppForm.address_line1} onChange={e => setEditAppForm({ ...editAppForm, address_line1: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Address Line 2</label><input style={inputStyle} value={editAppForm.address_line2} onChange={e => setEditAppForm({ ...editAppForm, address_line2: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>City</label><input style={inputStyle} value={editAppForm.city} onChange={e => setEditAppForm({ ...editAppForm, city: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>State</label><input style={inputStyle} value={editAppForm.state} onChange={e => setEditAppForm({ ...editAppForm, state: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Zip</label><input style={inputStyle} value={editAppForm.zip} onChange={e => setEditAppForm({ ...editAppForm, zip: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Gender Preference</label><input style={inputStyle} value={editAppForm.gender_preference} onChange={e => setEditAppForm({ ...editAppForm, gender_preference: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Color Preference</label><input style={inputStyle} value={editAppForm.color_preference} onChange={e => setEditAppForm({ ...editAppForm, color_preference: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Registration Type</label><input style={inputStyle} value={editAppForm.registration_type} onChange={e => setEditAppForm({ ...editAppForm, registration_type: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Home Situation</label><input style={inputStyle} value={editAppForm.home_situation} onChange={e => setEditAppForm({ ...editAppForm, home_situation: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Fence / Containment</label><input style={inputStyle} value={editAppForm.has_fence} onChange={e => setEditAppForm({ ...editAppForm, has_fence: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Indoor / Outdoor</label><input style={inputStyle} value={editAppForm.indoor_outdoor} onChange={e => setEditAppForm({ ...editAppForm, indoor_outdoor: e.target.value })} /></div>
                    <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Status</label>
                      <select style={inputStyle} value={editAppForm.status} onChange={e => setEditAppForm({ ...editAppForm, status: e.target.value })}>
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </FormGrid>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button onClick={() => handleSaveAppEdit(app.id)} disabled={appSaving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', padding: '0.6rem 1.2rem' }}>
                      {appSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button onClick={() => setEditingAppId(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', padding: '0.6rem 1rem' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: bodyColumns, gap: density === 'compact' ? '0.7rem' : '0.9rem', alignItems: 'start' }}>
                  <div style={{ display: 'grid', gap: density === 'compact' ? '0.45rem' : '0.65rem' }}>
                    {showAddress && (
                      <section style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: '12px', padding: density === 'compact' ? '0.65rem' : '0.8rem' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8a6d1f', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Address</p>
                        <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.5 }}>
                          {[app.address_line1, app.address_line2, app.city, app.state, app.zip, app.country].filter(Boolean).join(', ') || 'Not provided'}
                        </p>
                      </section>
                    )}

                    {showPreferences && (
                      <section style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: '12px', padding: density === 'compact' ? '0.65rem' : '0.8rem' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8a6d1f', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.55rem' }}>Preferences</p>
                        <div style={{ display: 'grid', gap: density === 'compact' ? '0.35rem' : '0.5rem' }}>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Gender</p>
                            <p style={{ fontSize: '0.9rem', color: '#333' }}>{app.gender_preference || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Color</p>
                            <p style={{ fontSize: '0.9rem', color: '#333' }}>{app.color_preference || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Registration</p>
                            <p style={{ fontSize: '0.9rem', color: '#333' }}>{app.registration_type || 'Not provided'}</p>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: density === 'compact' ? '0.45rem' : '0.65rem' }}>
                    {showHomeLifestyle && (
                      <section style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: '12px', padding: density === 'compact' ? '0.65rem' : '0.8rem' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8a6d1f', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.55rem' }}>Home & lifestyle</p>
                        <div style={{ display: 'grid', gap: density === 'compact' ? '0.35rem' : '0.5rem' }}>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Home situation</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.home_situation || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Fence / containment</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.has_fence || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Indoor / outdoor</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.indoor_outdoor || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Vet info</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.vet_info || 'Not provided'}</p>
                          </div>
                        </div>
                      </section>
                    )}

                    {showQuestions && (
                      <section style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: '12px', padding: density === 'compact' ? '0.65rem' : '0.8rem' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8a6d1f', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.55rem' }}>Questions</p>
                        <div style={{ display: 'grid', gap: density === 'compact' ? '0.35rem' : '0.5rem' }}>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Training goals</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.training_goals || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>How they found us</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.how_found || 'Not provided'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Purchase agreement</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.purchase_agreement_questions || 'None'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.76rem', color: '#888', marginBottom: '0.12rem' }}>Other questions</p>
                            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.45 }}>{app.other_questions || 'None'}</p>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function UsersTab() {
  const [users, setUsers] = useState([])
  const [litters, setLitters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const [editingUserEmail, setEditingUserEmail] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', role: 'client' })
  const [savingUser, setSavingUser] = useState(false)

  const [passwordUserEmail, setPasswordUserEmail] = useState(null)
  const [passwordForm, setPasswordForm] = useState({ password: '', mustChangePassword: true, sendEmail: true })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [resettingEmail, setResettingEmail] = useState(null)

  const [addingUser, setAddingUser] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', role: 'client', password: '', litter_id: '' })
  const [addingSaving, setAddingSaving] = useState(false)

  const [selectedLitterByUser, setSelectedLitterByUser] = useState({})
  const [addingWaitlistEmail, setAddingWaitlistEmail] = useState(null)

  useEffect(() => {
    fetchUsersAndLitters()
  }, [])

  async function fetchUsersAndLitters() {
    setLoading(true)
    setError('')
    const [{ data: waitlistData }, { data: appsData }, { data: profilesData }, { data: littersData }] = await Promise.all([
      supabase.from('waitlist').select('*, puppies(name)').order('position'),
      supabase.from('applications').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*'),
      supabase.from('litters').select('id, name').order('created_at', { ascending: false })
    ])

    setLitters(littersData || [])

    const { data: sessionData } = await supabase.auth.getSession()
    const currentUser = sessionData?.session?.user

    const userMap = new Map()

    // 1. Current logged-in user
    if (currentUser?.email) {
      const email = currentUser.email.toLowerCase()
      userMap.set(email, {
        email,
        name: currentUser.user_metadata?.name || 'Admin',
        phone: '',
        role: 'admin',
        profile_id: currentUser.id,
        waitlist_entries: [],
        applications: []
      })
    }

    // 2. Applications
    for (const app of appsData || []) {
      const email = (app.email || '').trim().toLowerCase()
      if (!email) continue
      const fullName = [app.first_name, app.last_name].filter(Boolean).join(' ').trim() || 'Applicant'
      let u = userMap.get(email)
      if (!u) {
        u = {
          email,
          name: fullName,
          phone: app.phone || '',
          role: 'client',
          profile_id: null,
          waitlist_entries: [],
          applications: []
        }
        userMap.set(email, u)
      }
      if (!u.name || u.name === 'Admin' || u.name === 'Applicant') u.name = fullName
      if (!u.phone && app.phone) u.phone = app.phone
      u.applications.push(app)
    }

    // 3. Waitlist
    for (const w of waitlistData || []) {
      const email = (w.email || '').trim().toLowerCase()
      if (!email) continue
      let u = userMap.get(email)
      if (!u) {
        u = {
          email,
          name: w.name || 'Waitlist Client',
          phone: w.phone || '',
          role: 'client',
          profile_id: null,
          waitlist_entries: [],
          applications: []
        }
        userMap.set(email, u)
      }
      if (!u.name || u.name === 'Waitlist Client') u.name = w.name
      if (!u.phone && w.phone) u.phone = w.phone
      u.waitlist_entries.push(w)
    }

    // 4. Profiles
    if (profilesData && profilesData.length > 0) {
      const profileRoleMap = new Map(profilesData.map(p => [p.id, p.role]))
      if (currentUser?.id && profileRoleMap.has(currentUser.id)) {
        const u = userMap.get(currentUser.email.toLowerCase())
        if (u) u.role = profileRoleMap.get(currentUser.id) || 'admin'
      }
    }

    setUsers(Array.from(userMap.values()))
    setLoading(false)
  }

  async function handleAddToWaitlist(user, litterId) {
    if (!litterId) {
      setError('Select a litter before adding this user to the waitlist.')
      return
    }
    setError('')
    setSuccess('')
    setAddingWaitlistEmail(user.email)

    try {
      const email = user.email.toLowerCase()
      const fullName = user.name || 'New Client'
      const phone = user.phone || ''

      const byLitter = await supabase
        .from('waitlist')
        .select('position')
        .eq('litter_id', litterId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()

      const nextPosition = Number(byLitter.data?.position || 0) + 1

      const { error: insertError } = await supabase.from('waitlist').insert({
        name: fullName,
        email,
        phone,
        position: nextPosition,
        litter_id: litterId,
        notes: 'Added from Users tab'
      })

      if (insertError) throw new Error(insertError.message)

      await supabase
        .from('applications')
        .update({ status: 'reviewed' })
        .eq('email', email)
        .or('status.is.null,status.eq.new')

      const tempPassword = generateTemporaryPassword()
      await callFunction('create-client-user', { email, password: tempPassword, name: fullName, phone, role: user.role || 'client', must_change_password: true })
      await callFunction('send-client-portal-credentials', { clientName: fullName, clientEmail: email, password: tempPassword, portalUrl: PORTAL_URL, mustChangePassword: true })

      setSuccess(`Added ${fullName} to waitlist and sent portal credentials!`)
      fetchUsersAndLitters()
    } catch (err) {
      setError(err.message || 'Failed to add user to waitlist')
    }
    setAddingWaitlistEmail(null)
  }

  function startEditUser(u) {
    setPasswordUserEmail(null)
    setEditingUserEmail(u.email)
    setEditForm({
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      role: u.role || 'client'
    })
  }

  async function handleSaveUserEdit(oldEmail) {
    setSavingUser(true)
    setError('')
    setSuccess('')

    try {
      const newEmail = editForm.email.trim().toLowerCase()
      const newPhone = editForm.phone.trim()
      const newName = editForm.name.trim()
      const newRole = editForm.role

      await supabase
        .from('waitlist')
        .update({ name: newName, email: newEmail, phone: newPhone })
        .ilike('email', oldEmail)

      const nameParts = newName.split(' ')
      const firstName = nameParts[0] || newName
      const lastName = nameParts.slice(1).join(' ') || ''
      await supabase
        .from('applications')
        .update({ first_name: firstName, last_name: lastName, email: newEmail, phone: newPhone })
        .ilike('email', oldEmail)

      await callFunction('create-client-user', { email: newEmail, name: newName, phone: newPhone, role: newRole })

      setSuccess(`Updated user ${newName}.`)
      setEditingUserEmail(null)
      fetchUsersAndLitters()
    } catch (err) {
      setError(err.message || 'Failed to update user')
    }
    setSavingUser(false)
  }

  function startChangePassword(u) {
    setEditingUserEmail(null)
    setPasswordUserEmail(u.email)
    setPasswordForm({
      password: '',
      mustChangePassword: true,
      sendEmail: true
    })
  }

  async function handleSaveCustomPassword(u) {
    if (!passwordForm.password || passwordForm.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    setPasswordSaving(true)
    setError('')
    setSuccess('')

    try {
      await callFunction('create-client-user', {
        email: u.email,
        password: passwordForm.password,
        name: u.name,
        phone: u.phone,
        role: u.role,
        must_change_password: passwordForm.mustChangePassword
      })

      if (passwordForm.sendEmail) {
        await callFunction('send-client-portal-credentials', {
          clientName: u.name,
          clientEmail: u.email,
          password: passwordForm.password,
          portalUrl: PORTAL_URL,
          isReset: true,
          mustChangePassword: passwordForm.mustChangePassword
        })
      }

      setSuccess(`Updated password for ${u.name}!${passwordForm.sendEmail ? ` Credentials emailed to ${u.email}.` : ''}`)
      setPasswordUserEmail(null)
      fetchUsersAndLitters()
    } catch (err) {
      setError(err.message || 'Failed to update password')
    }
    setPasswordSaving(false)
  }

  async function handleResetAndEmailPassword(u) {
    if (!confirm(`Reset password for ${u.name} (${u.email}) and email them a new temporary password?`)) return

    setResettingEmail(u.email)
    setError('')
    setSuccess('')

    try {
      const tempPassword = generateTemporaryPassword()
      await callFunction('create-client-user', {
        email: u.email,
        password: tempPassword,
        name: u.name,
        phone: u.phone,
        role: u.role,
        must_change_password: true
      })

      await callFunction('send-client-portal-credentials', {
        clientName: u.name,
        clientEmail: u.email,
        password: tempPassword,
        portalUrl: PORTAL_URL,
        isReset: true,
        mustChangePassword: true
      })

      setSuccess(`Password for ${u.name} reset to "${tempPassword}" and emailed to ${u.email}!`)
      fetchUsersAndLitters()
    } catch (err) {
      setError(err.message || 'Failed to reset password')
    }
    setResettingEmail(null)
  }

  async function handleDeleteUser(u) {
    if (!confirm(`Delete user ${u.name} (${u.email}) and all associated waitlist entries, applications, and portal credentials? This cannot be undone.`)) return

    setError('')
    setSuccess('')
    try {
      await callFunction('delete-client-user', { email: u.email })
      setSuccess(`Deleted user ${u.name}.`)
      fetchUsersAndLitters()
    } catch (err) {
      setError(err.message || 'Unable to delete user')
    }
  }

  async function handleCreateNewUser() {
    if (!addForm.email || !addForm.password) {
      setError('Email and password are required.')
      return
    }
    setAddingSaving(true)
    setError('')
    setSuccess('')

    try {
      const email = addForm.email.trim().toLowerCase()
      const name = addForm.name.trim() || 'New User'
      const phone = addForm.phone.trim()
      const role = addForm.role || 'client'

      await callFunction('create-client-user', {
        email,
        password: addForm.password,
        name,
        phone,
        role,
        must_change_password: true
      })

      if (addForm.litter_id) {
        const byLitter = await supabase
          .from('waitlist')
          .select('position')
          .eq('litter_id', addForm.litter_id)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()
        const nextPos = Number(byLitter.data?.position || 0) + 1

        await supabase.from('waitlist').insert({
          name,
          email,
          phone,
          position: nextPos,
          litter_id: addForm.litter_id,
          notes: 'Added upon user creation'
        })
      }

      await callFunction('send-client-portal-credentials', {
        clientName: name,
        clientEmail: email,
        password: addForm.password,
        portalUrl: PORTAL_URL,
        mustChangePassword: true
      })

      setSuccess(`User ${name} created and credentials emailed!`)
      setAddingUser(false)
      setAddForm({ name: '', email: '', phone: '', role: 'client', password: '', litter_id: '' })
      fetchUsersAndLitters()
    } catch (err) {
      setError(err.message || 'Failed to create user')
    }
    setAddingSaving(false)
  }

  const filteredUsers = useMemo(() => {
    let list = [...users]
    const q = query.trim().toLowerCase()
    if (roleFilter !== 'all') {
      list = list.filter(u => u.role === roleFilter)
    }
    if (q) {
      list = list.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [users, query, roleFilter])

  if (loading) return <p style={{ color: '#888' }}>Loading users...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h3 style={{ fontWeight: 600, fontSize: '1.2rem' }}>Users</h3>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>Manage user accounts, roles, contact info, waitlist assignments, and passwords.</p>
        </div>
        <button onClick={() => {
          setAddingUser(!addingUser)
          if (!addingUser) setAddForm(prev => ({ ...prev, password: generateTemporaryPassword() }))
        }} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>
          {addingUser ? 'Cancel Add User' : '+ Add User'}
        </button>
      </div>

      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</p>}
      {success && <p style={{ color: '#1f7a35', marginBottom: '1rem', background: '#f0fbf2', border: '1px solid #b7ebc2', padding: '0.75rem', borderRadius: '8px' }}>{success}</p>}

      {addingUser && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ fontWeight: 600, marginBottom: '1rem' }}>Add New User</h4>
          <FormGrid>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label><input style={inputStyle} value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Full name" /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Email (required)</label><input type="email" style={inputStyle} value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="user@example.com" /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Phone</label><input style={inputStyle} value={addForm.phone} onChange={e => setAddForm({ ...addForm, phone: e.target.value })} placeholder="555-123-4567" /></div>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#666' }}>Role</label>
              <select style={inputStyle} value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })}>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.8rem', color: '#666' }}>Password (required)</label>
                <button
                  type="button"
                  onClick={() => setAddForm(prev => ({ ...prev, password: generateTemporaryPassword() }))}
                  style={{ background: 'none', border: 'none', color: '#084298', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  Generate Random
                </button>
              </div>
              <input style={inputStyle} value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} placeholder="Set portal password" />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#666' }}>Add to Waitlist Litter (optional)</label>
              <select style={inputStyle} value={addForm.litter_id} onChange={e => setAddForm({ ...addForm, litter_id: e.target.value })}>
                <option value="">Do not add to waitlist</option>
                {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </FormGrid>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleCreateNewUser} disabled={addingSaving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>
              {addingSaving ? 'Creating...' : 'Create User & Send Credentials'}
            </button>
            <button onClick={() => setAddingUser(false)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, email, phone..."
          style={{ ...inputStyle, maxWidth: '300px' }}
        />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ ...inputStyle, maxWidth: '160px' }}>
          <option value="all">All Roles</option>
          <option value="client">Client</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {filteredUsers.length === 0 && <p style={{ color: '#888' }}>No users found.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredUsers.map(u => (
          <div key={u.email} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <p style={{ fontWeight: 700, fontSize: '1.05rem' }}>{u.name}</p>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '20px', background: u.role === 'admin' ? '#1a1a1a' : '#f0f0f0', color: u.role === 'admin' ? '#fff' : '#555', textTransform: 'capitalize' }}>
                    {u.role}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.15rem' }}>{u.email}{u.phone ? ` • ${u.phone}` : ''}</p>
                {u.waitlist_entries.length > 0 && (
                  <p style={{ fontSize: '0.8rem', color: '#2d7a3a', marginTop: '0.25rem' }}>
                    Waitlist: {u.waitlist_entries.map(w => `#${w.position}`).join(', ')}
                  </p>
                )}
                {u.applications.length > 0 && (
                  <p style={{ fontSize: '0.8rem', color: '#5555cc', marginTop: '0.15rem' }}>
                    {u.applications.length} Application(s) submitted
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {u.phone && (
                  <a href={`tel:${u.phone}`} style={{ ...btnStyle, background: '#f8f8f8', border: '1px solid #ddd', color: '#333', fontSize: '0.8rem', textDecoration: 'none', padding: '0.35rem 0.7rem' }}>
                    Call
                  </a>
                )}
                {u.email && (
                  <a href={`mailto:${u.email}`} style={{ ...btnStyle, background: '#f8f8f8', border: '1px solid #ddd', color: '#333', fontSize: '0.8rem', textDecoration: 'none', padding: '0.35rem 0.7rem' }}>
                    Email
                  </a>
                )}
                <button
                  onClick={() => handleResetAndEmailPassword(u)}
                  disabled={resettingEmail === u.email}
                  style={{ ...btnStyle, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}
                  title="Generate a new temporary password and email credentials"
                >
                  {resettingEmail === u.email ? 'Resetting...' : '🔄 Reset & Email Password'}
                </button>
                <button
                  onClick={() => startChangePassword(u)}
                  style={{ ...btnStyle, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}
                >
                  🔑 Change Password
                </button>
                <button onClick={() => startEditUser(u)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}>
                  Edit Info / Role
                </button>
                <button onClick={() => handleDeleteUser(u)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', border: '1px solid #fcc', padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}>
                  Delete User
                </button>
              </div>
            </div>

            {/* Add to waitlist inline section (only show if not already on any waitlist) */}
            {u.waitlist_entries.length === 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#666' }}>Add to Waitlist:</span>
                <select
                  value={selectedLitterByUser[u.email] || ''}
                  onChange={e => setSelectedLitterByUser({ ...selectedLitterByUser, [u.email]: e.target.value })}
                  style={{ ...inputStyle, fontSize: '0.8rem', maxWidth: '200px', padding: '0.35rem 0.5rem' }}
                >
                  <option value="">Select litter...</option>
                  {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button
                  onClick={() => handleAddToWaitlist(u, selectedLitterByUser[u.email])}
                  disabled={addingWaitlistEmail === u.email || !selectedLitterByUser[u.email]}
                  style={{ ...btnStyle, background: '#e7f1ff', color: '#084298', border: '1px solid #b8d3ff', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                >
                  {addingWaitlistEmail === u.email ? 'Adding...' : 'Add to Waitlist'}
                </button>
              </div>
            )}

            {/* Change Password panel */}
            {passwordUserEmail === u.email && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '0.85rem', display: 'grid', gap: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h5 style={{ fontWeight: 600, fontSize: '0.9rem', color: '#166534', margin: 0 }}>
                    Change Password for {u.name} ({u.email})
                  </h5>
                  <button
                    type="button"
                    onClick={() => setPasswordForm(prev => ({ ...prev, password: generateTemporaryPassword() }))}
                    style={{ ...btnStyle, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                  >
                    ⚡ Generate Random Password
                  </button>
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#555', display: 'block', marginBottom: '0.2rem' }}>New Password (min 8 characters)</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={passwordForm.password}
                    onChange={e => setPasswordForm({ ...passwordForm, password: e.target.value })}
                    placeholder="Enter new password"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.2rem' }}>
                  <label style={{ fontSize: '0.8rem', color: '#444', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={passwordForm.mustChangePassword}
                      onChange={e => setPasswordForm({ ...passwordForm, mustChangePassword: e.target.checked })}
                    />
                    Require user to set a new password on their next sign-in
                  </label>
                  <label style={{ fontSize: '0.8rem', color: '#444', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={passwordForm.sendEmail}
                      onChange={e => setPasswordForm({ ...passwordForm, sendEmail: e.target.checked })}
                    />
                    Send email with new credentials to {u.email}
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                  <button
                    onClick={() => handleSaveCustomPassword(u)}
                    disabled={passwordSaving || !passwordForm.password}
                    style={{ ...btnStyle, background: '#166534', color: '#fff', fontSize: '0.85rem', padding: '0.5rem 1rem', opacity: passwordSaving || !passwordForm.password ? 0.7 : 1 }}
                  >
                    {passwordSaving ? 'Updating Password...' : 'Save Password'}
                  </button>
                  <button
                    onClick={() => setPasswordUserEmail(null)}
                    style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', fontSize: '0.85rem', padding: '0.5rem 0.85rem' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Editing mode for user contact info / role */}
            {editingUserEmail === u.email && (
              <div style={{ background: '#f5f5f3', border: '1px solid #ddd', borderRadius: '8px', padding: '0.85rem', display: 'grid', gap: '0.65rem' }}>
                <h5 style={{ fontWeight: 600, fontSize: '0.9rem' }}>Edit Contact Info & Role</h5>
                <FormGrid>
                  <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Name</label><input style={inputStyle} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></div>
                  <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Email</label><input style={inputStyle} value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></div>
                  <div><label style={{ fontSize: '0.78rem', color: '#666' }}>Phone</label><input style={inputStyle} value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></div>
                  <div>
                    <label style={{ fontSize: '0.78rem', color: '#666' }}>Role</label>
                    <select style={inputStyle} value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
                      <option value="client">Client</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </FormGrid>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                  <button onClick={() => handleSaveUserEdit(u.email)} disabled={savingUser} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                    {savingUser ? 'Saving...' : 'Save User Changes'}
                  </button>
                  <button onClick={() => setEditingUserEmail(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', fontSize: '0.85rem', padding: '0.5rem 0.85rem' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ArchivedApplicationsTab() {
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  async function fetchApplications() {
    setLoading(true)
    setError('')
    const { data, error: fetchError } = await supabase
      .from('applications')
      .select('id, first_name, last_name, email, phone, created_at')
      .eq('status', 'archived')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message || 'Unable to load archived applications')
      setApplications([])
    } else {
      setApplications(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchApplications()
  }, [])

  async function restoreApplication(application) {
    setSavingId(application.id)
    const { error: updateError } = await supabase
      .from('applications')
      .update({ status: 'new' })
      .eq('id', application.id)

    if (updateError) {
      setError(updateError.message || 'Unable to restore application')
    } else {
      setApplications(current => current.filter(item => item.id !== application.id))
    }
    setSavingId(null)
  }

  if (loading) return <p style={{ color: '#888' }}>Loading archived applications...</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h4 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Archived Applications</h4>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>Applications are archived automatically when a client picks a puppy.</p>
        </div>
        <button onClick={fetchApplications} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd' }}>Refresh</button>
      </div>
      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</p>}
      {!error && applications.length === 0 && <p style={{ color: '#888' }}>No archived applications.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {applications.map(application => {
          const fullName = [application.first_name, application.last_name].filter(Boolean).join(' ') || 'Unnamed Applicant'
          const submittedAt = application.created_at ? new Date(application.created_at).toLocaleString() : 'Unknown date'
          return (
            <div key={application.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontWeight: 600 }}>{fullName}</p>
                <p style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.2rem' }}>{application.email || 'No email'}{application.phone ? ` - ${application.phone}` : ''}</p>
                <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.2rem' }}>Submitted {submittedAt}</p>
              </div>
              <button onClick={() => restoreApplication(application)} disabled={savingId === application.id} style={{ ...btnStyle, background: '#eef4ff', border: '1px solid #c9dcff', color: '#1f4f9b' }}>
                {savingId === application.id ? 'Restoring...' : 'Restore to Applications'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmailTab() {
  const [emails, setEmails] = useState([])
  const [contactsMap, setContactsMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [replyMessage, setReplyMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [viewFilter, setViewFilter] = useState('inbox') // 'inbox' or 'archived'

  async function fetchEmails() {
    setLoading(true)
    setError('')
    const [{ data, error: fetchError }, { data: appsData }, { data: waitlistData }] = await Promise.all([
      supabase
        .from('emails')
        .select('*')
        .order('created_at', { ascending: true }),
      supabase.from('applications').select('first_name, last_name, email'),
      supabase.from('waitlist').select('name, email')
    ])

    if (fetchError) {
      setError(fetchError.message || 'Unable to load emails')
      setEmails([])
    } else {
      setEmails(data || [])
    }

    // Build contacts map to match emails with names
    const names = new Map()
    for (const app of appsData || []) {
      const email = (app.email || '').trim().toLowerCase()
      if (!email) continue
      const fullName = [app.first_name, app.last_name].filter(Boolean).join(' ').trim()
      if (fullName && !names.has(email)) names.set(email, fullName)
    }
    for (const w of waitlistData || []) {
      const email = (w.email || '').trim().toLowerCase()
      if (!email) continue
      const name = (w.name || '').trim()
      if (name && !names.has(email)) names.set(email, name)
    }
    setContactsMap(names)
    setLoading(false)
  }

  function getDisplayName(email) {
    if (!email) return ''
    const clean = email.trim().toLowerCase()
    return contactsMap.get(clean) || null
  }

  useEffect(() => {
    fetchEmails()
  }, [])

  const allThreads = useMemo(() => {
    const byThread = new Map()
    for (const email of emails) {
      const list = byThread.get(email.thread_id) || []
      list.push(email)
      byThread.set(email.thread_id, list)
    }
    return Array.from(byThread.entries())
      .map(([threadId, list]) => {
        const isArchived = list.some(m => Boolean(m.is_archived))
        return {
          threadId,
          messages: list,
          latest: list[list.length - 1],
          isArchived,
          unreadCount: list.filter(m => m.direction === 'inbound' && !m.is_read).length,
        }
      })
      .sort((a, b) => new Date(b.latest.created_at) - new Date(a.latest.created_at))
  }, [emails])

  const threads = useMemo(() => {
    if (viewFilter === 'archived') {
      return allThreads.filter(t => t.isArchived)
    }
    return allThreads.filter(t => !t.isArchived)
  }, [allThreads, viewFilter])

  const selectedThread = allThreads.find(t => t.threadId === selectedThreadId) || null

  async function selectThread(thread) {
    setSelectedThreadId(thread.threadId)
    setReplyMessage('')
    setSendError('')
    const unreadIds = thread.messages.filter(m => m.direction === 'inbound' && !m.is_read).map(m => m.id)
    if (unreadIds.length > 0) {
      await supabase.from('emails').update({ is_read: true }).in('id', unreadIds)
      setEmails(current => current.map(e => unreadIds.includes(e.id) ? { ...e, is_read: true } : e))
    }
  }

  async function handleReply() {
    if (!selectedThread || !replyMessage.trim()) return
    const lastInbound = [...selectedThread.messages].reverse().find(m => m.direction === 'inbound')
    const to = lastInbound?.from_email || selectedThread.latest.from_email
    const replyTo = lastInbound?.to_email || ''
    const subject = selectedThread.latest.subject || ''

    setSending(true)
    setSendError('')
    try {
      const result = await callFunction('send-email-reply', {
        thread_id: selectedThread.threadId,
        to,
        reply_to: replyTo,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        message: replyMessage,
      })
      setReplyMessage('')
      if (result.email) {
        setEmails(current => [...current, result.email])
      }
      await fetchEmails()
    } catch (err) {
      setSendError(err.message)
    }
    setSending(false)
  }

  async function handleArchiveThread(threadId, shouldArchive = true) {
    const { error: updateError } = await supabase
      .from('emails')
      .update({ is_archived: shouldArchive })
      .eq('thread_id', threadId)

    if (updateError) {
      setError(updateError.message || 'Unable to update thread')
    } else {
      setEmails(current => current.map(e => e.thread_id === threadId ? { ...e, is_archived: shouldArchive } : e))
      if (shouldArchive && viewFilter === 'inbox') {
        setSelectedThreadId(null)
      }
    }
  }

  if (loading) return <p style={{ color: '#888' }}>Loading email...</p>

  const archivedCount = allThreads.filter(t => t.isArchived).length
  const inboxCount = allThreads.filter(t => !t.isArchived).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h4 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Email</h4>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>Messages received via cloudpeaksilverlabradors.com are also forwarded to cloudpeaksilverlabs@yahoo.com.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid #ddd', borderRadius: '6px', overflow: 'hidden' }}>
            <button
              onClick={() => { setViewFilter('inbox'); setSelectedThreadId(null) }}
              style={{
                padding: '0.35rem 0.75rem',
                border: 'none',
                background: viewFilter === 'inbox' ? '#1a1a1a' : '#fff',
                color: viewFilter === 'inbox' ? '#fff' : '#333',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              Inbox ({inboxCount})
            </button>
            <button
              onClick={() => { setViewFilter('archived'); setSelectedThreadId(null) }}
              style={{
                padding: '0.35rem 0.75rem',
                border: 'none',
                borderLeft: '1px solid #ddd',
                background: viewFilter === 'archived' ? '#1a1a1a' : '#fff',
                color: viewFilter === 'archived' ? '#fff' : '#333',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              Archived ({archivedCount})
            </button>
          </div>
          <button onClick={fetchEmails} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd' }}>Refresh</button>
        </div>
      </div>
      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</p>}
      {!error && threads.length === 0 && <p style={{ color: '#888' }}>{viewFilter === 'archived' ? 'No archived emails.' : 'No email in inbox.'}</p>}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 280px', minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '520px', overflowY: 'auto' }}>
          {threads.map(thread => {
            const rawEmail = thread.latest.direction === 'inbound' ? thread.latest.from_email : thread.latest.to_email
            const matchedName = getDisplayName(rawEmail)
            return (
              <button
                key={thread.threadId}
                onClick={() => selectThread(thread)}
                style={{
                  textAlign: 'left',
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px',
                  border: thread.threadId === selectedThreadId ? '1px solid #1a1a1a' : '1px solid #ddd',
                  background: thread.threadId === selectedThreadId ? '#f3f3f3' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
                  <p style={{ fontWeight: thread.unreadCount > 0 ? 700 : 600, margin: 0, fontSize: '0.95rem' }}>
                    {matchedName ? `${matchedName}` : rawEmail}
                    {thread.unreadCount > 0 && <span style={{ marginLeft: '0.4rem', color: '#c0392b' }}>({thread.unreadCount} new)</span>}
                  </p>
                </div>
                {matchedName && (
                  <p style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.2rem' }}>{rawEmail}</p>
                )}
                <p style={{ fontSize: '0.85rem', color: '#333', marginBottom: '0.15rem' }}>{thread.latest.subject || '(no subject)'}</p>
                <p style={{ fontSize: '0.75rem', color: '#888', margin: 0 }}>{new Date(thread.latest.created_at).toLocaleString()}</p>
              </button>
            )
          })}
        </div>

        {selectedThread && (
          <div style={{ flex: '2 1 400px', minWidth: '300px', border: '1px solid #ddd', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h5 style={{ fontWeight: 600, fontSize: '0.95rem', margin: 0 }}>Thread Messages</h5>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {selectedThread.isArchived ? (
                  <button
                    onClick={() => handleArchiveThread(selectedThread.threadId, false)}
                    style={{ ...btnStyle, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                  >
                    Unarchive Thread
                  </button>
                ) : (
                  <button
                    onClick={() => handleArchiveThread(selectedThread.threadId, true)}
                    style={{ ...btnStyle, background: '#f5f5f3', color: '#333', border: '1px solid #ddd', fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                  >
                    Archive Thread
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '340px', overflowY: 'auto', marginBottom: '1rem' }}>
              {selectedThread.messages.map(message => {
                const isClient = message.direction === 'inbound'
                const personEmail = isClient ? message.from_email : message.to_email
                const personName = getDisplayName(personEmail)
                const senderLabel = isClient
                  ? (personName ? `${personName} <${message.from_email}>` : message.from_email)
                  : (personName ? `You → ${personName} <${message.to_email}>` : `You → ${message.to_email}`)

                return (
                  <div key={message.id} style={{ background: isClient ? '#f7f7f7' : '#eef4ff', borderRadius: '8px', padding: '0.65rem 0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <p style={{ fontSize: '0.8rem', color: '#555', margin: 0 }}>
                        <strong>{senderLabel}</strong>
                        {' · '}{new Date(message.created_at).toLocaleString()}
                      </p>
                    </div>
                    {message.html_body
                      ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.html_body) }} />
                      : <p style={{ whiteSpace: 'pre-wrap' }}>{message.text_body}</p>}
                  </div>
                )
              })}
            </div>

            {sendError && <p style={{ color: 'red', marginBottom: '0.5rem' }}>Error: {sendError}</p>}
            <textarea
              value={replyMessage}
              onChange={e => setReplyMessage(e.target.value)}
              placeholder="Write a reply..."
              rows={4}
              style={{ ...inputStyle, marginBottom: '0.5rem', resize: 'vertical' }}
            />
            <button
              onClick={handleReply}
              disabled={sending || !replyMessage.trim()}
              style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', padding: '0.6rem 1rem' }}
            >
              {sending ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsTab() {
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState([])
  const [settingsView, setSettingsView] = useState('email')

  async function handleResendAllApplications() {
    if (!confirm('Resend email notifications for all puppy applications?')) return
    setSending(true)
    setMessage('')
    setFailures([])
    try {
      const result = await callFunction('resend-all-applications', {})
      const sent = result?.sent_count ?? 0
      const total = result?.total_applications ?? 0
      const failed = result?.failed_count ?? 0
      setFailures(Array.isArray(result?.failures) ? result.failures : [])
      setMessage(`Done. Sent ${sent}/${total} notifications${failed ? ` (${failed} failed)` : ''}.`)
    } catch (err) {
      setMessage(`Error: ${err.message}`)
    }
    setSending(false)
  }

  return (
    <div>
      <h3 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Settings</h3>
      <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
        Admin communications and maintenance tools.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setSettingsView('email')} style={{ ...btnStyle, background: settingsView === 'email' ? '#1a1a1a' : '#fff', border: settingsView === 'email' ? '1px solid #1a1a1a' : '1px solid #ddd', color: settingsView === 'email' ? '#fff' : '#333' }}>Email</button>
        <button onClick={() => setSettingsView('tools')} style={{ ...btnStyle, background: settingsView === 'tools' ? '#1a1a1a' : '#fff', border: settingsView === 'tools' ? '1px solid #1a1a1a' : '1px solid #ddd', color: settingsView === 'tools' ? '#fff' : '#333' }}>Tools</button>
        <button onClick={() => setSettingsView('archived-applications')} style={{ ...btnStyle, background: settingsView === 'archived-applications' ? '#1a1a1a' : '#fff', border: settingsView === 'archived-applications' ? '1px solid #1a1a1a' : '1px solid #ddd', color: settingsView === 'archived-applications' ? '#fff' : '#333' }}>Archived Applications</button>
      </div>

      {settingsView === 'email' && <EmailTab />}
      {settingsView === 'archived-applications' && <ArchivedApplicationsTab />}
      {settingsView === 'tools' && <>

      {message && (
        <p style={{ color: message.startsWith('Error:') ? 'red' : '#2d7a3a', marginBottom: '1rem' }}>
          {message}
        </p>
      )}

      <div style={{ background: '#fff8e5', border: '1px solid #ffe08a', borderRadius: '10px', padding: '1rem' }}>
        <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Resend application emails</p>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.85rem' }}>
          Sends the puppy application notification email again for every application currently in the database.
        </p>
        <button
          onClick={handleResendAllApplications}
          disabled={sending}
          style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', padding: '0.65rem 1rem' }}
        >
          {sending ? 'Resending...' : 'Resend All Applications'}
        </button>

        {failures.length > 0 && (
          <div style={{ marginTop: '1rem', borderTop: '1px solid #f0d98a', paddingTop: '0.75rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#7a4f00', marginBottom: '0.5rem' }}>
              Failure details
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {failures.map((f, idx) => (
                <pre
                  key={`${f.application_id || 'unknown'}-${idx}`}
                  style={{
                    margin: 0,
                    background: '#fff',
                    border: '1px solid #f0d98a',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    fontSize: '0.75rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {f.error || 'Unknown error'}
                </pre>
              ))}
            </div>
          </div>
        )}
      </div>
      </>}
    </div>
  )
}

// ── ADMIN DASHBOARD SHELL ──
function AdminDashboard() {
  const [tab, setTab] = useState('puppies')
  const tabs = ['puppies', 'litters', 'dogs', 'waitlist', 'applications', 'users', 'files', 'email campaigns', 'settings']

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 600, fontSize: '1.2rem' }}>Admin Dashboard</h2>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem', WebkitOverflowScrolling: 'touch' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '0.4rem 1rem', borderRadius: '6px', border: '1px solid #ddd', whiteSpace: 'nowrap', background: tab === t ? '#1a1a1a' : '#fff', color: tab === t ? '#fff' : '#333', cursor: 'pointer', textTransform: 'capitalize', fontWeight: tab === t ? 600 : 400, fontSize: '0.9rem', flexShrink: 0 }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'puppies' && <PuppiesTab />}
      {tab === 'litters' && <LittersTab />}
      {tab === 'dogs' && <DogsTab />}
      {tab === 'waitlist' && <WaitlistTab />}
      {tab === 'applications' && <ApplicationsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'files' && <AdminFiles />}
      {tab === 'email campaigns' && <AdminCampaigns />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

export default function Admin() {
  const { session, loading } = useAuth()
  if (loading) return <p style={{ color: '#888' }}>Loading...</p>
  if (!session) return null
  return <AdminDashboard />
}
