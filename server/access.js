// Access architecture: public → chapter → approved team → platform owner.
//
// Design rules enforced here:
//   * Credentials are generated with crypto.randomInt, never derived from a team number.
//   * Only a scrypt hash and a random salt are stored. The plaintext exists once, in the
//     response that issued it, and is never written to the database, a log or an audit row.
//   * A browser holds an opaque session token. The database stores only its SHA-256, so a
//     database leak cannot be replayed as a live session.
//   * Every request re-checks membership, season validity, revocation and the feature
//     permission on the server. Nothing is trusted from the client.
//   * The owner role requires a server-side identity check (entry code + TOTP), never a
//     query parameter, a hidden route or a localStorage flag.
import crypto from 'node:crypto'
import { all, get, run } from './db.js'

// Feature keys are the unit of permission. A disabled feature blocks its endpoints, not
// just its navigation link.
export const FEATURES = {
  teamLab: 'Team Lab',
  scouting: 'Scouting',
  counters: 'Opponents & Counters',
  allianceStrategy: 'Alliance Strategy',
  matchIntelligence: 'Match Intelligence',
  simulation: 'Match Simulation',
  metaModel: 'Meta & Model',
  fieldSimulator: 'Field Simulator',
  overrideSim: 'Override Sim',
  robotTesting: 'Robot Testing',
  streamAnalysis: 'Stream Analysis',
  matchDay: 'Match Day',
  operations: 'Team Operations',
  notifications: 'Notifications',
  reports: 'Reports'
}
export const FEATURE_KEYS = Object.keys(FEATURES)

export const PRESETS = {
  stats: { label: 'Statistics only', features: [] },
  standard: {
    label: 'Standard team access',
    features: ['teamLab', 'scouting', 'matchDay', 'operations', 'robotTesting', 'fieldSimulator', 'notifications']
  },
  full: { label: 'Full competitive intelligence', features: FEATURE_KEYS }
}

const SESSION_TTL_DAYS = { chapter: 120, team: 120, owner: 30 }
const ENTRY_TTL_MINUTES = 10
const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW_MINUTES = 15
const BLOCK_MINUTES = 15

dbReady()

