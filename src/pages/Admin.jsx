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

async function uploadFile(bucket, file) {
  const ext = file.name.split('.').pop()
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file)
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          zIndex: 2000, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1rem',
          padding: '1rem'
        }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '360px', height: '360px', background: '#000' }}>
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', width: '100%', maxWidth: '360px' }}>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: '100%' }} />
            <p style={{ color: '#ccc', fontSize: '0.8rem' }}>Drag to reposition · Slider to zoom</p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', width: '100%', maxWidth: '360px' }}>
            <button onClick={handleCropConfirm} disabled={uploading} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>
              {uploading ? 'Uploading...' : 'Crop & Save'}
            </button>
            <button onClick={() => setCropSrc(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {value && (
        <img src={value} alt="preview" style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e0e0e0' }} />
      )}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button type="button" onClick={() => fileRef.current.click()} style={{ ...btnStyle, background: '#f0f0f0', border: '1px solid #ddd', fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}>
          {value ? 'Change Photo' : 'Upload Photo'}
        </button>
        {value && (
          <button type="button" onClick={() => onChange('')} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', border: '1px solid #fcc', fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}>
            Remove
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

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
        {value && (
          <a href={value} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: '#1a1a1a', textDecoration: 'underline' }}>
            View current file
          </a>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

// Reusable mobile-friendly form grid
function FormGrid({ children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '0.75rem'
    }}>
      {children}
    </div>
  )
}

function PuppiesTab() {
  const [puppies, setPuppies] = useState([])
  const [litters, setLitters] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', gender: '', color: '', status: 'available', litter_id: '', notes: '', photo_url: '' })
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
    setReservers(Object.fromEntries((r || []).map(entry => [entry.selected_puppy_id, entry.name])))
    setLoading(false)
  }

  function startEdit(puppy) {
    setEditing(puppy.id)
    setForm({ name: puppy.name || '', gender: puppy.gender || '', color: puppy.color || '', status: puppy.status || 'available', litter_id: puppy.litter_id || '', notes: puppy.notes || '', photo_url: puppy.photo_url || '' })
  }

  function startNew() {
    setEditing('new')
    setForm({ name: '', gender: '', color: '', status: 'available', litter_id: '', notes: '', photo_url: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const payload = { name: form.name, gender: form.gender, color: form.color, status: form.status, litter_id: form.litter_id || null, notes: form.notes, photo_url: form.photo_url }
    const { error } = editing === 'new' ? await supabase.from('puppies').insert(payload) : await supabase.from('puppies').update(payload).eq('id', editing)
    if (error) setMessage('Error: ' + error.message)
    else { setMessage('Saved!'); setEditing(null); fetchAll() }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this puppy?')) return
    await supabase.from('puppies').delete().eq('id', id)
    fetchAll()
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
          <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>{editing === 'new' ? 'Add New Puppy' : 'Edit Puppy'}</h4>
          <FormGrid>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Gender</label>
              <select style={inputStyle} value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select...</option><option>Male</option><option>Female</option>
              </select>
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Color</label><input style={inputStyle} value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option>
              </select>
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Litter</label>
              <select style={inputStyle} value={form.litter_id} onChange={e => setForm({ ...form, litter_id: e.target.value })}>
                <option value="">None</option>{litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Photo</label>
              <PhotoUpload value={form.photo_url} onChange={url => setForm({ ...form, photo_url: url })} bucket="puppy-photos" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '0.8rem', color: '#666' }}>Notes</label><textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </FormGrid>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', flex: 1, padding: '0.75rem' }}>{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: '#fff', border: '1px solid #ddd', flex: 1, padding: '0.75rem' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Mobile card list instead of table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {puppies.map(p => (
          <div key={p.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            {p.photo_url
              ? <img src={p.photo_url} alt={p.name} style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
              : <div style={{ width: '56px', height: '56px', background: '#f0f0f0', borderRadius: '8px', flexShrink: 0 }} />
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <p style={{ fontWeight: 600 }}>{p.name}</p>
                <span style={{ fontSize: '0.75rem', textTransform: 'capitalize', padding: '0.2rem 0.5rem', borderRadius: '20px', background: p.status === 'available' ? '#e6f4ea' : p.status === 'reserved' ? '#fff4e5' : '#f0f0f0', color: p.status === 'available' ? '#2d7a3a' : p.status === 'reserved' ? '#b36200' : '#888', whiteSpace: 'nowrap' }}>{p.status}</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#666' }}>{p.gender} · {p.color}</p>
              {p.litters?.name && <p style={{ fontSize: '0.8rem', color: '#888' }}>{p.litters.name}</p>}
              {p.status === 'reserved' && reservers[p.id] && <p style={{ fontSize: '0.8rem', color: '#888' }}>Reserved by {reservers[p.id]}</p>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
              <button onClick={() => startEdit(p)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
              <button onClick={() => handleDelete(p.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LittersTab() {
  const [litters, setLitters] = useState([])
  const [dogs, setDogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', birth_date: '', mother_id: '', father_id: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: l }, { data: d }] = await Promise.all([
      supabase.from('litters').select('*, mother:dogs!litters_mother_id_fkey(name), father:dogs!litters_father_id_fkey(name)').order('id'),
      supabase.from('dogs').select('*').order('name')
    ])
    setLitters(l || [])
    setDogs(d || [])
    setLoading(false)
  }

  function startEdit(litter) {
    setEditing(litter.id)
    setForm({ name: litter.name || '', birth_date: litter.birth_date || '', mother_id: litter.mother_id || '', father_id: litter.father_id || '', notes: litter.notes || '' })
  }

  function startNew() {
    setEditing('new')
    setForm({ name: '', birth_date: '', mother_id: '', father_id: '', notes: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const payload = { name: form.name, birth_date: form.birth_date || null, mother_id: form.mother_id || null, father_id: form.father_id || null, notes: form.notes }
    const { error } = editing === 'new' ? await supabase.from('litters').insert(payload) : await supabase.from('litters').update(payload).eq('id', editing)
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
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Litter Name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Birth Date</label><input type="date" style={inputStyle} value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Mother</label>
              <select style={inputStyle} value={form.mother_id} onChange={e => setForm({ ...form, mother_id: e.target.value })}>
                <option value="">None</option>{dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Father</label>
              <select style={inputStyle} value={form.father_id} onChange={e => setForm({ ...form, father_id: e.target.value })}>
                <option value="">None</option>{dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
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
              <p style={{ fontWeight: 600 }}>{l.name}</p>
              <p style={{ fontSize: '0.85rem', color: '#666' }}>{l.birth_date || 'No birth date'}</p>
              <p style={{ fontSize: '0.8rem', color: '#888' }}>Dam: {l.mother?.name || '—'} · Sire: {l.father?.name || '—'}</p>
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

function DogsTab() {
  const [dogs, setDogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', registration_number: '', pedigree_url: '', photo_url: '', notes: '' })
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
    setForm({ name: dog.name || '', registration_number: dog.registration_number || '', pedigree_url: dog.pedigree_url || '', photo_url: dog.photo_url || '', notes: dog.notes || '' })
  }

  function startNew() {
    setEditing('new')
    setForm({ name: '', registration_number: '', pedigree_url: '', photo_url: '', notes: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const payload = { name: form.name, registration_number: form.registration_number, pedigree_url: form.pedigree_url, photo_url: form.photo_url, notes: form.notes }
    const { error } = editing === 'new' ? await supabase.from('dogs').insert(payload) : await supabase.from('dogs').update(payload).eq('id', editing)
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
        <h3 style={{ fontWeight: 600 }}>Dogs</h3>
        <button onClick={startNew} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>+ Add Dog</button>
      </div>

      {message && <p style={{ color: message.startsWith('Error') ? 'red' : 'green', marginBottom: '1rem' }}>{message}</p>}

      {editing && (
        <div style={{ background: '#f5f5f3', border: '1px solid #e0e0e0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>{editing === 'new' ? 'Add New Dog' : 'Edit Dog'}</h4>
          <FormGrid>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666' }}>Registration Number</label><input style={inputStyle} value={form.registration_number} onChange={e => setForm({ ...form, registration_number: e.target.value })} /></div>
            <div><label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Photo</label>
              <PhotoUpload value={form.photo_url} onChange={url => setForm({ ...form, photo_url: url })} bucket="puppy-photos" />
            </div>
            <div><label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.4rem' }}>Pedigree File</label>
              <PedigreeUpload value={form.pedigree_url} onChange={url => setForm({ ...form, pedigree_url: url })} />
            </div>
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
            {d.photo_url
              ? <img src={d.photo_url} alt={d.name} style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
              : <div style={{ width: '56px', height: '56px', background: '#f0f0f0', borderRadius: '8px', flexShrink: 0 }} />
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600 }}>{d.name}</p>
              {d.registration_number && <p style={{ fontSize: '0.85rem', color: '#666' }}>Reg: {d.registration_number}</p>}
              {d.pedigree_url && <a href={d.pedigree_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: '#1a1a1a', textDecoration: 'underline' }}>View Pedigree</a>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
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
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', position: '', password: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
  const PORTAL_URL = import.meta.env.VITE_PORTAL_URL

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const { data } = await supabase.from('waitlist').select('*, puppies(name)').order('position')
    setWaitlist(data || [])
    setLoading(false)
  }

  const activePerson = waitlist.find(w => w.is_active)
  const pendingPerson = waitlist.find(w => w.pending_approval)
  const nextInLine = waitlist.find(w => !w.is_active && !w.pending_approval && !w.selected_puppy_id)
  const showMoveNext = !activePerson && !pendingPerson && !!nextInLine

  function startEdit(person) {
    setEditing(person.id)
    setForm({ name: person.name || '', email: person.email || '', phone: person.phone || '', position: person.position || '', password: '', notes: person.notes || '' })
  }

  function startNew() {
    setEditing('new')
    setForm({ name: '', email: '', phone: '', position: '', password: '', notes: '' })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')

    if (editing === 'new') {
      if (!form.password) { setMessage('Error: Please set a password for this client.'); setSaving(false); return }
      const res = await fetch(`${FUNCTIONS_URL}/create-client-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ email: form.email, password: form.password, name: form.name })
      })
      const result = await res.json()
      if (result.error) { setMessage('Error creating account: ' + result.error); setSaving(false); return }
    }

    const payload = { name: form.name, email: form.email, phone: form.phone, position: form.position || null, notes: form.notes }
    const { error } = editing === 'new' ? await supabase.from('waitlist').insert(payload) : await supabase.from('waitlist').update(payload).eq('id', editing)
    if (error) setMessage('Error: ' + error.message)
    else { setMessage('Saved!'); setEditing(null); fetchAll() }
    setSaving(false)
  }

  async function handleMoveToNext() {
    if (!nextInLine) return
    if (!confirm(`Let ${nextInLine.name} choose their puppy now?`)) return
    setSaving(true)
    setMessage('')
    await supabase.from('waitlist').update({ is_active: true }).eq('id', nextInLine.id)
    try {
      await fetch(`${FUNCTIONS_URL}/send-turn-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ clientName: nextInLine.name, clientEmail: nextInLine.email, portalUrl: PORTAL_URL })
      })
      setMessage(`${nextInLine.name} has been notified and can now choose their puppy.`)
    } catch (err) {
      setMessage(`${nextInLine.name} is now active. Email failed — notify them manually.`)
    }
    fetchAll()
    setSaving(false)
  }

  async function handleApprove(person) {
    if (!confirm(`Approve ${person.name}'s selection of ${person.puppies?.name}?`)) return
    setSaving(true)
    setMessage('')
    await Promise.all([
      supabase.from('waitlist').update({ pending_approval: false }).eq('id', person.id),
      supabase.from('puppies').update({ status: 'reserved' }).eq('id', person.selected_puppy_id)
    ])
    setMessage(`Approved! ${person.name} has reserved ${person.puppies?.name}.`)
    fetchAll()
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this person from the waitlist?')) return
    await supabase.from('waitlist').delete().eq('id', id)
    fetchAll()
  }

  if (loading) return <p style={{ color: '#888' }}>Loading...</p>

  return (
    <div>
      {showMoveNext && (
        <div style={{ background: '#f0faf2', border: '1px solid #b2dfb8', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Ready to move to the next person</p>
          <p style={{ color: '#555', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{nextInLine.name} is next (position #{nextInLine.position})</p>
          <button onClick={handleMoveToNext} disabled={saving} style={{ ...btnStyle, background: '#2d7a3a', color: '#fff', width: '100%', padding: '0.75rem' }}>
            Let {nextInLine.name} Pick
          </button>
        </div>
      )}

      {pendingPerson && (
        <div style={{ background: '#fff8e5', border: '1px solid #ffe08a', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>⏳ Approval needed</p>
          <p style={{ color: '#555', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{pendingPerson.name} has selected {pendingPerson.puppies?.name}</p>
          <button onClick={() => handleApprove(pendingPerson)} disabled={saving} style={{ ...btnStyle, background: '#b36200', color: '#fff', width: '100%', padding: '0.75rem' }}>
            Approve Selection
          </button>
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
                {w.pending_approval ? <span style={{ color: '#b36200', fontWeight: 600 }}>⏳ Pending</span>
                  : w.is_active ? <span style={{ color: '#5555cc', fontWeight: 600 }}>🐾 Choosing</span>
                  : w.selected_puppy_id ? <span style={{ color: '#2d7a3a' }}>✓ Reserved: {w.puppies?.name}</span>
                  : <span style={{ color: '#aaa' }}>Waiting</span>}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
              <button onClick={() => startEdit(w)} style={{ ...btnStyle, background: '#f0f0f0', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Edit</button>
              <button onClick={() => handleDelete(w.id)} style={{ ...btnStyle, background: '#fff0f0', color: '#c00', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AdminDashboard({ session }) {
  const [tab, setTab] = useState('puppies')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 600, fontSize: '1.2rem' }}>Admin Dashboard</h2>
      </div>

      {/* Scrollable tab bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem', WebkitOverflowScrolling: 'touch' }}>
        {['puppies', 'litters', 'dogs', 'waitlist'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '0.4rem 1rem', borderRadius: '6px',
            border: '1px solid #ddd', whiteSpace: 'nowrap',
            background: tab === t ? '#1a1a1a' : '#fff',
            color: tab === t ? '#fff' : '#333',
            cursor: 'pointer', textTransform: 'capitalize',
            fontWeight: tab === t ? 600 : 400, fontSize: '0.9rem',
            flexShrink: 0
          }}>{t}</button>
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
  return <AdminDashboard session={session} />
}