// Season history for a single team, built from the tournaments it has already played.
//
// A future event has no matches, so there is nothing local to rate. What is useful there is
// what the team did at the events before it, which the API answers with one paged request
// (`/teams/{id}/matches?season[]=`). That response is cached per team for a few hours so
// opening the team lab or the onsite tab does not re-read the whole season every time.
import * as db from './db.js'
import { RobotEvents, robotEventsToken } from './ingest/robotevents.js'
import { currentSeason } from './season.js'
import { mean, quantile, round, sd } from './util.js'

const TTL = 6 * 60 * 60 * 1000
/** Enough to characterise a season without letting one busy team fill the archive. */
const MAX_MATCHES = 400

const upper = (v) => String(v ?? '').trim().toUpperCase()

export function cachedHistory(team) {
  const row = db.get('SELECT data, fetched_at FROM team_history WHERE team = ?', upper(team))
  if (!row) return null
  try {
    return { ...JSON.parse(row.data), fetchedAt: row.fetched_at, cached: true }
  } catch {
    return null
  }
}

export async function teamHistory(team, { fresh = false } = {}) {
  const number = upper(team)
  if (!number) throw Object.assign(new Error('team required'), { status: 400 })
  const cached = cachedHistory(number)
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity
  if (!fresh && cached && age < TTL) return cached

  const season = await currentSeason()
  const token = robotEventsToken()
  if (!token) {
    if (cached) return { ...cached, stale: true }
    throw Object.assign(new Error('team history needs ROBOTEVENTS_TOKEN in .env'), { status: 400 })
  }

  const client = new RobotEvents(token)
  // The roster of an event already tells us the API id, so most lookups cost nothing extra.
  let teamId = db.get('SELECT team_id FROM teams WHERE number = ? AND team_id IS NOT NULL LIMIT 1', number)?.team_id ?? null
  if (!teamId) teamId = await client.teamIdFor(number)
  if (!teamId) throw Object.assign(new Error(`RobotEvents does not know team ${number}`), { status: 404 })

  const rows = await client.teamMatches(teamId, season.id)
  const profile = profileFromTeamMatches(number, rows, season)
  // An empty profile is not worth caching: the team may be playing today.
  if (!profile.matches) return { ...profile, cached: false }
  db.run(
    `INSERT INTO team_history(team, season, data, fetched_at) VALUES(?,?,?,?)
     ON CONFLICT(team, season) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
    number,
    String(season.id ?? 'season'),
    JSON.stringify(profile),
    new Date().toISOString()
  )
  return { ...profile, cached: false }
}

const teamsOn = (alliance) =>
  (alliance?.teams || [])
    .map((t) => t.team?.code || t.team?.name || t.code || t.name || '')
    .map(upper)
    .filter(Boolean)

/** Turn the API's match rows into one team's season: games, events, form, spread. */
export function profileFromTeamMatches(team, rows = [], season = null) {
  const want = upper(team)
  const games = []
  for (const m of rows) {
    const alliances = m.alliances || []
    const side = alliances.find((a) => teamsOn(a).includes(want))
    if (!side) continue
    const other = alliances.find((a) => a !== side)
    const own = side.score
    const opp = other?.score
    // An unscored match says nothing about the team, so it never enters the profile.
    if (own == null || opp == null) continue
    games.push({
      event: m.event?.sku || null,
      eventName: m.event?.name || null,
      eventStart: m.event?.start || null,
      division: m.division?.name || null,
      round: m.round ?? null,
      matchnum: m.matchnum ?? null,
      scheduled: m.scheduled || m.started || null,
      own: Number(own),
      opp: Number(opp),
      won: Number(own) > Number(opp),
      tied: Number(own) === Number(opp)
    })
  }
  const when = (g) => Date.parse(g.scheduled || g.eventStart || '') || 0
  games.sort((a, b) => when(b) - when(a))
  const kept = games.slice(0, MAX_MATCHES)

  const scores = kept.map((g) => g.own)
  const opps = kept.map((g) => g.opp)
  const wins = kept.filter((g) => g.won).length
  const ties = kept.filter((g) => g.tied).length
  const losses = kept.length - wins - ties
  const avgScore = kept.length ? mean(scores) : null

  const byEvent = new Map()
  for (const g of kept) {
    const key = g.event || g.eventName || 'unknown'
    const e = byEvent.get(key) || {
      sku: g.event,
      name: g.eventName,
      start: g.eventStart,
      division: g.division,
      matches: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      scoreSum: 0,
      oppSum: 0
    }
    e.matches++
    if (g.won) e.wins++
    else if (g.tied) e.ties++
    else e.losses++
    e.scoreSum += g.own
    e.oppSum += g.opp
    e.start = e.start || g.eventStart
    byEvent.set(key, e)
  }
  const events = [...byEvent.values()]
    .map((e) => ({
      sku: e.sku,
      name: e.name,
      start: e.start,
      division: e.division,
      matches: e.matches,
      wins: e.wins,
      losses: e.losses,
      ties: e.ties,
      avgScore: round(e.scoreSum / e.matches, 1),
      avgOpp: round(e.oppSum / e.matches, 1)
    }))
    .sort((a, b) => (Date.parse(b.start || '') || 0) - (Date.parse(a.start || '') || 0))

  return {
    team: want,
    season: season?.name || null,
    seasonId: season?.id ?? null,
    matches: kept.length,
    wins,
    losses,
    ties,
    winRate: round(kept.length ? (wins + 0.5 * ties) / kept.length : 0, 3),
    avgScore: round(avgScore, 1),
    avgOpp: kept.length ? round(mean(opps), 1) : null,
    avgMargin: kept.length ? round(mean(kept.map((g) => g.own - g.opp)), 1) : null,
    floor: kept.length ? round(quantile(scores, 0.1), 1) : null,
    ceiling: kept.length ? round(quantile(scores, 0.9), 1) : null,
    sd: kept.length > 1 ? round(sd(scores), 1) : null,
    cv: kept.length > 1 && avgScore ? round(sd(scores) / avgScore, 3) : null,
    best: kept.length ? round(Math.max(...scores), 1) : null,
    events,
    form: kept.slice(0, 5).map((g) => ({
      won: g.won,
      tied: g.tied,
      own: g.own,
      opp: g.opp,
      eventName: g.eventName,
      event: g.event,
      date: g.scheduled || g.eventStart
    })),
    lastPlayed: kept[0]?.scheduled || kept[0]?.eventStart || null,
    source: { provider: 'robotevents', fetchedAt: new Date().toISOString() },
    notes: kept.length
      ? []
      : [`No scored ${season?.name || 'season'} matches for ${want} yet — history is empty until this team plays.`]
  }
}
