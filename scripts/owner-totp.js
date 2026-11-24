// Generates the owner's TOTP secret and a current code.
//
// Run:  npm run owner:totp
//
// Put the secret in the server environment as OWNER_TOTP_SECRET (never in git, never in a
// frontend file), add it to an authenticator app with the printed otpauth:// URL, and set a
// separate OWNER_ENTRY_CODE. Losing the authenticator means regenerating the secret here.
import crypto from 'node:crypto'
import { totpAt } from '../server/access.js'

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

const secret = base32(crypto.randomBytes(20))
const label = encodeURIComponent('Override Lab:owner')
const url = `otpauth://totp/${label}?secret=${secret}&issuer=Override%20Lab&algorithm=SHA1&digits=6&period=30`

console.log('Owner authenticator secret (store as OWNER_TOTP_SECRET, then delete this output):')
console.log(secret)
console.log('\nAdd to an authenticator app:')
console.log(url)
console.log(`\nCurrent code: ${totpAt(secret)}`)
console.log('\nAlso set OWNER_ENTRY_CODE to a long random passphrase. The entry code only starts')
console.log('verification; the authenticator code is what issues an owner session.')