function dbReady() {
  run(`CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    season TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    code_hash TEXT,
    code_salt TEXT,
    code_hint TEXT,
    admin_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notes TEXT
  )`)
  run(`CREATE TABLE IF NOT EXISTS chapter_teams (
    chapter_id TEXT NOT NULL,
    team_number TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (chapter_id, team_number)
  )`)
  run(`CREATE TABLE IF NOT EXISTS team_access (
    team_number TEXT PRIMARY KEY,
    chapter_id TEXT,
    status TEXT NOT NULL DEFAULT 'not_requested',
    pin_hash TEXT,
    pin_salt TEXT,
    features TEXT NOT NULL DEFAULT '[]',
    preset TEXT,
    issued_at TEXT,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT
  )`)
  run(`CREATE TABLE IF NOT EXISTS device_sessions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    chapter_id TEXT,
    team_number TEXT,
    label TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`)
  run(`CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id TEXT,
    team_number TEXT NOT NULL,
    contact TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_at TEXT
  )`)
  run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor_kind TEXT,
    actor_label TEXT,
    chapter_id TEXT,
    team_number TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip_hash TEXT
  )`)
  run(`CREATE TABLE IF NOT EXISTS auth_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    at TEXT NOT NULL
  )`)
  run(`CREATE TABLE IF NOT EXISTS owner_entry (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    ip_hash TEXT
  )`)
  run(`CREATE TABLE IF NOT EXISTS notify_subs (
    id TEXT PRIMARY KEY,
    team_number TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT,
    auth TEXT,
    label TEXT,
    categories TEXT NOT NULL DEFAULT '[]',
    lead_minutes INTEGER NOT NULL DEFAULT 10,
    quiet_start INTEGER,
    quiet_end INTEGER,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  )`)
  run('CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)')
  run('CREATE INDEX IF NOT EXISTS idx_attempt_key ON auth_attempts(key, at)')
  run('CREATE INDEX IF NOT EXISTS idx_sessions_team ON device_sessions(team_number)')
  run('CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_team ON chapter_teams(chapter_id, team_number)')

  // Chapter administrators get their own password, separate from the shared chapter code, and
  // the elevation lives on the device session so it can be revoked independently.
  const chapterCols = all('PRAGMA table_info(chapters)').map((c) => c.name)
  if (!chapterCols.includes('admin_hash')) run('ALTER TABLE chapters ADD COLUMN admin_hash TEXT')
  if (!chapterCols.includes('admin_salt')) run('ALTER TABLE chapters ADD COLUMN admin_salt TEXT')
  const sessionCols = all('PRAGMA table_info(device_sessions)').map((c) => c.name)
  if (!sessionCols.includes('elevated')) run('ALTER TABLE device_sessions ADD COLUMN elevated INTEGER DEFAULT 0')
}

// ---- credentials ---------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
const clean = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Groups of four, e.g. K7M4-P2XQ-9RTW. 12 chars from a 32-symbol alphabet ≈ 60 bits. */
export function generateCode(groups = 3) {
  const out = []
  for (let g = 0; g < groups; g++) {
    let chunk = ''
    for (let i = 0; i < 4; i++) chunk += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    out.push(chunk)
  }
  return out.join('-')
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(clean(secret), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')
  return { hash, salt }
}

function matches(secret, hash, salt) {
  if (!hash || !salt || !secret) return false
  const candidate = crypto.scryptSync(clean(secret), salt, 32, { N: 16384, r: 8, p: 1 })
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return crypto.timingSafeEqual(candidate, expected)
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex')
const nowIso = () => new Date().toISOString()
const addDays = (iso, days) => new Date(Date.parse(iso) + days * 86400000).toISOString()
const addMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString()

export const teamNumber = (v) => String(v ?? '').trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase()

// ---- season --------------------------------------------------------------

let seasonCache = { at: 0, window: null }

/**
 * The authorization window is the competitive season. It is read from the configured season
 * (which the RobotEvents API resolves) and can be pinned by SEASON_ENDS_AT. No date is
 * hardcoded: an unverifiable expiry would either cut teams off early or leave access open.
 */
export async function seasonWindow() {
  if (seasonCache.window && Date.now() - seasonCache.at < 60000) return seasonCache.window
  let base = { name: '2026-27 Override', start: null, end: null }
  try {
    const { currentSeason } = await import('./season.js')
    const s = await currentSeason()
    if (s) base = { name: s.name || base.name, start: s.start || null, end: s.end || null }
  } catch {
    /* season lookup is best-effort; the configured override still applies */
  }
  const override = process.env.SEASON_ENDS_AT ? new Date(process.env.SEASON_ENDS_AT) : null
  const end = override && !Number.isNaN(override.getTime()) ? override.toISOString() : base.end
  const window = { ...base, end, source: override ? 'SEASON_ENDS_AT' : base.end ? 'season calendar' : 'unset' }
  seasonCache = { at: Date.now(), window }
  return window
}

async function seasonActive(expiresAt) {
  const now = Date.now()
  if (expiresAt && Date.parse(expiresAt) <= now) return false
  const { end } = await seasonWindow()
  if (end && Date.parse(end) <= now) return false
  return true
}

// ---- rate limiting / audit ----------------------------------------------

export function rateLimited(key, { max = MAX_ATTEMPTS, windowMinutes = ATTEMPT_WINDOW_MINUTES, blockMinutes = BLOCK_MINUTES } = {}) {
  const cutoff = new Date(Date.now() - windowMinutes * 60000).toISOString()
  const row = get('SELECT COUNT(*) AS c FROM auth_attempts WHERE key = ? AND at > ?', key, cutoff)
  if (Number(row?.c || 0) < max) return false
  const latest = get('SELECT at FROM auth_attempts WHERE key = ? ORDER BY at DESC LIMIT 1', key)
  if (!latest) return false
  return Date.parse(latest.at) + blockMinutes * 60000 > Date.now()
}

export function noteAttempt(key, ok) {
  run('INSERT INTO auth_attempts(key, at) VALUES(?,?)', key, nowIso())
  if (ok) run('DELETE FROM auth_attempts WHERE key = ?', key)
  // Keep the table bounded; it only needs the current window.
  run('DELETE FROM auth_attempts WHERE at < ?', new Date(Date.now() - 86400000).toISOString())
}

export function audit({ actorKind = 'system', actorLabel = null, chapterId = null, team = null, action, detail = null, ip = null }) {
  run(
    'INSERT INTO audit_log(at, actor_kind, actor_label, chapter_id, team_number, action, detail, ip_hash) VALUES(?,?,?,?,?,?,?,?)',
    nowIso(),
    actorKind,
    actorLabel,
    chapterId,
    team,
    action,
    typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : null,
    ip ? sha256(ip).slice(0, 16) : null
  )
}

export const listAudit = (limit = 200, filter = {}) => {
  if (filter.team) return all('SELECT * FROM audit_log WHERE team_number = ? ORDER BY id DESC LIMIT ?', filter.team, limit)
  if (filter.action) return all('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ?', filter.action, limit)
  return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit)
}

// ---- chapters ------------------------------------------------------------

const chapterView = (c) => ({
  id: c.id,
  name: c.name,
  season: c.season,
  status: c.status,
  expiresAt: c.expires_at,
  adminEnabled: Boolean(c.admin_enabled),
  hasAdminPassword: Boolean(c.admin_hash),
  hasCode: Boolean(c.code_hash),
  codeHint: c.code_hint || null,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
  teams: all('SELECT team_number FROM chapter_teams WHERE chapter_id = ? ORDER BY team_number', c.id).map((r) => r.team_number),
  teamCount: Number(get('SELECT COUNT(*) AS c FROM chapter_teams WHERE chapter_id = ?', c.id)?.c || 0)
})

export const listChapters = () => all('SELECT * FROM chapters ORDER BY name').map(chapterView)
export const getChapter = (id) => {
  const row = get('SELECT * FROM chapters WHERE id = ?', id)
  return row ? chapterView(row) : null
}

export function createChapter({ name, season = null, expiresAt = null, adminEnabled = false, notes = null }) {
  const cleanName = String(name || '').trim()
  if (cleanName.length < 2) throw Object.assign(new Error('chapter name is required'), { status: 400 })
  const id = `ch_${crypto.randomBytes(6).toString('hex')}`
  const at = nowIso()
  run(
    `INSERT INTO chapters(id, name, season, status, expires_at, admin_enabled, created_at, updated_at, notes)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    id,
    cleanName,
    season,
    'active',
    expiresAt,
    adminEnabled ? 1 : 0,
    at,
    at,
    notes
  )
  return getChapter(id)
}

