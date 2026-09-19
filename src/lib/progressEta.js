export function estimatedTimeRemaining(startedAt, completed, total) {
  if (!total || !completed || completed >= total) return completed >= total && total ? 'Almost done' : 'Estimating…'
  const seconds = Math.max(1, Math.ceil((Date.now() - startedAt) / 1000 / completed * (total - completed)))
  if (seconds < 60) return `About ${seconds}s remaining`
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `About ${minutes} min remaining` : `About ${Math.floor(minutes / 60)} hr ${minutes % 60} min remaining`
}
