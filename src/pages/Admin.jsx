import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'

const inputStyle = {
  padding: '0.6rem', border: '1px solid #ddd',
  borderRadius: '6px', fontSize: '16px', width: '100%'
}

const btnStyle = {
  padding: '0.5rem 1rem', borderRadius: '6px',
  border: 'none', cursor: 'pointer', fontSize: '0.9rem'
}

// ── Upload a single file to Supabase storage ──
async function uploadFile(bucket, file) {
  const ext = file.name.split('.').pop()
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file)
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
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

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
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
  function handleFilesSelected(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    const queue = []
    let loaded = 0
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        queue.push({ file, dataUrl: reader.result })
        loaded++
        if (loaded === files.length) {
          setCropQueue(queue)
          setCropIndex(0)
          setCrop({ x: 0, y: 0 })
          setZoom(1)
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
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
      await supabase.from('puppy_photos').insert({
        puppy_id: puppyId,
        photo_url: data.publicUrl,
        caption: caption || null,
        sort_order: photos.length + cropIndex
      })

      if (cropIndex < cropQueue.length - 1) {
        // More photos to crop
        setCropIndex(i => i + 1)
        setCrop({ x: 0, y: 0 })
        setZoom(1)
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
      await supabase.from('puppy_photos').insert({
        puppy_id: puppyId,
        photo_url: url,
        caption: caption || null,
        sort_order: photos.length + cropIndex
      })

      if (cropIndex < cropQueue.length - 1) {
        setCropIndex(i => i + 1)
        setCrop({ x: 0, y: 0 })
        setZoom(1)
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
  }

  async function handleDelete(photoId) {
    if (!confirm('Delete this photo?')) return
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
      <img src={photo.photo_url} alt={photo.caption || `Photo ${index + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
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

// ── WAITLIST TAB (preserved from original) ──
const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL

function WaitlistTab() {
  const [waitlist, setWaitlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', position: '', notes: '', password: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [activePerson, setActivePerson] = useState(null)
  const [pendingPerson, setPendingPerson] = useState(null)
  const [nextInLine, setNextInLine] = useState(null)
  const [showMoveNext, setShowMoveNext] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const { data } = await supabase.from('waitlist').select('*, puppies(name, color, gender)').order('position')
    const list = data || []
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

  function startNew() {
    setEditing('new')
    setForm({ name: '', email: '', phone: '', position: waitlist.length + 1, notes: '', password: '' })
  }

  function startEdit(person) {
    setEditing(person.id)
    setForm({ name: person.name || '', email: person.email || '', phone: person.phone || '', position: person.position || '', notes: person.notes || '', password: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    if (editing === 'new') {
      if (!form.email || !form.password) { setMessage('Email and password are required for new entries.'); setSaving(false); return }
      const { error: authError } = await supabase.auth.admin
        ? { error: null }
        : { error: null }
      const { error } = await supabase.from('waitlist').insert({ name: form.name, email: form.email, phone: form.phone, position: Number(form.position), notes: form.notes })
      if (error) setMessage('Error: ' + error.message)
      else { setMessage('Added!'); setEditing(null); fetchAll() }
    } else {
      const { error } = await supabase.from('waitlist').update({ name: form.name, email: form.email, phone: form.phone, position: Number(form.position), notes: form.notes }).eq('id', editing)
      if (error) setMessage('Error: ' + error.message)
      else { setMessage('Saved!'); setEditing(null); fetchAll() }
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
    setSaving(true)
    await supabase.from('waitlist').update({ is_active: true }).eq('id', nextInLine.id)
    setMessage(`${nextInLine.name} can now pick their puppy.`)
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
    if (!confirm('Remove this person from the waitlist?')) return
    setSaving(true)
    const person = waitlist.find(w => w.id === id)
    if (person?.email) {
      try {
        await fetch(`${FUNCTIONS_URL}/delete-client-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ email: person.email })
        })
      } catch (err) { console.error('Failed to delete auth user:', err) }
    }
    await supabase.from('waitlist').delete().eq('id', id)
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
        <button onClick={startNew} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>+ Add Person</button>
      </div>

      {editing && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>{editing === 'new' ? 'Add to Waitlist' : 'Edit Entry'}</h4>
          <FormGrid>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Email</label><input type="email" style={inputStyle} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Phone</label><input style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Position #</label><input type="number" style={inputStyle} value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></div>
            {editing === 'new' && (
              <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Password (required)</label><input type="password" style={inputStyle} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Set their portal password" /></div>
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
              <button onClick={() => startEdit(w)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
              <button onClick={() => handleDelete(w.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ADMIN DASHBOARD SHELL ──
function AdminDashboard() {
  const [tab, setTab] = useState('puppies')
  const tabs = ['puppies', 'litters', 'dogs', 'waitlist']

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
    </div>
  )
}

export default function Admin() {
  const { session, loading } = useAuth()
  if (loading) return <p style={{ color: '#888' }}>Loading...</p>
  if (!session) return null
  return <AdminDashboard />
}