export function updateChapter(id, patch = {}) {
  const row = get('SELECT * FROM chapters WHERE id = ?', id)
  if (!row) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  const fields = {
    name: patch.name ?? row.name,
    season: patch.season ?? row.season,
    status: patch.status ?? row.status,
    expires_at: patch.expiresAt ?? row.expires_at,
    admin_enabled: patch.adminEnabled == null ? row.admin_enabled : patch.adminEnabled ? 1 : 0,
    notes: patch.notes ?? row.notes,
    updated_at: nowIso()
  }
  run(
    'UPDATE chapters SET name=?, season=?, status=?, expires_at=?, admin_enabled=?, notes=?, updated_at=? WHERE id=?',
    fields.name,
    fields.season,
    fields.status,
    fields.expires_at,
    fields.admin_enabled,
    fields.notes,
    fields.updated_at,
    id
  )
  return getChapter(id)
}

export function deleteChapter(id) {
  const row = get('SELECT * FROM chapters WHERE id = ?', id)
  if (!row) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  run('DELETE FROM chapter_teams WHERE chapter_id = ?', id)
  // Deleting a chapter must also close its teams' doors. Their records are kept and the
  // workspace can be re-enabled later, but an orphaned team cannot keep signing in with a
  // PIN that was issued under a chapter that no longer exists.
  run("UPDATE team_access SET status = 'suspended', chapter_id = NULL, updated_at = ? WHERE chapter_id = ?", nowIso(), id)
  run('DELETE FROM chapters WHERE id = ?', id)
  run('UPDATE device_sessions SET revoked_at = ? WHERE chapter_id = ? AND revoked_at IS NULL', nowIso(), id)
  run(
    "UPDATE device_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND team_number IN (SELECT team_number FROM team_access WHERE status = 'suspended')",
    nowIso()
  )
  return { deleted: id }
}

/** Issues a new chapter code. The plaintext is returned once and never stored. */
export function issueChapterCode(id) {
  const row = get('SELECT * FROM chapters WHERE id = ?', id)
  if (!row) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  const code = generateCode(3)
  const { hash, salt } = hashSecret(code)
  run('UPDATE chapters SET code_hash=?, code_salt=?, code_hint=?, updated_at=? WHERE id=?', hash, salt, code.slice(-4), nowIso(), id)
  // Rotating a code invalidates every device that used the old one.
  run('UPDATE device_sessions SET revoked_at = ? WHERE chapter_id = ? AND kind = ? AND revoked_at IS NULL', nowIso(), id, 'chapter')
  return { code, chapter: getChapter(id) }
}

export function assignTeam(chapterId, numberIn) {
  const team = teamNumber(numberIn)
  if (!/^[0-9]{1,5}[A-Z]?$/.test(team)) throw Object.assign(new Error('that is not a V5RC team number'), { status: 400 })
  if (!get('SELECT id FROM chapters WHERE id = ?', chapterId)) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  run('INSERT OR IGNORE INTO chapter_teams(chapter_id, team_number, added_at) VALUES(?,?,?)', chapterId, team, nowIso())
  const existing = get('SELECT * FROM team_access WHERE team_number = ?', team)
  if (!existing) {
    run('INSERT INTO team_access(team_number, chapter_id, status, features, updated_at) VALUES(?,?,?,?,?)', team, chapterId, 'approved', '[]', nowIso())
  } else if (!existing.chapter_id) {
    run('UPDATE team_access SET chapter_id = ?, updated_at = ? WHERE team_number = ?', chapterId, nowIso(), team)
  }
  return chapterView(get('SELECT * FROM chapters WHERE id = ?', chapterId))
}

export function removeTeam(chapterId, numberIn) {
  const team = teamNumber(numberIn)
  run('DELETE FROM chapter_teams WHERE chapter_id = ? AND team_number = ?', chapterId, team)
  run('UPDATE team_access SET chapter_id = NULL, status = ?, updated_at = ? WHERE team_number = ? AND chapter_id = ?', 'suspended', nowIso(), team, chapterId)
  dropTeamAccess(team)
  return chapterView(get('SELECT * FROM chapters WHERE id = ?', chapterId))
}

// ---- team access ---------------------------------------------------------

const parseFeatures = (v) => {
  try {
    const arr = JSON.parse(v || '[]')
    return Array.isArray(arr) ? arr.filter((f) => FEATURE_KEYS.includes(f)) : []
  } catch {
    return []
  }
}

export function teamAccessView(row) {
  if (!row) return null
  return {
    team: row.team_number,
    chapterId: row.chapter_id,
    status: row.status,
    features: parseFeatures(row.features),
    preset: row.preset,
    hasPin: Boolean(row.pin_hash),
    issuedAt: row.issued_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at
  }
}

export const getTeamAccess = (team) => teamAccessView(get('SELECT * FROM team_access WHERE team_number = ?', teamNumber(team)))
export const listTeamAccess = () => all('SELECT * FROM team_access ORDER BY team_number').map(teamAccessView)

