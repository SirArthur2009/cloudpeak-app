// Supabase's render endpoint may be unavailable on some plans. Images fall back
// to their original URL when that happens.
export function sizedImageUrl(url, width) {
  if (!url || !/\/storage\/v1\/object\/public\//.test(url) || /\.(svg|gif)(?:\?|$)/i.test(url)) return url
  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + `${url.includes('?') ? '&' : '?'}width=${width}&quality=75`
}

export function originalOnError(event, original) {
  if (event.currentTarget.src !== original) event.currentTarget.src = original
}

export function preloadImage(url) {
  if (!url) return
  const image = new Image()
  image.src = url
}
