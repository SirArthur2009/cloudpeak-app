import { useRef, useState } from 'react'
import { linkPuppyPhotoToExplorer, scanPuppyPhotoDuplicates } from '../lib/duplicatePhotos'
import { estimatedTimeRemaining } from '../lib/progressEta'
import './DuplicatePhotoTool.css'

export default function DuplicatePhotoTool() {
  const [matches, setMatches] = useState([])
  const [chosen, setChosen] = useState({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const scanController = useRef(null)

  async function scan() {
    const startedAt = Date.now()
    const controller = new AbortController()
    scanController.current = controller
    setBusy(true); setCancelling(false); setStatus(''); setMatches([]); setChosen({}); setProgress({ completed: 0, total: 0, label: 'Finding photos', eta: 'Estimating…' })
    try {
      const found = await scanPuppyPhotoDuplicates(value => setProgress({ ...value, eta: estimatedTimeRemaining(startedAt, value.completed, value.total) }), controller.signal)
      setMatches(found)
      setStatus(found.length ? `${found.length} possible duplicate photo references found. Review each match before linking.` : 'No matching puppy photos found.')
    } catch (error) { setStatus(controller.signal.aborted ? 'Scan cancelled.' : `Scan failed: ${error.message}`) }
    scanController.current = null; setProgress(null); setCancelling(false); setBusy(false)
  }

  async function apply(match) {
    const file = match.candidates.find(candidate => candidate.file.id === chosen[`${match.kind}:${match.id}`])?.file || match.candidates[0].file
    setBusy(true); setStatus(`Linking ${match.label}...`)
    try {
      const result = await linkPuppyPhotoToExplorer(match, file)
      setMatches(rows => rows.filter(row => row !== match))
      setStatus(result.removed ? 'Photo linked; the duplicate storage object was removed.' : 'Photo linked. The old storage object was kept because another reference may use it or cleanup could not finish.')
    } catch (error) { setStatus(`Could not link photo: ${error.message}`) }
    setBusy(false)
  }

  return <section className="duplicate-photo-tool">
    <div className="duplicate-tool-header"><div><span className="duplicate-eyebrow">PHOTO LIBRARY</span><h4>Clean up duplicate puppy photos</h4><p>Find possible matches in Files, compare them side by side, then link the one you want to keep. Nothing is removed during the scan.</p></div><button type="button" className="duplicate-scan-button" onClick={scan} disabled={busy}>{busy ? 'Scanning...' : matches.length ? 'Scan again' : 'Find matches'}</button></div>
    <div className="duplicate-steps"><span><b>1</b> Scan photos</span><span><b>2</b> Review matches</span><span><b>3</b> Link and clean up</span></div>
    {status && <p role="status" className="duplicate-status">{status}</p>}
    {progress && <div role="status" className="duplicate-status duplicate-progress"><div><span>{cancelling ? 'Cancelling scan…' : `${progress.label} · ${progress.total ? `${progress.completed} of ${progress.total}` : 'Preparing'} · ${progress.eta}`}</span><strong>{progress.total ? `${Math.round(progress.completed / progress.total * 100)}%` : ''}</strong></div><progress value={progress.total ? progress.completed : undefined} max={progress.total || 1} aria-label="Duplicate photo scan progress" /><button type="button" disabled={cancelling} onClick={() => { scanController.current?.abort(); setCancelling(true) }}>Cancel scan</button></div>}
    {matches.length > 0 && <div className="duplicate-results-heading"><strong>Possible matches</strong><span>{matches.length} to review</span></div>}
    <div className="duplicate-results">{matches.map((match, index) => {
      const key = `${match.kind}:${match.id}`
      const candidate = match.candidates.find(item => item.file.id === chosen[key]) || match.candidates[0]
      return <article className="duplicate-match" key={key}>
        <div className="duplicate-match-heading"><div><small>MATCH {index + 1}</small><strong>{match.label}</strong></div><span>{candidate.reason}</span></div>
        <div className="duplicate-match-images"><div><span>Current puppy photo</span><img src={match.url} alt={`Current photo for ${match.label}`} /></div><div><span>Keep from Files</span>{candidate.previewUrl ? <img src={candidate.previewUrl} alt={candidate.file.name} /> : <div className="duplicate-no-preview">Preview unavailable</div>}</div></div>
        <div className="duplicate-match-actions"><label>Choose explorer image<select value={candidate.file.id} onChange={event => setChosen(values => ({ ...values, [key]: event.target.value }))} disabled={busy}>{match.candidates.map(item => <option key={item.file.id} value={item.file.id}>{item.file.name} · {item.reason}</option>)}</select></label><button type="button" disabled={busy} onClick={() => apply(match)}>Use this image</button></div>
      </article>
    })}</div>
  </section>
}