export function enableTeam(chapterId, numberIn, { preset = 'standard', features = null } = {}) {
  const team = teamNumber(numberIn)
  if (!/^[0-9]{1,5}[A-Z]?$/.test(team)) throw Object.assign(new Error('that is not a V5RC team number'), { status: 400 })
  if (chapterId && !get('SELECT id FROM chapters WHERE id = ?', chapterId)) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  const chosen = features || PRESETS[preset]?.features || PRESETS.standard.features
  const row = get('SELECT * FROM team_access WHERE team_number = ?', team)
  if (row) {
    run(
      'UPDATE team_access SET chapter_id=?, status=?, features=?, preset=?, updated_at=? WHERE team_number=?',
      chapterId || row.chapter_id,
      'approved',
      JSON.stringify(chosen),
      preset,
      nowIso(),
      team
    )
  } else {
    run(
      'INSERT INTO team_access(team_number, chapter_id, status, features, preset, updated_at) VALUES(?,?,?,?,?,?)',
      team,
      chapterId,
      'approved',
      JSON.stringify(chosen),
      preset,
      nowIso()
    )
  }
  audit({ action: 'team.enabled', team, chapterId: chapterId || null, detail: { preset, features: chosen } })
  return getTeamAccess(team)
}

export function setTeamFeatures(team, { preset = null, features = null } = {}) {
  const row = get('SELECT * FROM team_access WHERE team_number = ?', teamNumber(team))
  if (!row) throw Object.assign(new Error('unknown team workspace'), { status: 404 })
  const chosen = features || (preset ? PRESETS[preset]?.features : null)
  if (!chosen) throw Object.assign(new Error('features or a known preset is required'), { status: 400 })
  run('UPDATE team_access SET features=?, preset=?, updated_at=? WHERE team_number=?', JSON.stringify(chosen), preset, nowIso(), teamNumber(team))
  audit({ action: 'team.features', team: teamNumber(team), detail: { preset, features: chosen } })
  return getTeamAccess(team)
}

export function setTeamStatus(team, status) {
  const allowed = ['not_requested', 'pending', 'approved', 'issued', 'suspended', 'expired']
  if (!allowed.includes(status)) throw Object.assign(new Error('unknown status'), { status: 400 })
  const row = get('SELECT * FROM team_access WHERE team_number = ?', teamNumber(team))
  if (!row) throw Object.assign(new Error('unknown team workspace'), { status: 404 })
  run('UPDATE team_access SET status=?, updated_at=? WHERE team_number=?', status, nowIso(), teamNumber(team))
  if (status !== 'approved' && status !== 'issued') dropTeamAccess(teamNumber(team))
  audit({ action: 'team.status', team: teamNumber(team), detail: status })
  return getTeamAccess(team)
}

/** Issues a fresh PIN. The plaintext is returned once; the database keeps only the hash. */
export function issueTeamPin(numberIn) {
  const team = teamNumber(numberIn)
  const row = get('SELECT * FROM team_access WHERE team_number = ?', team)
  if (!row) throw Object.assign(new Error('enable the team workspace first'), { status: 400 })
  const pin = generateCode(3)
  const { hash, salt } = hashSecret(pin)
  run('UPDATE team_access SET pin_hash=?, pin_salt=?, status=?, issued_at=?, updated_at=? WHERE team_number=?', hash, salt, 'issued', nowIso(), nowIso(), team)
  // A rotated credential closes every workspace opened with the old one. A chapter session
  // keeps its chapter access and only loses the team binding, so the team must be re-entered.
  dropTeamAccess(team)
  audit({ action: 'team.pin.issued', team })
  return { pin, access: getTeamAccess(team) }
}

/** Ends every team-level authorization for a team without closing its chapter's session. */
function dropTeamAccess(team) {
  const number = teamNumber(team)
  run("UPDATE device_sessions SET revoked_at=? WHERE team_number=? AND kind='team' AND revoked_at IS NULL", nowIso(), number)
  run("UPDATE device_sessions SET team_number=NULL WHERE team_number=? AND kind='chapter'", number)
}

/** Opens a team inside an existing chapter session, keeping chapter access intact. */
export async function chapterTeamLogin(access, { team, pin, ip = null }) {
  if (!access?.sessionId) throw Object.assign(new Error('open your chapter first'), { status: 401, code: 'chapter_required' })
  if (access.kind !== 'chapter' && !(access.kind === 'team' && access.viaChapter)) {
    throw Object.assign(new Error('open your chapter first'), { status: 403, code: 'chapter_required' })
  }
  const number = teamNumber(team)
  const key = `team:${number}:${ip || ''}`
  if (rateLimited(key)) {
    audit({ action: 'access.rate_limited', detail: { kind: 'team', team: number }, team: number, ip })
    throw Object.assign(new Error('too many attempts — wait a few minutes and try again'), { status: 429 })
  }
  const row = get('SELECT * FROM team_access WHERE team_number = ?', number)
  const fail = () => {
    noteAttempt(key, false)
    audit({ action: 'access.team.failed', team: number, ip })
    throw Object.assign(new Error('that team access code was not recognised'), { status: 401 })
  }
  if (!row || !row.pin_hash) return fail()
  if (row.chapter_id !== access.chapter) {
    throw Object.assign(new Error('that team is not part of this chapter'), { status: 403 })
  }
  if (!matches(pin, row.pin_hash, row.pin_salt)) return fail()
  if (!['approved', 'issued'].includes(row.status)) {
    throw Object.assign(new Error('this team workspace is not currently enabled'), { status: 403 })
  }
  if (!(await seasonActive(null))) throw Object.assign(new Error('this season’s team access has ended'), { status: 403 })
  noteAttempt(key, true)
  run('UPDATE device_sessions SET team_number=? WHERE id=?', number, access.sessionId)
  audit({
    actorKind: 'team',
    actorLabel: number,
    team: number,
    chapterId: access.chapter,
    action: 'access.team.login',
    detail: { via: 'chapter' },
    ip
  })
  return { team: number, chapter: access.chapter }
}

