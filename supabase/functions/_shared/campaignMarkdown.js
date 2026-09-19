const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function inline(value) {
  let html = escapeHtml(value)
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  return html
}

export function renderCampaignMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  const parts = []
  let paragraph = []
  let list = []
  const flushParagraph = () => { if (paragraph.length) parts.push(`<p>${paragraph.map(inline).join('<br />')}</p>`); paragraph = [] }
  const flushList = () => { if (list.length) parts.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`); list = [] }
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const item = line.match(/^\s*[-*]\s+(.+)$/)
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    if (heading) { flushParagraph(); flushList(); parts.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue }
    if (item) { flushParagraph(); list.push(item[1]); continue }
    flushList(); paragraph.push(line)
  }
  flushParagraph(); flushList()
  return parts.join('\n')
}
