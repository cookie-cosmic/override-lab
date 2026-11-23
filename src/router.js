// Hash router shared by every page. Keeping it here (instead of inside App.jsx) means a view
// can link to another without importing the whole app shell.

export function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, query] = raw.split('?')
  const segs = path.split('/').filter(Boolean)
  return { segs, q: new URLSearchParams(query || '') }
}

export function navigate(path) {
  const target = `#/${String(path || '').replace(/^#?\/?/, '')}`
  if (window.location.hash === target) return
  window.location.hash = target
}

export function href(path) {
  return `#/${String(path || '').replace(/^#?\/?/, '')}`
}