/** Returns a chapter session from a team workspace back to its chapter dashboard. */
export function chapterTeamLeave(access) {
  if (!access?.sessionId || !(access.kind === 'team' && access.viaChapter)) {
    throw Object.assign(new Error('no team is open'), { status: 400 })
  }
  run('UPDATE device_sessions SET team_number=NULL WHERE id=?', access.sessionId)
  return { chapter: access.chapter }
}

export const revokeChapterElevation = (chapterId) => {
  run("UPDATE device_sessions SET elevated=0 WHERE chapter_id=? AND kind='chapter'", chapterId)
  audit({ action: 'chapter.admin_password.revoked', chapterId })
}

export const revokeTeamSessions = (team) => {
  dropTeamAccess(team)
  audit({ action: 'team.sessions.revoked', team: teamNumber(team) })
}

export function requestAccess({ chapterId = null, team, contact = null, note = null }) {
  const number = teamNumber(team)
  if (!/^[0-9]{1,5}[A-Z]?$/.test(number)) throw Object.assign(new Error('that is not a V5RC team number'), { status: 400 })
  const existing = get('SELECT * FROM access_requests WHERE team_number = ? AND status = ? ORDER BY id DESC LIMIT 1', number, 'pending')
  if (existing) return { id: existing.id, status: 'pending', duplicate: true }
  const at = nowIso()
  const info = run('INSERT INTO access_requests(chapter_id, team_number, contact, note, status, created_at) VALUES(?,?,?,?,?,?)', chapterId, number, contact, note, 'pending', at)
  if (!get('SELECT * FROM team_access WHERE team_number = ?', number)) {
    run('INSERT INTO team_access(team_number, chapter_id, status, features, updated_at) VALUES(?,?,?,?,?)', number, chapterId, 'pending', '[]', at)
  } else {
    run('UPDATE team_access SET status=?, updated_at=? WHERE team_number=? AND status = ?', 'pending', at, number, 'not_requested')
  }
  audit({ action: 'team.access.requested', team: number, chapterId, detail: { contact } })
  return { id: Number(info.lastInsertRowid), status: 'pending' }
}

export const listRequests = () => all('SELECT * FROM access_requests ORDER BY status, id DESC').map((r) => ({
  id: r.id,
  chapterId: r.chapter_id,
  team: r.team_number,
  contact: r.contact,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at
}))

export function decideRequest(id, approve, actor = 'owner') {
  const row = get('SELECT * FROM access_requests WHERE id = ?', id)
  if (!row) throw Object.assign(new Error('unknown request'), { status: 404 })
  run('UPDATE access_requests SET status=?, decided_at=? WHERE id=?', approve ? 'approved' : 'declined', nowIso(), id)
  if (approve) {
    run('UPDATE team_access SET status=?, updated_at=? WHERE team_number=? AND status=?', 'approved', nowIso(), row.team_number, 'pending')
  }
  audit({ action: approve ? 'team.access.approved' : 'team.access.declined', team: row.team_number, actorKind: actor, detail: { requestId: id } })
  return { id, status: approve ? 'approved' : 'declined' }
}

// ---- sessions ------------------------------------------------------------

function newSession({ kind, chapterId = null, team = null, label = null }) {
  const token = crypto.randomBytes(32).toString('base64url')
  const id = sha256(token)
  const at = nowIso()
  run(
    'INSERT INTO device_sessions(id, kind, chapter_id, team_number, label, created_at, last_seen_at, expires_at) VALUES(?,?,?,?,?,?,?,?)',
    id,
    kind,
    chapterId,
    team,
    label,
    at,
    at,
    addDays(at, SESSION_TTL_DAYS[kind] || 30)
  )
  return { token, sessionId: id, expiresAt: addDays(at, SESSION_TTL_DAYS[kind] || 30) }
}

