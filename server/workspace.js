// Private team workspace: tasks, batteries, skills attempts, checklists, schedule, judging
// preparation and notification subscriptions.
//
// Every row is keyed by the team number taken from the *session*, never from the request body.
// A caller cannot read or write another team's records by changing an id, a team number or a
// URL segment: the queries themselves are scoped.
import crypto from 'node:crypto'
import { all, get, run, getMatches, getEvent } from './db.js'
import { teamNumber } from './access.js'

run(`CREATE TABLE IF NOT EXISTS ws_records (
  id TEXT PRIMARY KEY,
  team_number TEXT NOT NULL,
  collection TEXT NOT NULL,
  event_sku TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
)`)
run('CREATE INDEX IF NOT EXISTS idx_ws_team ON ws_records(team_number, collection, deleted_at)')
run('CREATE INDEX IF NOT EXISTS idx_ws_event ON ws_records(team_number, event_sku)')

export const COLLECTIONS = ['tasks', 'batteries', 'skills', 'checklists', 'schedule', 'judging']

const nowIso = () => new Date().toISOString()
const id = () => `r_${crypto.randomBytes(9).toString('hex')}`

const list = (team, collection, { event = null, includeDeleted = false } = {}) => {
  const clauses = ['team_number = ?', 'collection = ?']
  const params = [teamNumber(team), collection]
  if (!includeDeleted) clauses.push('deleted_at IS NULL')
  if (event) {
    clauses.push('event_sku = ?')
    params.push(event)
  }
  return all(`SELECT * FROM ws_records WHERE ${clauses.join(' AND ')} ORDER BY created_at`, ...params).map((r) => ({
    id: r.id,
    eventSku: r.event_sku,
    ...JSON.parse(r.data || '{}'),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}

const own = (team, recordId) => {
  const row = get('SELECT * FROM ws_records WHERE id = ? AND team_number = ?', recordId, teamNumber(team))
  return row || null
}

export function create(team, collection, { eventSku = null, ...data }) {
  if (!COLLECTIONS.includes(collection)) throw Object.assign(new Error('unknown collection'), { status: 404 })
  const recordId = id()
  const at = nowIso()
  run(
    'INSERT INTO ws_records(id, team_number, collection, event_sku, data, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    recordId,
    teamNumber(team),
    collection,
    eventSku || null,
    JSON.stringify(data),
    at,
    at
  )
  return { id: recordId, ...data, eventSku, createdAt: at, updatedAt: at }
}

export function update(team, collection, recordId, patch = {}) {
  const row = own(team, recordId)
  if (!row || row.collection !== collection) throw Object.assign(new Error('record not found'), { status: 404 })
  const merged = { ...JSON.parse(row.data || '{}'), ...patch }
  const at = nowIso()
  run('UPDATE ws_records SET data = ?, updated_at = ? WHERE id = ? AND team_number = ?', JSON.stringify(merged), at, recordId, teamNumber(team))
  return { id: recordId, ...merged, eventSku: row.event_sku, createdAt: row.created_at, updatedAt: at }
}

/** Soft delete keeps a recoverable history, as the access rules require. */
export function remove(team, collection, recordId) {
  const row = own(team, recordId)
  if (!row || row.collection !== collection) throw Object.assign(new Error('record not found'), { status: 404 })
  run('UPDATE ws_records SET deleted_at = ?, updated_at = ? WHERE id = ? AND team_number = ?', nowIso(), nowIso(), recordId, teamNumber(team))
  return { id: recordId, deleted: true, recoverable: true }
}

export function restore(team, collection, recordId) {
  const row = own(team, recordId)
  if (!row || row.collection !== collection) throw Object.assign(new Error('record not found'), { status: 404 })
  run('UPDATE ws_records SET deleted_at = NULL, updated_at = ? WHERE id = ? AND team_number = ?', nowIso(), recordId, teamNumber(team))
  return { id: recordId, restored: true }
}

export function bundle(team, event = null) {
  const out = {}
  for (const collection of COLLECTIONS) out[collection] = list(team, collection, { event })
  return { team: teamNumber(team), event: event || null, collections: out }
}

// ---- schedule intelligence ----------------------------------------------

const DEFAULT_MATCH_MINUTES = 6
const PREP_BUFFER_MINUTES = 10

const parseTime = (v) => {
  const t = Date.parse(v || '')
  return Number.isNaN(t) ? null : t
}

/** The active team's unscored qualification matches, in schedule order. */
function nextMatches(sku, team) {
  const rows = getMatches(sku).filter(
    (m) => m.round === 2 && [m.red1, m.red2, m.red3, m.blue1, m.blue2, m.blue3].includes(team)
  )
  const pending = rows.filter((m) => !m.scored).sort((a, b) => (Number(a.matchnum) || 0) - (Number(b.matchnum) || 0))
  const played = rows.filter((m) => m.scored).sort((a, b) => (Number(b.matchnum) || 0) - (Number(a.matchnum) || 0))
  return { pending, played, all: rows }
}

/**
 * Estimate the next match. Honest by construction: official RobotEvents exposes a schedule and
 * published results, not a live field clock. When results are published we can measure how far
 * behind the printed schedule the event is running; otherwise we can only project from the
 * queue depth, and the confidence says so.
 */
export function scheduleInsight(team, sku) {
  const number = teamNumber(team)
  const event = sku ? getEvent(sku) : null
  if (!sku || !event) return { sku: sku || null, available: false, reason: 'no tournament selected' }
  const { pending, played, all } = nextMatches(sku, number)
  const next = pending[0] || null
  if (!next) {
    return {
      sku,
      team: number,
      available: false,
      reason: all.length ? 'no scheduled matches remaining' : 'this team has no matches at this event',
      matches: all.length,
      played: played.length
    }
  }

  const scheduled = parseTime(next.scheduled)
  // Average spacing between consecutive matches on the printed schedule.
  const times = all.map((m) => parseTime(m.scheduled)).filter(Boolean).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 60000
    if (gap > 0 && gap < 30) gaps.push(gap)
  }
  const perMatch = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : DEFAULT_MATCH_MINUTES
  const fields = new Set(all.map((m) => m.field).filter(Boolean)).size || 1

  // How far the printed schedule has slipped: compare the scheduled time of the most recently
  // completed match with now. Only meaningful when results are actually published.
  const lastPlayed = played
    .map((m) => ({ m, t: parseTime(m.scheduled) }))
    .filter((x) => x.t)
    .sort((a, b) => b.t - a.t)[0]
  let delayMinutes = 0
  let delayBasis = 'not measurable — no published result timestamps'
  if (lastPlayed) {
    const lag = (Date.now() - lastPlayed.t) / 60000
    // A completed match whose scheduled start is in the past means the event is at least that
    // far along; a negative lag means it is running early.
    delayMinutes = Math.round(Math.min(Math.max(lag, -30), 180))
    delayBasis = `last completed match was scheduled ${lastPlayed.m.scheduled}`
  }

  // Matches still to be played before ours, shared across the fields in use.
  const ahead = all.filter((m) => !m.scored && (Number(m.matchnum) || 0) < (Number(next.matchnum) || 0)).length
  const queueMinutes = Math.round((ahead / fields) * Math.min(perMatch, 12))

  const projected = (scheduled || Date.now()) + queueMinutes * 60000 + (scheduled ? 0 : delayMinutes * 60000)
  const confidence = scheduled ? (played.length ? 'medium' : 'low') : 'low'

  return {
    sku,
    team: number,
    available: true,
    match: {
      key: next.match_key,
      number: next.matchnum,
      round: next.round,
      field: next.field,
      scheduled: next.scheduled,
      alliance: [next.red1, next.red2, next.red3].includes(number) ? 'red' : 'blue',
      partners: ([next.red1, next.red2, next.red3].includes(number) ? [next.red1, next.red2, next.red3] : [next.blue1, next.blue2, next.blue3]).filter(
        (t) => t && t !== number
      ),
      opponents: ([next.red1, next.red2, next.red3].includes(number) ? [next.blue1, next.blue2, next.blue3] : [next.red1, next.red2, next.red3]).filter(Boolean)
    },
    projectedStart: new Date(projected).toISOString(),
    scheduledStart: next.scheduled || null,
    minutesUntil: Math.max(0, Math.round((projected - Date.now()) / 60000)),
    prepDeadline: new Date(projected - PREP_BUFFER_MINUTES * 60000).toISOString(),
    delayMinutes,
    queueAhead: ahead,
    fields,
    averageGapMinutes: Math.round(perMatch * 10) / 10,
    confidence,
    basis: {
      scheduled: Boolean(next.scheduled),
      playedResults: played.length,
      delay: delayBasis,
      note: 'Estimated from the published schedule and results already posted. It is not a live field clock.'
    },
    pendingMatches: pending.length
  }
}

/** Conflicts between team activities and official matches or other fixed appointments. */
export function scheduleConflicts(team, sku) {
  const number = teamNumber(team)
  const items = list(number, 'schedule', { event: sku || null })
  const official = sku
    ? getMatches(sku)
        .filter((m) => [m.red1, m.red2, m.red3, m.blue1, m.blue2, m.blue3].includes(number))
        .map((m) => ({
          id: `match:${m.match_key}`,
          title: `Match ${m.matchnum} (${m.round === 2 ? 'qualification' : 'elimination'})`,
          start: parseTime(m.scheduled),
          duration: DEFAULT_MATCH_MINUTES,
          official: true,
          scored: Boolean(m.scored)
        }))
        .filter((m) => m.start)
    : []

  const blocks = [
    ...official.map((m) => ({ ...m, startMs: m.start, endMs: m.start + m.duration * 60000 })),
    ...items
      .filter((i) => i.startAt && !i.doneAt)
      .map((i) => {
        const startMs = parseTime(i.startAt)
        const duration = Number(i.durationMin) || 15
        return { id: i.id, title: i.title, kind: i.kind, fixed: Boolean(i.fixed), startMs, endMs: startMs + duration * 60000 }
      })
      .filter((i) => i.startMs)
  ].sort((a, b) => a.startMs - b.startMs)

  const conflicts = []
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]
      const b = blocks[j]
      if (b.startMs >= a.endMs) break
      // Two official matches can legitimately overlap on different fields; only flag a team
      // activity against something else, or two fixed appointments.
      if (a.official && b.official) continue
      conflicts.push({
        a: { id: a.id, title: a.title, start: new Date(a.startMs).toISOString(), official: Boolean(a.official) },
        b: { id: b.id, title: b.title, start: new Date(b.startMs).toISOString(), fixed: Boolean(b.fixed) },
        suggestion: b.official || a.official ? 'This overlaps an official match — move the team activity.' : 'These two appointments overlap.'
      })
    }
  }

  // Suggested gaps: free windows of at least `need` minutes before the next official match.
  const need = 20
  const proposals = []
  for (const match of official.filter((m) => !m.scored)) {
    const from = match.startMs - 75 * 60000
    const to = match.startMs - 20 * 60000
    const busy = blocks.filter((b) => !b.official && b.startMs < to && b.endMs > from)
    if (!busy.length && to > Date.now()) {
      proposals.push({
        around: `Match ${match.title.replace(/^Match /, '')}`,
        start: new Date(Math.max(from, Date.now())).toISOString(),
        end: new Date(to).toISOString(),
        minutes: Math.round((to - Math.max(from, Date.now())) / 60000)
      })
    }
  }

  return { team: number, sku: sku || null, conflicts, proposals: proposals.slice(0, 4), items: blocks.filter((b) => !b.official).length, official: official.length, need }
}
