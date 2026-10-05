import { writeFileSync } from 'node:fs'
import { latestPuppyImage, availableLitterId } from '../src/lib/puppyDisplay.js'
const base='http://127.0.0.1:3002/rest/v1'
const [litters,puppies,photos]=await Promise.all([
  fetch(`${base}/litters?select=id,name&order=created_at.desc`).then(r=>r.json()),
  fetch(`${base}/puppies?select=id,name,litter_id,status,photo_url`).then(r=>r.json()),
  fetch(`${base}/puppy_photos?select=id,puppy_id,photo_url,created_at,sort_order`).then(r=>r.json()),
])
const id=availableLitterId(litters,puppies)
const report={litter:litters.find(litter=>litter.id===id).name, images:puppies.filter(puppy=>String(puppy.litter_id)===String(id)).map(puppy=>({name:puppy.name,url:latestPuppyImage(photos.filter(photo=>photo.puppy_id===puppy.id),puppy.photo_url)}))}
writeFileSync(new URL('./display-check.json',import.meta.url),JSON.stringify(report))
console.log(`Expected default: ${report.litter}; ${report.images.length} puppy covers derived from latest uploads.`)