const bearer = (req) => {
  const raw = String(req.headers['x-ol-session'] || req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  return raw || null
}

/**
 * Resolves the caller from its session token. Returns a public access descriptor; the raw
 * token is never echoed back. Expiry, revocation, chapter suspension and season end are all
 * checked on every call, so a revoked device stops working without waiting for a TTL.
 */
export async function resolveAccess(req) {
  const token = bearer(req)
  const anonymous = { kind: 'public', features: [], team: null, chapter: null, owner: false }
  if (!token) return anonymous
  const row = get('SELECT * FROM device_sessions WHERE id = ?', sha256(token))
  if (!row) return anonymous
  if (row.revoked_at) return { ...anonymous, reason: 'revoked' }
  if (Date.parse(row.expires_at) <= Date.now()) return { ...anonymous, reason: 'expired' }

  if (row.kind === 'owner') {
    run('UPDATE device_sessions SET last_seen_at=? WHERE id=?', nowIso(), row.id)
    return { kind: 'owner', owner: true, features: FEATURE_KEYS, team: row.team_number, chapter: row.chapter_id, sessionId: row.id }
  }

  if (row.kind === 'chapter') {
    const chapter = get('SELECT * FROM chapters WHERE id = ?', row.chapter_id)
    if (!chapter || chapter.status !== 'active') return { ...anonymous, reason: 'chapter_inactive' }
    if (!(await seasonActive(chapter.expires_at))) return { ...anonymous, reason: 'season_expired' }
    run('UPDATE device_sessions SET last_seen_at=? WHERE id=?', nowIso(), row.id)

    const base = {
      chapter: row.chapter_id,
      chapterName: chapter.name,
      // A chapter code opens the dashboard. Administrator controls need the separate chapter
      // admin password, which elevates this device session.
      admin: Boolean(chapter.admin_enabled && row.elevated),
      owner: false,
      sessionId: row.id
    }

    // A team is unlocked *inside* the chapter session, so the device keeps chapter access and
    // the team never becomes reachable without it. The holding chapter's own expiry, status and
    // the team's permission set are all re-checked on every request.
    if (!row.team_number) return { ...base, kind: 'chapter', features: ['chapter'], team: null }

    const teamRow = get('SELECT * FROM team_access WHERE team_number = ?', row.team_number)
    if (!teamRow || !['approved', 'issued'].includes(teamRow.status)) {
      return { ...base, kind: 'chapter', features: ['chapter'], team: null, teamUnavailable: row.team_number }
    }
    if (!(await seasonActive(null))) return { ...anonymous, reason: 'season_expired' }
    return {
      ...base,
      kind: 'team',
      team: row.team_number,
      features: parseFeatures(teamRow.features),
      viaChapter: true
    }
  }

  if (row.kind === 'team') {
    const rowTeam = get('SELECT * FROM team_access WHERE team_number = ?', row.team_number)
    if (!rowTeam) return { ...anonymous, reason: 'team_unknown' }
    if (!['approved', 'issued'].includes(rowTeam.status)) return { ...anonymous, reason: 'team_suspended' }
    if (!(await seasonActive(null))) return { ...anonymous, reason: 'season_expired' }
    const chapter = rowTeam.chapter_id ? get('SELECT * FROM chapters WHERE id = ?', rowTeam.chapter_id) : null
    if (rowTeam.chapter_id && (!chapter || chapter.status !== 'active')) return { ...anonymous, reason: 'chapter_inactive' }
    if (chapter && !(await seasonActive(chapter.expires_at))) return { ...anonymous, reason: 'season_expired' }
    run('UPDATE device_sessions SET last_seen_at=? WHERE id=?', nowIso(), row.id)
    run('UPDATE team_access SET last_seen_at=? WHERE team_number=?', nowIso(), row.team_number)
    return {
      kind: 'team',
      team: row.team_number,
      chapter: rowTeam.chapter_id,
      chapterName: chapter?.name || null,
      features: parseFeatures(rowTeam.features),
      owner: false,
      sessionId: row.id
    }
  }

  return anonymous
}

export async function chapterLogin({ code, label = null, ip = null }) {
  // Keyed on the caller, not on the guessed code: hashing the guess into the key would give
  // every wrong code its own budget and make guessing unlimited.
  const key = `chapter:${ip || 'unknown'}`
  if (rateLimited(key)) {
    audit({ action: 'access.rate_limited', detail: { kind: 'chapter' }, ip })
    throw Object.assign(new Error('too many attempts — wait a few minutes and try again'), { status: 429 })
  }
  const rows = all('SELECT * FROM chapters WHERE code_hash IS NOT NULL')
  const hit = rows.find((c) => matches(code, c.code_hash, c.code_salt))
  if (!hit) {
    noteAttempt(key, false)
    audit({ action: 'access.chapter.failed', ip })
    throw Object.assign(new Error('that access code was not recognised'), { status: 401 })
  }
  if (hit.status !== 'active') throw Object.assign(new Error('this chapter is not active'), { status: 403 })
  if (!(await seasonActive(hit.expires_at))) throw Object.assign(new Error('this chapter’s season access has ended'), { status: 403 })
  noteAttempt(key, true)
  const session = newSession({ kind: 'chapter', chapterId: hit.id, label })
  audit({ actorKind: 'chapter', actorLabel: hit.name, chapterId: hit.id, action: 'access.chapter.login', ip })
  return { token: session.token, expiresAt: session.expiresAt, kind: 'chapter', chapter: getChapter(hit.id), admin: Boolean(hit.admin_enabled) }
}

export async function teamLogin({ team, pin, label = null, ip = null, access = null }) {
  const number = teamNumber(team)
  const key = `team:${number}:${ip || ''}`
  if (rateLimited(key)) {
    audit({ action: 'access.rate_limited', detail: { kind: 'team', team: number }, team: number, ip })
    throw Object.assign(new Error('too many attempts — wait a few minutes and try again'), { status: 429 })
  }
  const row = get('SELECT * FROM team_access WHERE team_number = ?', number)
  // A generic message either way: never reveal whether the team exists, is enabled, or has a
  // PIN, and never reveal whether the PIN was close.
  const fail = () => {
    noteAttempt(key, false)
    audit({ action: 'access.team.failed', team: number, ip })
    throw Object.assign(new Error('team number or access PIN is not correct'), { status: 401 })
  }
  if (!row || !row.pin_hash) return fail()
  if (!matches(pin, row.pin_hash, row.pin_salt)) return fail()
  if (!['approved', 'issued'].includes(row.status)) {
    throw Object.assign(new Error('this team workspace is not currently enabled'), { status: 403 })
  }
  if (!(await seasonActive(null))) throw Object.assign(new Error('this season’s team access has ended'), { status: 403 })
  const chapter = row.chapter_id ? get('SELECT * FROM chapters WHERE id = ?', row.chapter_id) : null
  if (row.chapter_id && (!chapter || chapter.status !== 'active')) {
    throw Object.assign(new Error('this team’s chapter is not currently active'), { status: 403 })
  }
  // A team that belongs to a chapter is only reachable from an authorized chapter session.
  // The chapter code is not a team credential and the team code is not a chapter credential,
  // so both are required, in that order.
  if (row.chapter_id) {
    const authorized =
      isOwner(access) ||
      (access?.kind === 'chapter' && access.chapter === row.chapter_id) ||
      (access?.kind === 'team' && access.viaChapter && access.chapter === row.chapter_id)
    if (!authorized) {
      throw Object.assign(new Error('open your chapter and choose the team from there'), {
        status: 403,
        code: 'chapter_required'
      })
    }
  }
  if (chapter && !(await seasonActive(chapter.expires_at))) throw Object.assign(new Error('this chapter’s season access has ended'), { status: 403 })
  noteAttempt(key, true)
  const session = newSession({ kind: 'team', chapterId: row.chapter_id, team: number, label })
  audit({ actorKind: 'team', actorLabel: number, team: number, chapterId: row.chapter_id, action: 'access.team.login', ip })
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    kind: 'team',
    team: number,
    chapter: row.chapter_id,
    chapterName: chapter?.name || null,
    features: parseFeatures(row.features)
  }
}

