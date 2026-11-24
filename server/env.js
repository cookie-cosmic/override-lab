// Minimal .env loader.
//
// Current-season data comes from the RobotEvents API and needs a token. Asking people to
// `export` it in a shell is how tokens end up pasted into chats or committed by accident, so
// the server reads a local .env instead (gitignored, never served, never logged).
//
// .env.local is read first so a machine-specific secret can override the shared file. Real
// environment variables (host secrets, `OWNER_ENTRY_CODE=... node server/index.js`) always win.
import { readFileSync } from 'node:fs'

function readInto(file, names) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
    if (!names.includes(m[1])) names.push(m[1])
  }
}

export function loadEnv(file = '.env') {
  const names = []
  if (file !== '.env.local') readInto('.env.local', names)
  readInto(file, names)
  return names
}
