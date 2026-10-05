export function normalize(value, column) {
  if (value == null) return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(item => normalize(item))
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]))
  if (column && /^(bigint|integer|smallint|numeric|double precision|real)/.test(column.type)) {
    // Avoid Number() here: large decimal strings can exceed JS precision.
    return String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
    for (const marker of ['/storage/v1/object/public/', '/functions/v1/storage-files/public/']) {
      if (value.includes(marker)) return `storage:${value.split(marker)[1].split('?')[0]}`
    }
  }
  return value
}