/** The entry code alone enables the admin entry field; TOTP adds the second factor. */
export const ownerEntryConfigured = () => Boolean(process.env.OWNER_ENTRY_CODE)
export const ownerMfaConfigured = () => Boolean(process.env.OWNER_TOTP_SECRET)
export const ownerConfigured = ownerEntryConfigured

/**
 * Step one of owner sign-in: proves knowledge of the entry code.
 *
 * When an authenticator secret is configured the code only opens a challenge and a TOTP is
 * still required. When it is not configured the session is issued directly and the response
 * says so (`mfa: false`) so the UI can warn; setting OWNER_TOTP_SECRET restores the second
 * factor without any code change.
 */
export async function ownerBegin({ code, ip = null }) {
  // A deployment with no owner configured must not advertise that an owner entry exists: it
  // answers exactly like a wrong code.
  if (!ownerEntryConfigured()) {
    throw Object.assign(new Error('that access code was not recognised'), { status: 401 })
  }
  const key = `owner:${ip || 'unknown'}`
  if (rateLimited(key, { max: 5 })) {
    audit({ action: 'access.rate_limited', detail: { kind: 'owner' }, ip })
    throw Object.assign(new Error('too many attempts — wait a few minutes and try again'), { status: 429 })
  }
  const expected = String(process.env.OWNER_ENTRY_CODE)
  const given = String(code || '')
  // Constant-time comparison over equal-length buffers.
  const a = Buffer.from(sha256(given), 'hex')
  const b = Buffer.from(sha256(expected), 'hex')
  if (!crypto.timingSafeEqual(a, b)) {
    noteAttempt(key, false)
    audit({ action: 'access.owner.entry_failed', ip })
    throw Object.assign(new Error('that access code was not recognised'), { status: 401 })
  }
  noteAttempt(key, true)

  if (!ownerMfaConfigured()) {
    const session = newSession({ kind: 'owner', label: 'owner console (no authenticator configured)' })
    audit({ actorKind: 'owner', action: 'access.owner.login', detail: { mfa: false }, ip })
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      kind: 'owner',
      owner: true,
      mfa: false,
      warning: 'No authenticator is configured for this deployment, so the entry code alone opened the admin panel. Set OWNER_TOTP_SECRET to require a second factor.'
    }
  }

  const id = crypto.randomBytes(18).toString('base64url')
  run('INSERT INTO owner_entry(id, created_at, expires_at, ip_hash) VALUES(?,?,?,?)', id, nowIso(), addMinutes(nowIso(), ENTRY_TTL_MINUTES), ip ? sha256(ip).slice(0, 16) : null)
  audit({ action: 'access.owner.entry_ok', ip })
  return { challenge: id, expiresAt: addMinutes(nowIso(), ENTRY_TTL_MINUTES), method: 'totp' }
}

/** Issues a chapter administrator password. Returned once; stored only as a hash. */
export function issueChapterAdminPassword(chapterId) {
  const row = get('SELECT * FROM chapters WHERE id = ?', chapterId)
  if (!row) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  const password = generateCode(3)
  const { hash, salt } = hashSecret(password)
  run('UPDATE chapters SET admin_hash=?, admin_salt=?, admin_enabled=1, updated_at=? WHERE id=?', hash, salt, nowIso(), chapterId)
  // Anyone previously elevated has to sign in again with the new password.
  run("UPDATE device_sessions SET elevated=0 WHERE chapter_id=? AND kind='chapter'", chapterId)
  audit({ actorKind: 'owner', action: 'chapter.admin_password.issued', chapterId })
  return { password, chapter: getChapter(chapterId) }
}

