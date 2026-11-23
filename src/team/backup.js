// PIN-protected local backup.
//
// Every personal thing this app stores lives under `override-lab:*` in localStorage. A backup
// code is that set of keys, JSON-encoded and encrypted with AES-GCM under a key derived from a
// six-digit PIN. The code is safe to keep in a note: without the PIN it is just ciphertext.
// The RobotEvents key (`vex-api-token`) is deliberately not included — it is a credential, not
// team work.

const PREFIX = 'override-lab:'
const APP = 'override-lab'
const FORMAT = 'OL1'
const ITERATIONS = 150000

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64Url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(full)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function deriveKey(pin, salt) {
  const material = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export function generatePin() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return String(n).padStart(6, '0')
}

/** Everything personal, as a plain object. Never includes the API token. */
export function collectBackup() {
  const data = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(PREFIX)) data[key] = localStorage.getItem(key)
    }
  } catch {
    /* private mode with no storage: an empty backup is honest about that */
  }
  return data
}

export function backupSummary(data = collectBackup()) {
  const keys = Object.keys(data)
  const profile = data[`${PREFIX}profile:v1`]
  let teams = 0
  try {
    teams = JSON.parse(profile || '{}').teams?.length || 0
  } catch {
    teams = 0
  }
  return {
    keys: keys.length,
    teams,
    bytes: keys.reduce((s, k) => s + (data[k]?.length || 0), 0)
  }
}

/** Encrypt the backup. Returns { pin, code, summary }. */
export async function makeBackupCode(pin = generatePin()) {
  const data = collectBackup()
  if (!Object.keys(data).length) throw new Error('There is nothing saved in this browser yet.')
  const payload = { app: APP, v: 1, savedAt: new Date().toISOString(), data }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(pin, salt)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)))
  const code = `${FORMAT}.${toBase64Url(salt)}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`
  return { pin: String(pin), code, summary: backupSummary(data) }
}

/** Decrypt a code. Throws a readable error for a bad code or a wrong PIN. */
export async function readBackupCode(code, pin) {
  const raw = String(code || '').trim().replace(/\s+/g, '')
  const parts = raw.split('.')
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new Error('That is not an Override Lab backup code.')
  }
  let payload
  try {
    const salt = fromBase64Url(parts[1])
    const iv = fromBase64Url(parts[2])
    const cipher = fromBase64Url(parts[3])
    const key = await deriveKey(pin, salt)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    payload = JSON.parse(dec.decode(plain))
  } catch {
    throw new Error('The PIN does not match this code.')
  }
  if (payload?.app !== APP || !payload.data || typeof payload.data !== 'object') {
    throw new Error('That code does not contain an Override Lab backup.')
  }
  for (const key of Object.keys(payload.data)) {
    if (!key.startsWith(PREFIX)) throw new Error('That code contains data this app does not own.')
  }
  return { savedAt: payload.savedAt, data: payload.data, summary: backupSummary(payload.data) }
}

/** Replace this browser's personal data with the backup. */
export function applyBackup(data) {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(PREFIX)) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(PREFIX)) localStorage.setItem(key, value)
  }
}
