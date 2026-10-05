export function latestPuppyImage(photos = [], fallback = '') {
  let latest = null
  for (const photo of photos) {
    if (!photo.photo_url || /\.(mp4|webm|mov)(?:\?|$)/i.test(photo.photo_url)) continue
    const time = Date.parse(photo.created_at) || 0
    const previousTime = Date.parse(latest?.created_at) || 0
    if (!latest || time > previousTime || (time === previousTime && Number(photo.id || photo.sort_order || 0) >= Number(latest.id || latest.sort_order || 0))) latest = photo
  }
  return latest?.photo_url || fallback
}

export function availableLitterId(litters, puppies) {
  const available = new Set(puppies.filter(puppy => puppy.status === 'available').map(puppy => String(puppy.litter_id)))
  return litters.find(litter => available.has(String(litter.id)))?.id || litters[0]?.id || ''
}