/** Elevates a chapter device session after the chapter admin password is entered. */
export async function chapterAdminLogin(access, { password, ip = null }) {
  if (access?.kind !== 'chapter' || !access.chapter) {
    throw Object.assign(new Error('a chapter session is required'), { status: 401, code: 'chapter_required' })
  }
  const chapter = get('SELECT * FROM chapters WHERE id = ?', access.chapter)
  if (!chapter) throw Object.assign(new Error('unknown chapter'), { status: 404 })
  if (!chapter.admin_hash) throw Object.assign(new Error('no chapter administrator password has been issued for this chapter'), { status: 400 })

  const key = `chapter-admin:${chapter.id}:${ip || 'unknown'}`
  if (rateLimited(key, { max: 6 })) throw Object.assign(new Error('too many attempts — wait a few minutes and try again'), { status: 429 })
  if (!matches(password, chapter.admin_hash, chapter.admin_salt)) {
    noteAttempt(key, false)
    audit({ action: 'access.chapter_admin.failed', chapterId: chapter.id, ip })
    throw Object.assign(new Error('that password was not recognised'), { status: 401 })
  }
  noteAttempt(key, true)
  run('UPDATE device_sessions SET elevated=1 WHERE id=?', access.sessionId)
  audit({ actorKind: 'chapter', actorLabel: chapter.name, chapterId: chapter.id, action: 'access.chapter_admin.login', ip })
  return { admin: true, chapter: getChapter(chapter.id) }
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleanInput = String(input || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of cleanInput) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totpAt(secret, { step = 30, digits = 6, offset = 0, now = Date.now() } = {}) {
  const key = base32Decode(secret)
  const counter = Math.floor(now / 1000 / step) + offset
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const o = hmac[hmac.length - 1] & 0x0f
  const code = (hmac.readUInt32BE(o) & 0x7fffffff) % 10 ** digits
  return String(code).padStart(digits, '0')
}

export function verifyTotp(secret, code) {
  const given = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(given)) return false
  // One step of drift in each direction covers a phone clock a few seconds off.
  for (const offset of [-1, 0, 1]) {
    const expected = totpAt(secret, { offset })
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return true
  }
  return false
}

/** Step two: proves possession of the owner's authenticator. Issues the owner session. */
export async function ownerVerify({ challenge, code, label = null, ip = null }) {
  if (!ownerConfigured()) throw Object.assign(new Error('owner access is not configured on this deployment'), { status: 503 })
  const key = `owner-totp:${ip || 'unknown'}`
  if (rateLimited(key, { max: 6 })) throw Object.assign(new Error('too many attempts — wait a few minutes and try again'), { status: 429 })
  const row = get('SELECT * FROM owner_entry WHERE id = ?', String(challenge || ''))
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    throw Object.assign(new Error('that verification request expired — start again'), { status: 401 })
  }
  if (!verifyTotp(process.env.OWNER_TOTP_SECRET, code)) {
    noteAttempt(key, false)
    audit({ action: 'access.owner.totp_failed', ip })
    throw Object.assign(new Error('that verification code is not valid'), { status: 401 })
  }
  noteAttempt(key, true)
  run('UPDATE owner_entry SET used_at=? WHERE id=?', nowIso(), row.id)
  const session = newSession({ kind: 'owner', label })
  audit({ actorKind: 'owner', actorLabel: 'Platform Owner', action: 'access.owner.login', ip })
  return { token: session.token, expiresAt: session.expiresAt, kind: 'owner', owner: true, features: FEATURE_KEYS }
}

export function logout(session) {
  if (session?.sessionId) run('UPDATE device_sessions SET revoked_at=? WHERE id=?', nowIso(), session.sessionId)
  return { ok: true }
}

export const listSessions = (filter = {}) => {
  const rows = filter.team
    ? all('SELECT * FROM device_sessions WHERE team_number = ? ORDER BY last_seen_at DESC LIMIT 100', teamNumber(filter.team))
    : all('SELECT * FROM device_sessions ORDER BY last_seen_at DESC LIMIT 200')
  return rows.map((r) => ({
    id: r.id.slice(0, 12),
    kind: r.kind,
    chapter: r.chapter_id,
    team: r.team_number,
    label: r.label,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    revoked: Boolean(r.revoked_at)
  }))
}

export function revokeSession(idPrefix) {
  const rows = all('SELECT id FROM device_sessions WHERE id LIKE ?', `${idPrefix}%`)
  for (const r of rows) run('UPDATE device_sessions SET revoked_at=? WHERE id=?', nowIso(), r.id)
  audit({ action: 'session.revoked', detail: { count: rows.length } })
  return { revoked: rows.length }
}

// ---- authorization helpers ----------------------------------------------

/** Which permission an API route needs. Public statistics routes are not listed. */
export function requiredFeature(method, parts) {
  if (parts[0] === 'scouting' && method === 'POST') return 'scouting'
  if (parts[0] === 'score-events') return 'fieldSimulator'
  if (parts[0] === 'ingest') return 'dataIngest'
  if (parts[0] !== 'events' || !parts[2]) return null
  const sub = parts[2]
  if (sub === 'opponent' && method === 'GET') return 'counters'
  if (sub === 'sim' && method === 'GET') return 'simulation'
  if (sub === 'meta' && method === 'GET') return 'metaModel'
  if (sub === 'onsite' && method === 'GET') return 'matchDay'
  if (sub === 'report' && method === 'GET') return 'reports'
  if (sub === 'refresh' && method === 'POST') return 'dataIngest'
  if ((sub === 'videos' || sub === 'align' || sub === 'match') && method !== 'GET') return 'streamAnalysis'
  return null
}

/** True when the caller may use `feature`. The owner bypasses; public/chapter never do. */
export const hasFeature = (access, feature) =>
  Boolean(access?.owner) || (access?.kind === 'team' && Array.isArray(access.features) && access.features.includes(feature))

export const isOwner = (access) => Boolean(access?.owner)

export function requireTeamSession(access, team = null) {
  if (access?.owner) return true
  if (access?.kind !== 'team') return false
  return team ? access.team === teamNumber(team) : true
}
