// End-to-end security tests for the access hierarchy.
//
// Runs against a throwaway server and database, so it never touches the real archive or real
// credentials. Usage: npm run test:security
//
// The suite asserts the acceptance scenarios that can be proven without a browser: public
// isolation, chapter/team separation, cross-team access, revocation, rotation, suspension,
// owner MFA and owner-only routes.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { totpAt } from '../server/access.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4599
const BASE = `http://127.0.0.1:${PORT}`
const DATA = path.join(ROOT, '.tmp-security-test')

// Deterministic test fixtures, not real credentials. They exist only for this process.
const OWNER_ENTRY = 'test-owner-entry-code-not-a-real-secret'
const OWNER_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    VEX_DATA_DIR: DATA,
    OWNER_ENTRY_CODE: OWNER_ENTRY,
    OWNER_TOTP_SECRET: OWNER_TOTP,
    ROBOTEVENTS_TOKEN: '',
    KEEP_ALIVE_URL: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let logs = ''
child.stdout.on('data', (c) => {
  logs += c
})
child.stderr.on('data', (c) => {
  logs += c
})

const results = []
let failures = 0

async function check(name, fn) {
  try {
    await fn()
    results.push(`  PASS  ${name}`)
  } catch (error) {
    failures++
    results.push(`  FAIL  ${name}\n        ${error.message.replace(/\n/g, '\n        ')}`)
  }
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`server did not start\n${logs}`)
}

function client(token = null) {
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-ol-session': token } : {}),
        ...(extra.headers || {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* plain text */
    }
    return { status: res.status, body: json, text }
  }
  return {
    get: (url, extra) => call('GET', url, null, extra),
    post: (url, body, extra) => call('POST', url, body, extra),
    patch: (url, body, extra) => call('PATCH', url, body, extra),
    del: (url, extra) => call('DELETE', url, null, extra)
  }
}

const publicClient = client()

