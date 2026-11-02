import { useCallback, useEffect, useState } from 'react'

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts
  })
  const type = res.headers.get('content-type') || ''
  const payload = type.includes('json') ? await res.json().catch(() => null) : await res.text()
  if (!res.ok) {
    const msg = payload && typeof payload === 'object' ? payload.error || payload.hint : payload
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return payload
}

export const jpost = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
export const jput = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) })
export const jdel = (path) => api(path, { method: 'DELETE' })

const enc = encodeURIComponent

export const endpoints = {
  events: () => '/api/events',
  summary: (sku) => `/api/events/${enc(sku)}/summary`,
  matches: (sku) => `/api/events/${enc(sku)}/matches`,
  match: (sku, key) => `/api/events/${enc(sku)}/match?key=${enc(key)}`,
  team: (sku, team, vs) => `/api/events/${enc(sku)}/team?team=${enc(team)}${vs ? `&vs=${enc(vs)}` : ''}`,
  opponent: (sku, team, own) => `/api/events/${enc(sku)}/opponent?team=${enc(team)}${own ? `&own=${enc(own)}` : ''}`,
  onsite: (sku, team) => `/api/events/${enc(sku)}/onsite?team=${enc(team)}`,
  sim: (sku, team) => `/api/events/${enc(sku)}/sim?team=${enc(team)}`,
  history: (team, fresh) => `/api/history?team=${enc(team)}${fresh ? '&fresh=1' : ''}`,
  meta: (sku) => `/api/events/${enc(sku)}/meta`,
  videos: (sku) => `/api/events/${enc(sku)}/videos`,
  report: (sku, team) => `/api/events/${enc(sku)}/report${team ? `?team=${enc(team)}` : ''}`
}

export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error: error.message, loading: false }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}

export const fmt = (v, d = 1) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const n = Number(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(d)
}
export const pct = (v, d = 0) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(d)}%`)
export const sign = (v, d = 1) => {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${fmt(n, d)}`
}
export const clock = (s) => {
  if (s === null || s === undefined) return '—'
  const t = Math.max(0, Math.round(Number(s)))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
export const dateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
