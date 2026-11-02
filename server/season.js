// Season gate.
//
// This build reviews the season being played *right now* and nothing else: older events are
// rejected instead of silently analysed, and events that have not happened yet are listed as
// schedule context but cannot be ingested. The season itself comes from the events API so the
// game name ("Override" for 2026-27) is never hardcoded and stale.
import { RobotEvents, robotEventsToken } from './ingest/robotevents.js'

const CACHE_MS = 6 * 60 * 60 * 1000
let cache = { at: 0, season: null }

/** VEX seasons turn over in the spring, so this fallback window is always the live one. */
export function derivedSeason(now = new Date()) {
  const y = now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return {
    id: null,
    name: `${y}-${String(y + 1).slice(2)} season`,
    start: `${y}-05-01`,
    end: `${y + 1}-04-30`,
    source: 'derived from today'
  }
}

export async function currentSeason({ refresh = false } = {}) {
  // The token has exactly one source: ROBOTEVENTS_TOKEN, loaded from .env by server/env.js.
  const token = robotEventsToken()
  if (!token) return cache.season || derivedSeason()
  if (!refresh && cache.season && Date.now() - cache.at < CACHE_MS) return cache.season
  try {
    const client = new RobotEvents(token)
    // Two facts about this payload, both learned the hard way: `program[]` takes numeric ids
    // (a code answers 422), and seasons carry no `current` flag. So V5 is matched by program
    // code and the live season is the latest one that has already started.
    const json = await client.get('/seasons', { per_page: 250 })
    const codes = new Set(['V5RC', 'VRC'])
    const list = (json.data || []).filter((s) => codes.has(String(s.program?.code || '').toUpperCase()))
    const now = Date.now()
    const started = list
      .filter((s) => !Number.isNaN(Date.parse(s.start || '')) && Date.parse(s.start) <= now)
      .sort((a, b) => Date.parse(b.start || 0) - Date.parse(a.start || 0))
    const pick = started.find((s) => now <= Date.parse(s.end || '')) || started[0] || null
    const season = pick
      ? { id: pick.id, name: pick.name, start: pick.start, end: pick.end, source: 'robotevents' }
      : derivedSeason()
    cache = { at: Date.now(), season }
    return season
  } catch {
    return cache.season || derivedSeason()
  }
}

/** True when a date falls inside the season window. Unknown dates are not rejected. */
export function inSeason(season, dateish) {
  const t = Date.parse(dateish || '')
  if (!season) return true
  const a = Date.parse(season.start || '')
  if (Number.isNaN(t) || Number.isNaN(a)) return true
  // The API's `end` closes the game launch window (late December), not the competitive one:
  // V5 events keep running into the following spring. Allow a year from the start so a
  // February regional is not called "last season".
  return t >= a - 7 * 86400000 && t <= a + 372 * 86400000
}

const V5_CODES = new Set(['V5RC', 'VRC'])

/** Reject a valid event from a different VEX program (IQ, U, AI), naming it. */
export function programMismatch(event) {
  const code = String(event?.program?.code || '').toUpperCase()
  if (!code || V5_CODES.has(code)) return null
  return `that is a ${event.program?.name || code} event; this build only analyses VEX V5 Robotics Competition High School`
}

/** Reject an event that belongs to a different season, with a message that says which. */
export function seasonMismatch(season, event) {
  if (!season || !event) return null
  if (event.seasonId != null && season.id != null) {
    return Number(event.seasonId) === Number(season.id)
      ? null
      : `that event is from ${event.seasonName || 'a different season'}; this build only reviews ${season.name}`
  }
  if (inSeason(season, event.start)) return null
  return `that event ran ${String(event.start || '').slice(0, 10) || 'in a different season'}; this build only reviews ${season.name}`
}

/** Small name scorer, so a half-typed competition name still finds the event. */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const STOPWORDS = new Set(['the', 'of', 'for', 'and', 'vex', 'robotics', 'competition', 'vrc', 'v5rc', 'high', 'school', 'hs'])

export function nameScore(query, name) {
  const q = norm(query)
  const n = norm(name)
  if (!q) return 60
  if (n === q) return 100
  const contains = n.includes(q)
  const tokens = q.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t))
  if (!tokens.length) return contains ? 60 : 25
  let hit = 0
  for (const t of tokens) if (n.includes(t)) hit++
  return (hit / tokens.length) * 70 + (contains ? 25 : 0)
}