async function main() {
  await waitForServer()

  let ownerToken
  let chapterToken
  let chapterCode
  let chapterId
  let teamTokenA
  let pinA
  let teamTokenB
  let pinB
  let chapterPin

  await check('public session resolves as public with no features', async () => {
    const res = await publicClient.get('/api/access/me')
    assert.equal(res.status, 200)
    assert.equal(res.body.kind, 'public')
    assert.equal(res.body.owner, false)
    assert.deepEqual(res.body.features, [])
    assert.equal(res.body.ownerConfigured, true)
  })

  await check('public visitor cannot call a strategic endpoint directly', async () => {
    const res = await publicClient.get('/api/events/VE-V5-26-00001/opponent?team=75019D')
    assert.equal(res.status, 403)
    assert.equal(res.body.code, 'feature_locked')
  })

  await check('public visitor cannot read the team access list', async () => {
    const res = await publicClient.get('/api/access/teams')
    assert.equal(res.status, 403)
  })

  await check('public visitor cannot read the audit log', async () => {
    const res = await publicClient.get('/api/access/audit')
    assert.equal(res.status, 403)
  })

  await check('owner sign-in rejects a wrong entry code', async () => {
    const res = await publicClient.post('/api/access/owner/begin', { code: 'definitely-wrong' })
    assert.equal(res.status, 401)
    assert.match(res.body.error, /not recognised/i)
  })

  await check('owner entry code alone does not grant a session', async () => {
    const res = await publicClient.post('/api/access/owner/begin', { code: OWNER_ENTRY })
    assert.equal(res.status, 200)
    assert.ok(res.body.challenge)
    assert.equal(res.body.token, undefined, 'entry must not return a session token')
    chapterPin = res.body.challenge
  })

  await check('owner verification rejects a wrong authenticator code', async () => {
    const res = await publicClient.post('/api/access/owner/verify', { challenge: chapterPin, code: '000000' })
    assert.equal(res.status, 401)
  })

  await check('owner verification with the authenticator grants an owner session', async () => {
    const res = await publicClient.post('/api/access/owner/verify', {
      challenge: chapterPin,
      code: totpAt(OWNER_TOTP)
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.access.owner, true)
    ownerToken = res.body.token
  })

  const owner = client(ownerToken)

  await check('a challenge cannot be replayed after it was used', async () => {
    const res = await publicClient.post('/api/access/owner/verify', { challenge: chapterPin, code: totpAt(OWNER_TOTP) })
    assert.equal(res.status, 401)
  })

  await check('owner creates a chapter', async () => {
    const res = await owner.post('/api/access/chapters', { name: 'Test Chapter', adminEnabled: false })
    assert.equal(res.status, 200)
    chapterId = res.body.chapter.id
    assert.equal(res.body.chapter.teams.length, 0)
  })

  await check('owner issues a chapter code exactly once', async () => {
    const res = await owner.post(`/api/access/chapters/${chapterId}/code`, {})
    assert.equal(res.status, 200)
    chapterCode = res.body.code
    assert.match(chapterCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    const again = await owner.get(`/api/access/chapters/${chapterId}`)
    assert.equal(again.body.chapter.hasCode, true)
    assert.equal(JSON.stringify(again.body).includes(chapterCode), false, 'the plaintext code must not be readable later')
  })

  await check('owner assigns two teams and enables their workspaces', async () => {
    await owner.post(`/api/access/chapters/${chapterId}/teams`, { team: '75019D' })
    await owner.post(`/api/access/chapters/${chapterId}/teams`, { team: '1234A' })
    await owner.post('/api/access/teams/75019D/enable', { chapterId, preset: 'full' })
    const res = await owner.post('/api/access/teams/1234A/enable', { chapterId, features: ['scouting'] })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.team.features, ['scouting'])
  })

  await check('issuing a PIN returns it once and stores only a hash', async () => {
    const a = await owner.post('/api/access/teams/75019D/pin', {})
    pinA = a.body.pin
    assert.match(pinA, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    const b = await owner.post('/api/access/teams/1234A/pin', {})
    pinB = b.body.pin
    const list = await owner.get('/api/access/teams')
    const text = JSON.stringify(list.body)
    assert.equal(text.includes(pinA), false)
    assert.equal(text.includes(pinB), false)
    assert.equal(text.includes(OWNER_ENTRY), false)
  })

  await check('chapter login rejects a wrong code', async () => {
    const res = await publicClient.post('/api/access/chapter', { code: 'AAAA-BBBB-CCCC' })
    assert.equal(res.status, 401)
  })

  await check('chapter login accepts the issued code', async () => {
    const res = await publicClient.post('/api/access/chapter', { code: chapterCode })
    assert.equal(res.status, 200)
    assert.equal(res.body.kind, 'chapter')
    chapterToken = res.body.token
  })

  const chapter = client(chapterToken)

  await check('chapter dashboard lists its teams and never private material', async () => {
    const res = await chapter.get(`/api/access/chapters/${chapterId}`)
    assert.equal(res.status, 200)
    const numbers = res.body.teams.map((t) => t.team).sort()
    assert.deepEqual(numbers, ['1234A', '75019D'])
    assert.equal(res.body.canViewPrivate, false)
    assert.equal(JSON.stringify(res.body).includes(pinA), false)
    assert.equal(JSON.stringify(res.body).includes('features'), true)
  })

  await check('chapter session cannot reach owner administration', async () => {
    const res = await chapter.get('/api/access/chapters')
    assert.equal(res.status, 403)
    const teams = await chapter.get('/api/access/teams')
    assert.equal(teams.status, 403)
    const audit = await chapter.get('/api/access/audit')
    assert.equal(audit.status, 403)
  })

  await check('chapter session cannot open a private team workspace', async () => {
    const res = await chapter.get('/api/workspace/all')
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'team_required')
  })

  await check('chapter session cannot call a strategic endpoint', async () => {
    const res = await chapter.get('/api/events/VE-V5-26-00001/opponent?team=75019D')
    assert.equal(res.status, 403)
  })

  await check('team login rejects a wrong PIN', async () => {
    const res = await publicClient.post('/api/access/team', { team: '75019D', pin: 'ZZZZ-ZZZZ-ZZZZ' })
    assert.equal(res.status, 401)
  })

  await check('team login rejects another team’s PIN', async () => {
    const res = await publicClient.post('/api/access/team', { team: '75019D', pin: pinB })
    assert.equal(res.status, 401)
  })

  await check('team login accepts its own PIN', async () => {
    const res = await publicClient.post('/api/access/team', { team: '75019D', pin: pinA })
    assert.equal(res.status, 200)
    assert.equal(res.body.kind, 'team')
    assert.equal(res.body.team, '75019D')
    assert.ok(res.body.features.includes('counters'))
    teamTokenA = res.body.token
  })

  const teamA = client(teamTokenA)

  await check('a team session reaches an enabled strategic endpoint (not a permission error)', async () => {
    const res = await teamA.get('/api/events/VE-V5-26-00001/opponent?team=75019D')
    // The event does not exist in this throwaway archive; what matters is that authorization
    // passed and the request reached the handler.
    assert.notEqual(res.status, 403)
  })

  await check('a team session cannot use a disabled feature', async () => {
    const res = await publicClient.post('/api/access/team', { team: '1234A', pin: pinB })
    teamTokenB = res.body.token
    const teamB = client(teamTokenB)
    const blocked = await teamB.get('/api/events/VE-V5-26-00001/opponent?team=1234A')
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.feature, 'counters')
  })

  await check('team workspace write and read stay inside the session’s team', async () => {
    const created = await teamA.post('/api/workspace/tasks', { title: 'Charge batteries', priority: 'high' })
    assert.equal(created.status, 200)
    const id = created.body.record.id
    const listed = await teamA.get('/api/workspace/tasks')
    assert.equal(listed.body.records.length, 1)

    const teamB = client(teamTokenB)
    const foreign = await teamB.patch(`/api/workspace/tasks/${id}`, { title: 'hijacked' })
    assert.equal(foreign.status, 404, 'another team must not see the record at all')

    const stranger = await teamB.post('/api/workspace/tasks?team=75019D', { title: 'planted' })
    assert.equal(stranger.status, 403)
    assert.equal(stranger.body.code, 'team_mismatch')
  })

  await check('team workspace rejects an unknown collection', async () => {
    const res = await teamA.post('/api/workspace/secrets', { x: 1 })
    assert.equal(res.status, 404)
  })

  await check('owner can inspect any team workspace without a PIN', async () => {
    const res = await owner.get('/api/workspace/all?team=75019D')
    assert.equal(res.status, 200)
    assert.equal(res.body.team, '75019D')
    assert.equal(res.body.collections.tasks.length, 1)
  })

  await check('owner view requires an explicit team', async () => {
    const res = await owner.get('/api/workspace/all')
    assert.equal(res.status, 400)
  })

  await check('suspending a team blocks new logins', async () => {
    await owner.patch('/api/access/teams/1234A', { status: 'suspended' })
    const res = await publicClient.post('/api/access/team', { team: '1234A', pin: pinB })
    assert.equal(res.status, 403)
  })

  await check('rotating a PIN revokes existing sessions', async () => {
    const before = await teamA.get('/api/access/me')
    assert.equal(before.body.kind, 'team')
    const rotated = await owner.post('/api/access/teams/75019D/pin', {})
    pinA = rotated.body.pin
    const after = await teamA.get('/api/access/me')
    assert.equal(after.body.kind, 'public')
    assert.equal(after.body.reason, 'revoked')
  })

  await check('owner can revoke a device session by id', async () => {
    const sessions = await owner.get('/api/access/sessions')
    assert.ok(sessions.body.sessions.length > 0)
    const target = sessions.body.sessions.find((s) => s.kind === 'team')
    const res = await owner.del(`/api/access/sessions/${target.id}`)
    assert.equal(res.status, 200)
  })

  await check('the audit log records security events without secrets', async () => {
    const res = await owner.get('/api/access/audit?limit=200')
    const actions = res.body.entries.map((e) => e.action)
    assert.ok(actions.includes('access.owner.login'))
    assert.ok(actions.includes('access.chapter.login'))
    assert.ok(actions.includes('access.team.login'))
    assert.ok(actions.includes('team.pin.issued'))
    const text = JSON.stringify(res.body)
    assert.equal(text.includes(pinA), false)
    assert.equal(text.includes(chapterCode), false)
    assert.equal(text.includes(OWNER_ENTRY), false)
  })

  await check('repeated wrong chapter codes are rate limited', async () => {
    let sawLimit = false
    for (let i = 0; i < 12; i++) {
      const res = await publicClient.post('/api/access/chapter', { code: `WRON-GCOD-E${String(i).padStart(3, '0')}` })
      if (res.status === 429) {
        sawLimit = true
        break
      }
    }
    assert.ok(sawLimit, 'expected a 429 before unlimited guesses were allowed')
  })

  await check('deleting a chapter requires fresh owner verification', async () => {
    const res = await owner.del(`/api/access/chapters/${chapterId}`)
    assert.equal(res.status, 403)
    assert.equal(res.body.code, 'reauth_required')
  })

  await check('owner can delete a chapter with a current authenticator code', async () => {
    const res = await owner.del(`/api/access/chapters/${chapterId}`, { headers: { 'x-ol-totp': totpAt(OWNER_TOTP) } })
    assert.equal(res.status, 200)
  })

  await check('deleting a chapter invalidates its chapter sessions', async () => {
    const res = await chapter.get('/api/access/me')
    assert.equal(res.body.kind, 'public')
    // Deleting a chapter revokes its devices outright; either reason is a closed door.
    assert.ok(['revoked', 'chapter_inactive'].includes(res.body.reason), `unexpected reason ${res.body.reason}`)
  })

  await check('a deleted chapter’s teams can no longer sign in', async () => {
    const res = await publicClient.post('/api/access/team', { team: '75019D', pin: pinA })
    assert.equal(res.status, 403)
  })

  console.log('\nOverride Lab security tests\n')
  for (const line of results) console.log(line)
  console.log(`\n${results.length - failures}/${results.length} checks passed`)
  if (failures) console.log(`\nServer output:\n${logs}`)
}

main()
  .catch((error) => {
    console.error('\nTest harness failed:', error.message)
    console.error(logs)
    failures++
  })
  .finally(() => {
    child.kill('SIGTERM')
    setTimeout(() => process.exit(failures ? 1 : 0), 300)
  })
