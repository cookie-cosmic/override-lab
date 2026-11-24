// Single-process app server: JSON API + built SPA on one port.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { handleApi } from './routes.js'
import { clearTransients, expireTransients } from './db.js'
import { loadEnv } from './env.js'

// Loads ROBOTEVENTS_TOKEN from a local .env when present. Values are never logged or served.
const envNames = loadEnv()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'

// The static UI may be hosted on another origin (Firebase Hosting) while the API lives here.
// No request carries credentials, so a wildcard origin is safe; CORS_ORIGIN pins it to one
// host if that ever changes.
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const CORS_HEADERS = {
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  // x-robotevents-token carries a key the user pasted into the UI; it is never stored here.
  // x-ol-session is an opaque, revocable device session; x-ol-totp is a one-time owner code.
  'access-control-allow-headers': 'content-type,x-robotevents-token,x-ol-session,x-ol-totp',
  'access-control-expose-headers': 'content-type',
  'access-control-max-age': '86400'
}

// gzip for text and JSON when the browser asks for it. The API's payloads run from tens to
// hundreds of kilobytes and a phone on a school network feels every byte of that.
function enableCompression(req, res) {
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return
  const writeHead = res.writeHead.bind(res)
  const end = res.end.bind(res)
  let staged = null
  res.writeHead = (...args) => {
    const headers = typeof args[1] === 'string' ? args[2] : args[1]
    staged = { status: args[0], headers: { ...(headers || {}) } }
    return res
  }
  res.end = (chunk, encoding, cb) => {
    let body = typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk
    const meta = staged || { status: res.statusCode, headers: {} }
    const headers = { ...meta.headers }
    if (body == null) {
      writeHead(meta.status, headers)
      return end()
    }
    if (!Buffer.isBuffer(body)) {
      writeHead(meta.status, headers)
      return end(body, encoding, cb)
    }
    const type = String(headers['content-type'] || '')
    if (body.length >= 512 && /^(text\/|application\/(json|javascript|xml|manifest))/i.test(type)) {
      const gz = zlib.gzipSync(body, { level: 6 })
      // Below ~10% saving the header is not worth the extra work on the client.
      if (gz.length < body.length * 0.9) {
        body = gz
        headers['content-encoding'] = 'gzip'
        headers['content-length'] = String(gz.length)
        headers.vary = headers.vary ? `${headers.vary}, accept-encoding` : 'accept-encoding'
      }
    }
    writeHead(meta.status, headers)
    return end(body, undefined, cb)
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

// Nothing is pre-loaded. Unsaved events from a previous run are removed on boot, so a
// crash or a closed tab never leaves half-finished imports behind.
const stale = clearTransients()
if (stale.length) console.log(`cleared ${stale.length} unsaved session(s) from the previous run`)
setInterval(() => {
  const expired = expireTransients(45)
  if (expired.length) console.log(`expired unsaved session(s): ${expired.join(', ')}`)
}, 5 * 60 * 1000).unref()

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Client bundle not built. Run `npm run build` (or `npm run preview`), then reload.')
    return
  }
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const target = path.resolve(DIST, rel)
  if (!target.startsWith(DIST)) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('forbidden')
    return
  }
  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(DIST, 'index.html')
  const ext = path.extname(file).toLowerCase()
  const isAsset = file.includes(`${path.sep}assets${path.sep}`)
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    res.end(buf)
  })
}

// Baseline web hardening. No framing restriction is applied because the app is legitimately
// embedded by its own preview hosts; the API's authorization does not depend on framing.
function harden(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self' https: ws: wss:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  )
}

const server = http.createServer(async (req, res) => {
  harden(res)
  let url
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  } catch {
    res.writeHead(400)
    res.end('bad request')
    return
  }
  enableCompression(req, res)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    // Cross-origin POSTs send application/json, which always asks permission first.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    res.setHeader('access-control-allow-origin', CORS_ORIGIN)
    await handleApi(req, res, url)
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  serveStatic(req, res, url.pathname)
})

server.listen(PORT, HOST, () => {
  console.log(`Override Lab listening on http://${HOST}:${PORT}`)
})

// Render's free plan suspends a service after ~15 idle minutes. One request every ten minutes
// keeps it warm, so the site is up around the clock instead of cold-starting on the morning's
// first visit. Render sets RENDER_EXTERNAL_URL itself; KEEP_ALIVE_URL overrides it.
const KEEP_ALIVE = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || ''
if (KEEP_ALIVE) {
  const target = `${KEEP_ALIVE.replace(/\/+$/, '')}/api/health`
  const ping = () => fetch(target, { headers: { 'user-agent': 'override-lab-keepalive' } }).catch(() => {})
  setTimeout(ping, 60 * 1000).unref()
  setInterval(ping, 10 * 60 * 1000).unref()
  console.log(`keep-alive ping every 10 min → ${target}`)
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500)
  })
}
