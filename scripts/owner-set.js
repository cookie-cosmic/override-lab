// Stores the platform owner's entry code in this server's database.
//
// Run:  npm run owner:set
//
// Why this exists: OWNER_ENTRY_CODE in the environment is the deployment path, but a preview
// server started from a shell never sees secrets stored in a hosting dashboard. This writes a
// scrypt hash into the local database instead, so owner entry works from the ordinary chapter
// access field on this machine. There is deliberately no HTTP endpoint for it: changing the
// owner requires shell access to the server.
//
// The entry code is read without echo, never printed, and never stored in plaintext.
import crypto from 'node:crypto'
import readline from 'node:readline'
import { loadEnv } from '../server/env.js'
import { ownerStatus, setOwnerCredential, totpAt } from '../server/access.js'

loadEnv()

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(buf) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

const isTty = Boolean(process.stdin.isTTY)
let rl = null
let pipedLines = null

/** Piped input is drained once: readline drops lines that arrive before a question is asked. */
async function readPiped() {
  if (pipedLines) return
  pipedLines = await new Promise((resolve) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (d) => {
      buf += d
    })
    process.stdin.on('end', () => resolve(buf.split(/\r?\n/)))
  })
}

/** Prints the question, reads one answer, and keeps it off the screen when it is hidden. */
async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question)
  if (!isTty) {
    await readPiped()
    const answer = String(pipedLines.shift() ?? '')
    process.stdout.write(hidden ? '\n' : `${answer}\n`)
    return answer.trim()
  }
  rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  rl._writeToOutput = hidden ? () => {} : (s) => process.stdout.write(s)
  const answer = await new Promise((resolve) => rl.question('', resolve))
  if (hidden) process.stdout.write('\n')
  return String(answer).trim()
}

async function main() {
  const before = ownerStatus()
  console.log('Override Lab — platform owner credential\n')

  if (before.source === 'environment') {
    console.log("OWNER_ENTRY_CODE is set in this server's environment and takes precedence over the")
    console.log('value stored here. Clear it first if the stored code should win.\n')
  } else if (before.configured) {
    console.log(`An owner credential is already stored (authenticator ${before.mfa ? 'on' : 'off'}). This replaces it.\n`)
  }

  const code = await ask('Owner entry code (at least 12 characters, not shown): ', { hidden: true })
  const again = await ask('Repeat the entry code: ', { hidden: true })
  if (code !== again) throw new Error('the two entries did not match — nothing was changed')
  if (code.length < 6) throw new Error('the entry code must be at least 6 characters — nothing was changed')
  if (code.length < 12) console.log('Note: codes under 12 characters rely on the sign-in rate limit as their main defence.')

  const answer = await ask('Authenticator secret (Enter to generate a new one): ', { hidden: true })
  const secret = answer || base32(crypto.randomBytes(20))

  const status = setOwnerCredential({ code, totpSecret: secret })
  const url = `otpauth://totp/${encodeURIComponent('Override Lab:owner')}?secret=${secret}&issuer=Override%20Lab&algorithm=SHA1&digits=6&period=30`

  console.log(`\nStored (source: ${status.source}, authenticator ${status.mfa ? 'on' : 'off'}). No restart is needed.`)
  console.log('Add this to your authenticator app now — the secret is not shown again:')
  console.log(`  ${url}`)
  console.log(`\nCurrent code for a first test: ${totpAt(secret)}`)
  console.log('\nEnter your entry code in the chapter access field on the homepage, then the')
  console.log('authenticator code when it asks.')
}

main()
  .then(() => {
    rl && rl.close()
  })
  .catch((error) => {
    console.error(`\n${error.message}`)
    rl && rl.close()
    process.exitCode = 1
  })
