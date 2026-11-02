// Small, dependency-free math + HTTP helpers shared by the server and engines.

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
export const sum = (a) => a.reduce((s, x) => s + x, 0)
export const mean = (a) => (a.length ? sum(a) / a.length : 0)

export function variance(a) {
  if (a.length < 2) return 0
  const m = mean(a)
  return sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)
}
export const sd = (a) => Math.sqrt(variance(a))

/** Linear-interpolated quantile of an unsorted array. q in [0,1]. */
export function quantile(a, q) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const pos = (s.length - 1) * clamp(q, 0, 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return s[lo]
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** Percentile rank of x within arr, 0..1 (midpoint convention for ties). */
export function pctRank(arr, x) {
  if (!arr.length) return 0
  let below = 0
  let equal = 0
  for (const v of arr) {
    if (v < x) below++
    else if (v === x) equal++
  }
  return (below + equal / 2) / arr.length
}

export const expit = (x) => 1 / (1 + Math.exp(-x))
export const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)))

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 / erf approximation). */
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2)
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z >= 0 ? 1 - p : p
}

/** Inverse standard normal CDF (Acklam's algorithm). */
export function normInv(p) {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  let q, r
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  q = p - 0.5
  r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** Solve A x = b (dense, partial pivoting). A is array of row arrays. */
export function solveLinear(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-12) continue
    if (piv !== col) {
      const tmp = M[piv]
      M[piv] = M[col]
      M[col] = tmp
    }
    const pv = M[col][col]
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pv
      if (!f) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]
    x[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : s / M[i][i]
  }
  return x
}

/** Deterministic PRNG so every analysis run is reproducible. */
export function rng(seed = 12345) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.normal = () => {
    let u = 0
    let v = 0
    while (u === 0) u = next()
    while (v === 0) v = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return next
}

export const round = (x, d = 1) => {
  if (x === null || x === undefined || Number.isNaN(x)) return null
  const f = 10 ** d
  return Math.round(x * f) / f
}

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** RFC4180-ish CSV parser: handles quoted fields, embedded commas and newlines. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const s = String(text).replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      /* skip */
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

export function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

export function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

export const matchKey = (m) => `${m.sku}::${m.division || ''}::r${m.round}i${m.instance ?? 1}m${m.matchnum}`

export const isElimRound = (round) => [3, 4, 5, 6, 15].includes(Number(round))
export const isQualRound = (round) => Number(round) === 2

export const ROUND_LABELS = {
  1: 'Practice',
  2: 'Qualification',
  3: 'Quarterfinal',
  4: 'Semifinal',
  5: 'Final',
  6: 'Round of 16',
  15: 'Finals (IQ)'
}
export const roundLabel = (r) => ROUND_LABELS[Number(r)] || `Round ${r}`

export const fmtDate = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Parse loose date strings from tournament-manager exports ("12/30/2017 09:00"). */
export function looseDate(v) {
  const s = String(v || '').trim()
  if (!s) return null
  const direct = new Date(s)
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(s)) return direct.toISOString()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (m) {
    let h = Number(m[4])
    const pm = /pm/i.test(m[6] || '')
    const am = /am/i.test(m[6] || '')
    if (pm && h < 12) h += 12
    if (am && h === 12) h = 0
    const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5])))
    return d.toISOString()
  }
  return null
}
