// Single-process app server: JSON API + built SPA on one port.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
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
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
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

const server = http.createServer(async (req, res) => {
  let url
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  } catch {
    res.writeHead(400)
    res.end('bad request')
    return
  }
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

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500)
  })
}
