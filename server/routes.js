// HTTP API. Kept dependency-free: a plain dispatcher over a path segment list.
import * as db from './db.js'
import { analysis, invalidate } from './analytics.js'
import { summary, matchList, matchDetail, teamView, opponentView, onsiteView, metaView, simulateView } from './views.js'
import { eventReport, teamReport } from './engine/report.js'
import { loadRules, saveRules } from './engine/counters.js'
import { RobotEvents, robotEventsToken } from './ingest/robotevents.js'
import { currentSeason, inSeason, seasonMismatch, nameScore, programMismatch } from './season.js'
import { teamHistory } from './history.js'
import { parseMatchCsv, parseTeamCsv } from './ingest/csv.js'
import { sendJson, sendText, readBody, num } from './util.js'

function youtubeId(input) {
  const s = String(input || '').trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|live\/|shorts\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

/** Accept an event SKU, a robotevents.com URL, or any text containing a SKU. */
function extractSku(input) {
  const s = String(input || '').trim()
  if (!s) return null
  const url = s.match(/robotevents\.com\/(?:tournaments|events)\/([A-Za-z0-9-]+)/i)
  if (url) return url[1].toUpperCase()
  // Program segments carry digits now (V5RC), and newer events also use a VE- prefix, so
  // letters alone would miss most current SKUs.
  const embedded = s.match(/\b(?:RE|VE|VEX)-[A-Z0-9]{1,6}-\d{2}-\d+\b/i)
  return embedded ? embedded[0].toUpperCase() : null
}

/** Auto-alignment: seek = match start - stream start + manual offset. */
function alignEvent(sku, offsets = {}) {
  const a = analysis(sku)
  if (!a) return { aligned: 0, reason: 'unknown event' }
  if (!a.videos.length) return { aligned: 0, reason: 'no videos registered' }
  const videos = a.videos
  const ordered = [...a.ratings.matches].sort((x, y) => (Date.parse(x.scheduled || 0) || 0) - (Date.parse(y.scheduled || 0) || 0))
  let aligned = 0
  let prevStart = null
  for (const m of ordered) {
    if (!m.scheduled) continue
    const t = Date.parse(m.scheduled)
    if (Number.isNaN(t)) continue
    const candidates = videos.filter((v) => !v.field || !m.field || v.field === m.field)
    const video = candidates[0] || videos[0]
    const start = Date.parse(video.stream_start || '')
    if (Number.isNaN(start)) continue
    const offset = Number(offsets[video.id] ?? 0) || 0
    const seek = Math.round((t - start) / 1000 + offset)
    if (seek < 0) continue
    const gapMin = prevStart == null ? 0 : (t - prevStart) / 60000
    // Long gaps are breaks, and breaks are exactly where naive offsets drift.
    const confidence = gapMin > 25 ? 0.45 : gapMin > 10 ? 0.7 : 0.88
    db.setMatchMedia(m.match_key, { video_id: video.id, offset_s: offset, seek_s: seek, confidence, source: offset ? 'auto+manual' : 'auto' })
    prevStart = t
    aligned++
  }
  // Media rows changed underneath the cached analysis: drop it or every reader keeps
  // seeing the pre-alignment snapshot.
  invalidate(sku)
  return { aligned, videos: videos.length }
}

// Season schedule is large and does not change minute to minute, so it is cached briefly.
const SEASON_TTL = 10 * 60 * 1000
const seasonCache = new Map()

async function seasonEventList(client, season) {
  if (!season?.id) return []
  const key = String(season.id)
  const hit = seasonCache.get(key)
  if (hit && Date.now() - hit.at < SEASON_TTL) return hit.rows
  const rows = await client.seasonEvents(season.id)
  seasonCache.set(key, { at: Date.now(), rows })
  return rows
}

const eventCard = (e) => ({
  sku: e.sku,
  name: e.name,
  start: e.start,
  end: e.end,
  city: e.location?.city || null,
  region: e.location?.region || null,
  country: e.location?.country || null,
  divisions: (e.divisions || []).map((d) => d.name),
  url: e.url || null
})

/** Search inside the current season only. Never falls back to an older archive. */
async function findInSeason({ q = '', team = '' } = {}) {
  const bearer = robotEventsToken()
  const season = await currentSeason()
  if (!bearer) {
    return {
      season,
      tokenRequired: true,
      competitions: [],
      notes: [`Reviews are limited to ${season.name}. That data comes from the RobotEvents API and needs a token.`]
    }
  }
  const client = new RobotEvents(bearer)
  const notes = []
  let rows = []
  if (team) {
    try {
      rows = await client.eventsForTeam(team, season.id)
    } catch (e) {
      notes.push(`team schedule unavailable: ${e.message}`)
    }
  }
  if (q) {
    try {
      rows = rows.concat(await seasonEventList(client, season))
    } catch (e) {
      notes.push(`season schedule unavailable: ${e.message}`)
    }
  }
  const now = Date.now()
  const seen = new Set()
  const out = []
  for (const e of rows) {
    if (!e?.sku || seen.has(e.sku)) continue
    seen.add(e.sku)
    if (seasonMismatch(season, { seasonId: e.season?.id, seasonName: e.season?.name, start: e.start })) continue
    const score = nameScore(q, e.name)
    if (q && score < 25) continue
    out.push({
      ...eventCard(e),
      season: e.season?.name || season.name,
      upcoming: Date.parse(e.start || 0) > now,
      score: Math.round(score)
    })
  }
  out.sort((a, b) => b.score - a.score || Date.parse(b.start || 0) - Date.parse(a.start || 0))
  return { season, competitions: out.slice(0, 25), notes }
}

async function body(req) {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 })
  }
}

export async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1)
  const q = url.searchParams
  const method = req.method

  try {
    if (parts[0] === 'health') {
      return sendJson(res, 200, { ok: true, events: db.listEvents().length, version: 1 })
    }

    // Unsaved sessions: an event resolved for review lives in the archive only until the
    // user saves it, discards it, or leaves the tab.
    if (parts[0] === 'session') {
      if (method === 'GET') {
        const t = db.transientEvent()
        if (!t) return sendJson(res, 200, { session: null })
        const row = db.all('SELECT COUNT(*) AS c FROM matches WHERE sku = ?', t.sku)[0]
        return sendJson(res, 200, {
          session: { sku: t.sku, name: t.name, ingested_at: t.ingested_at, matches: Number(row?.c || 0) }
        })
      }
      if (method === 'POST') {
        const b = await body(req)
        const sku = extractSku(b.sku) || String(b.sku || '').trim()
        if (!sku) return sendJson(res, 400, { error: 'sku required' })
        if (parts[1] === 'save') {
          db.setTransient(sku, false)
          invalidate(sku)
          return sendJson(res, 200, { saved: true, sku })
        }
        if (parts[1] === 'discard') {
          db.deleteEvent(sku)
          invalidate(sku)
          return sendJson(res, 200, { discarded: true, sku })
        }
        return sendJson(res, 404, { error: 'not found' })
      }
    }

    // A post-tournament review starts from two facts, not from a pre-built archive:
    // which competition, and which team number. These two routes resolve them.
    // The season is the scope of the whole app: which game is being played right now, and
    // which events in it are still ahead of the team.
    if (parts[0] === 'season') {
      const token = robotEventsToken()
      if (parts[1] === 'events') {
        const b = method === 'POST' ? await body(req) : {}
        const team = String(b.team || q.get('team') || '').trim().toUpperCase()
        const bearer = token
        const season = await currentSeason()
        const wanted = String(b.scope || q.get('scope') || (team ? 'team' : 'season')).toLowerCase()
        const scope = wanted === 'team' ? 'team' : 'season'
        const text = String(b.q || q.get('q') || '').trim()
        if (scope === 'team' && !team) {
          return sendJson(res, 400, { error: 'team ID required for a team schedule', season, scope, team: null })
        }
        if (!bearer) {
          return sendJson(res, 200, {
            season,
            team: team || null,
            scope,
            tokenRequired: true,
            upcoming: [],
            completed: [],
            counts: { upcoming: 0, completed: 0, total: 0 },
            notes: [
              scope === 'team'
                ? `A team's ${season.name} schedule needs a RobotEvents token.`
                : `The ${season.name} schedule needs a RobotEvents token.`
            ]
          })
        }
        const client = new RobotEvents(bearer)
        const notes = []
        let rows = []
        try {
          rows = scope === 'team' ? await client.eventsForTeam(team, season.id) : await seasonEventList(client, season)
        } catch (e) {
          return sendJson(res, 502, { season, team: team || null, scope, error: `RobotEvents: ${e.message}` })
        }
        if (scope === 'season' && !season.id) {
          notes.push('The season id came from the calendar window rather than the API, so the season-wide list is empty.')
        }
        const now = Date.now()
        const seen = new Set()
        const inScope = []
        for (const e of rows) {
          if (!e?.sku || seen.has(e.sku)) continue
          seen.add(e.sku)
          if (seasonMismatch(season, { seasonId: e.season?.id, seasonName: e.season?.name, start: e.start })) continue
          if (text && nameScore(text, e.name) < 25) continue
          inScope.push(e)
        }
        const upcoming = inScope
          .filter((e) => Date.parse(e.start || 0) > now)
          .sort((a, b) => Date.parse(a.start || 0) - Date.parse(b.start || 0))
          .map((e) => ({ ...eventCard(e), status: 'upcoming' }))
        const completed = inScope
          .filter((e) => Date.parse(e.start || 0) <= now)
          .sort((a, b) => Date.parse(b.start || 0) - Date.parse(a.start || 0))
          .map((e) => ({ ...eventCard(e), status: 'completed' }))
        return sendJson(res, 200, {
          season,
          team: team || null,
          scope,
          query: text,
          // Every event in the season is counted; the payload is capped so the page stays usable.
          upcoming: upcoming.slice(0, 40),
          completed: completed.slice(0, 60),
          counts: { upcoming: upcoming.length, completed: completed.length, total: inScope.length },
          notes
        })
      }
      const season = await currentSeason()
      return sendJson(res, 200, { season, token: Boolean(token) })
    }

    if (parts[0] === 'find' && (method === 'GET' || method === 'POST')) {
      const b = method === 'POST' ? await body(req) : {}
      const out = await findInSeason({
        q: String(b.q ?? q.get('q') ?? '').trim(),
        team: String(b.team ?? q.get('team') ?? '').trim().toUpperCase()
      })
      return sendJson(res, 200, out)
    }

    if (parts[0] === 'resolve' && method === 'POST') {
      const b = await body(req)
      // The event is the only required fact. A team number narrows the review to that team,
      // but the overview, meta, team lab and simulation all work from the event alone.
      const team = String(b.team || '').trim().toUpperCase()
      const competition = String(b.competition || '').trim()
      if (!competition) return sendJson(res, 400, { error: 'competition name or event SKU is required' })

      const token = robotEventsToken()
      const season = await currentSeason()
      if (!token) {
        return sendJson(res, 400, {
          error: `reviewing ${season.name} needs a RobotEvents API token`,
          hint: 'Put ROBOTEVENTS_TOKEN in .env and restart the server. Public archives stop at 2020, so they cannot answer a current-season question.',
          season,
          tokenRequired: true
        })
      }
      const client = new RobotEvents(token)

      let candidates = []
      // An explicit pick, a pasted SKU, or a robotevents.com URL always wins.
      let sku = extractSku(b.pick) || extractSku(competition)
      if (!sku) {
        const found = await findInSeason({ q: competition, team })
        candidates = found.competitions
        if (!candidates.length) {
          return sendJson(res, 404, {
            error: `no ${season.name} event matched "${competition}"`,
            hint: 'Try fewer words, or paste the event SKU (RE-VRC-…) or its robotevents.com URL.',
            season,
            notes: found.notes
          })
        }
        if (!b.pick && candidates.length > 1 && candidates[0].score === candidates[1].score) {
          return sendJson(res, 200, { ambiguous: true, season, candidates: candidates.slice(0, 8) })
        }
        sku = b.pick || candidates[0].sku
      }

      let ev
      try {
        ev = await client.resolveEventId(sku)
      } catch (e) {
        // An expired or bogus token is not the same thing as an unknown event.
        if (/HTTP 40[13]/.test(e.message)) {
          return sendJson(res, 401, {
            error: 'the RobotEvents token was rejected',
            hint: 'Generate a fresh token at events.vex.com → Account → API, then put it in .env as ROBOTEVENTS_TOKEN.',
            season,
            tokenRequired: true
          })
        }
        return sendJson(res, 404, { error: `RobotEvents does not know ${sku}`, hint: e.message, season })
      }

      // A VEX IQ, VURC or VAIRC event is a different program entirely: name it instead of
      // letting the ratings code trip over a shape it was never built for.
      const programIssue = programMismatch(ev)
      if (programIssue) {
        return sendJson(res, 400, { error: programIssue, season, event: { sku, name: ev.name, start: ev.start } })
      }

      // Nothing outside this season is reviewable, even when the SKU itself is valid.
      const mismatch = seasonMismatch(season, {
        seasonId: ev.season?.id,
        seasonName: ev.season?.name,
        start: ev.start
      })
      if (mismatch) {
        return sendJson(res, 400, { error: mismatch, season, event: { sku, name: ev.name, start: ev.start } })
      }

      // An event still ahead of the team is planning, not review: load the event and its
      // roster only. Matches, rankings and awards cannot exist yet, so they are not requested,
      // and the team lab reads the team's history from events already played.
      const startT = Date.parse(ev.start || '')
      if (!Number.isNaN(startT) && startT > Date.now() + 86400000) {
        const bundle = await client.fetchEventBundle(sku, { rosterOnly: true })
        db.clearTransients()
        db.upsertEventBundle(bundle)
        db.setTransient(sku, true)
        invalidate(sku)
        const roster = db.getTeams(sku)
        const teamFound = roster.some((r) => String(r.number || '').toUpperCase() === team)
        return sendJson(res, 200, {
          sku,
          name: bundle.event.name,
          season: bundle.event.season || season.name,
          seasonWindow: { start: season.start, end: season.end },
          start: ev.start,
          upcoming: true,
          rosterOnly: true,
          team,
          teamFound,
          teams: roster.length,
          matches: 0,
          scored: 0,
          transient: true,
          intake: bundle.intake,
          notes: [
            `${bundle.event.name} starts ${String(ev.start).slice(0, 10)}. Nothing has been played yet, so only the ${roster.length}-team roster was loaded.`,
            teamFound
              ? `${team} is registered — its team lab and onsite tab use its previous tournaments.`
              : team
                ? `${team} is not on this roster yet. Pick a registered team in the team lab.`
                : 'No team number was given, so the event opened on its roster — the team lab, counters and simulation are one click away.'
          ]
        })
      }

      const tried = []
      let bundle = null
      let division = b.division || null
      let scored = 0
      try {
        // The bundle picks the division off the matches, so no separate lookup is needed.
        const candidateBundle = await client.fetchEventBundle(sku, { team, division: b.division || null })
        const candidateScored = candidateBundle.matches.filter((m) => m.redscore != null && m.bluescore != null).length
        tried.push({ sku, name: candidateBundle.event.name, matches: candidateBundle.matches.length, scored: candidateScored })
        if (candidateScored > 0) {
          bundle = candidateBundle
          division = candidateBundle.teamDivision || division
          scored = candidateScored
        }
      } catch (e) {
        tried.push({ sku, name: sku, error: e.message })
      }

      // Registered but unplayed: try the other in-season candidates before giving up.
      if (!bundle) {
        for (const cand of candidates.filter((c) => c.sku !== sku).slice(0, 3)) {
          try {
            const cb = await client.fetchEventBundle(cand.sku, { team, division: b.division || null })
            const cs = cb.matches.filter((m) => m.redscore != null && m.bluescore != null).length
            tried.push({ sku: cand.sku, name: cb.event.name, matches: cb.matches.length, scored: cs })
            if (cs > 0) {
              bundle = cb
              sku = cand.sku
              scored = cs
              division = cb.teamDivision || division
              break
            }
          } catch (e) {
            tried.push({ sku: cand.sku, error: e.message })
          }
        }
      }
      if (!bundle) {
        return sendJson(res, 422, {
          error: team ? `no played ${season.name} matches for ${team} at that event` : `no played ${season.name} matches at that event yet`,
          hint: 'If the event is still running, results appear as matches are scored. Leave the team number blank to open the event overview while it runs.',
          tried,
          noResults: true,
          season
        })
      }

      // Loaded for review only. A new resolve replaces the previous unsaved one, so the
      // archive never holds more than one temporary event and nothing is kept silently.
      db.clearTransients()
      db.upsertEventBundle(bundle)
      db.setTransient(sku, true)
      invalidate(sku)

      let video = null
      let align = null
      if (b.video_url) {
        const id = youtubeId(b.video_url)
        if (!id) return sendJson(res, 400, { error: 'could not read a YouTube video id from video_url' })
        const videoId = db.addVideo(sku, {
          youtube_id: id,
          label: b.video_label || `${team} stream`,
          stream_start: b.stream_start || null,
          duration_s: num(b.duration_s),
          field: b.video_field || null,
          notes: 'added while resolving the competition'
        })
        video = { id: videoId, youtube_id: id }
        if (b.stream_start) {
          invalidate(sku)
          align = alignEvent(sku, {})
        }
      }

      const a = analysis(sku)
      const teamKnown = Boolean(a && a.ratings.teams.has(team))
      return sendJson(res, 200, {
        sku,
        name: bundle.event.name,
        season: bundle.event.season || season.name,
        seasonWindow: { start: season.start, end: season.end },
        division,
        team,
        teamFound: teamKnown,
        teams: bundle.teams.length,
        matches: bundle.matches.length,
        scored,
        transient: true,
        intake: bundle.intake || null,
        video,
        align,
        tried,
        nearestTeams: teamKnown ? [] : [...(a?.ratings.teams.keys() || [])].slice(0, 8),
        candidates: candidates.slice(0, 5)
      })
    }

    // A team's season, read from the events it already played. This is what makes a future
    // event useful: the roster has no matches, but the teams on it do have a season.
    if (parts[0] === 'history' && method === 'GET') {
      const team = String(q.get('team') || '').trim().toUpperCase()
      if (!team) return sendJson(res, 400, { error: 'team required' })
      const profile = await teamHistory(team, { fresh: q.get('fresh') === '1' })
      return sendJson(res, 200, profile)
    }

    if (parts[0] === 'events' && parts.length === 1 && method === 'GET') {
      return sendJson(res, 200, { events: db.listEvents() })
    }

    if (parts[0] === 'ingest' && parts[1] === 'csv' && method === 'POST') {
      const b = await body(req)
      const sku = String(b.sku || '').trim()
      const csv = String(b.csv || '')
      if (!sku || !csv) return sendJson(res, 400, { error: 'sku and csv are required' })
      const parsed = parseMatchCsv(csv, sku)
      const teamRows = b.teamsCsv ? parseTeamCsv(b.teamsCsv) : []
      const participants = [
        ...new Set(
          parsed.matches.flatMap((m) => [m.red1, m.red2, m.red3, m.blue1, m.blue2, m.blue3].filter(Boolean))
        )
      ]
      const existing = db.getEvent(sku)
      const bundle = {
        event: existing || { sku, name: b.name || sku, program: b.program || 'VRC', season: b.season || null, start_date: b.start_date || null },
        matches: parsed.matches,
        teams: teamRows.length ? teamRows : participants.map((number) => ({ number })),
        rankings: [],
        skills: [],
        awards: [],
        videos: []
      }
      db.upsertEventBundle(bundle)
      invalidate(sku)
      return sendJson(res, 200, {
        sku,
        matches: parsed.matches.length,
        teams: bundle.teams.length,
        headers: parsed.headers,
        note: existing ? 'Event replaced from CSV: previous rankings, skills and videos were dropped.' : 'Event created from CSV.'
      })
    }

    if (parts[0] === 'ingest' && parts.length === 1 && method === 'POST') {
      const b = await body(req)
      const sku = String(b.sku || '').trim()
      const provider = 'robotevents'
      if (!sku) return sendJson(res, 400, { error: 'sku is required' })
      const token = robotEventsToken()
      const season = await currentSeason()
      if (!token) {
        return sendJson(res, 400, {
          error: `ingesting a ${season.name} event needs a RobotEvents token`,
          hint: 'Put ROBOTEVENTS_TOKEN in .env and restart the server. Never commit it.',
          season,
          tokenRequired: true
        })
      }
      const client = new RobotEvents(token)
      const ev = await client.resolveEventId(sku)
      const programIssue = programMismatch(ev)
      if (programIssue) return sendJson(res, 400, { error: programIssue, season })
      const mismatch = seasonMismatch(season, { seasonId: ev.season?.id, seasonName: ev.season?.name, start: ev.start })
      if (mismatch) return sendJson(res, 400, { error: mismatch, season })
      const startT = Date.parse(ev.start || '')
      if (!Number.isNaN(startT) && startT > Date.now() + 86400000) {
        const rosterBundle = await client.fetchEventBundle(sku, { rosterOnly: true })
        db.upsertEventBundle(rosterBundle)
        invalidate(sku)
        return sendJson(res, 200, {
          sku,
          provider,
          rosterOnly: true,
          teams: rosterBundle.teams.length,
          matches: 0,
          scored: 0,
          skills: 0,
          note: 'Upcoming event: roster only. Team analysis comes from previous tournaments.'
        })
      }
      const bundle = await client.fetchEventBundle(sku, {
        team: String(b.team || '').trim().toUpperCase() || null
      })
      db.upsertEventBundle(bundle)
      invalidate(sku)
      return sendJson(res, 200, {
        sku,
        provider,
        teams: bundle.teams.length,
        matches: bundle.matches.length,
        scored: bundle.matches.filter((m) => m.redscore != null || m.red_score != null).length,
        skills: bundle.skills.length
      })
    }

    if (parts[0] === 'rules') {
      if (method === 'GET') return sendJson(res, 200, loadRules({ fresh: true }))
      if (method === 'PUT' || method === 'POST') {
        const b = await body(req)
        if (!Array.isArray(b.rules)) return sendJson(res, 400, { error: 'rules array required' })
        return sendJson(res, 200, saveRules(b))
      }
    }

    if (parts[0] === 'scouting' && method === 'POST') {
      const b = await body(req)
      if (!b.sku || !b.team) return sendJson(res, 400, { error: 'sku and team required' })
      db.setScouting(b.sku, b.team, b.data || {})
      invalidate(b.sku)
      return sendJson(res, 200, { ok: true })
    }

    if (parts[0] === 'score-events') {
      if (method === 'GET') {
        const key = q.get('key')
        if (!key) return sendJson(res, 400, { error: 'key required' })
        return sendJson(res, 200, { events: db.listScoreEvents(key) })
      }
      if (method === 'POST') {
        const b = await body(req)
        if (!b.key) return sendJson(res, 400, { error: 'key required' })
        const id = db.addScoreEvent(b.key, {
          t_s: num(b.t_s) ?? 0,
          alliance: b.alliance,
          points: num(b.points) ?? 1,
          note: b.note,
          source: b.source || 'manual'
        })
        return sendJson(res, 200, { id })
      }
      if (method === 'DELETE' && parts[1]) {
        db.removeScoreEvent(Number(parts[1]))
        return sendJson(res, 200, { ok: true })
      }
    }

    if (parts[0] === 'match' && method === 'POST') {
      const b = await body(req)
      if (!b.key) return sendJson(res, 400, { error: 'key required' })
      db.setMatchMedia(b.key, { video_id: b.video_id ?? null, offset_s: b.offset_s ?? 0, seek_s: b.seek_s ?? null, confidence: 1, source: 'manual' })
      invalidate(String(b.key).split('::')[0])
      return sendJson(res, 200, { ok: true })
    }

    if (parts[0] === 'video' && method === 'DELETE' && parts[1]) {
      db.removeVideo(Number(parts[1]))
      invalidate()
      return sendJson(res, 200, { ok: true })
    }

    if (parts[0] !== 'events' || !parts[1]) return sendJson(res, 404, { error: 'not found' })

    const sku = decodeURIComponent(parts[1])
    const sub = parts[2]

    if (!sub) {
      if (method === 'DELETE') {
        db.deleteEvent(sku)
        invalidate(sku)
        return sendJson(res, 200, { ok: true })
      }
      const ev = db.getEvent(sku)
      if (!ev) return sendJson(res, 404, { error: 'unknown event' })
      return sendJson(res, 200, { event: ev })
    }

    if (sub === 'summary' && method === 'GET') {
      const s = summary(sku)
      if (!s) return sendJson(res, 404, { error: 'unknown event' })
      return sendJson(res, 200, s)
    }
    if (sub === 'matches' && method === 'GET') {
      const list = matchList(sku)
      if (!list) return sendJson(res, 404, { error: 'unknown event' })
      return sendJson(res, 200, { matches: list })
    }
    if (sub === 'match' && method === 'GET') {
      const d = matchDetail(sku, q.get('key'))
      if (!d) return sendJson(res, 404, { error: 'unknown match' })
      return sendJson(res, 200, d)
    }
    if (sub === 'team' && method === 'GET') {
      const v = teamView(sku, q.get('team'), q.get('vs'))
      if (!v) return sendJson(res, 404, { error: 'unknown team' })
      return sendJson(res, 200, v)
    }
    if (sub === 'opponent' && method === 'GET') {
      const v = opponentView(sku, q.get('team'), q.get('own'))
      if (!v) return sendJson(res, 404, { error: 'unknown team' })
      return sendJson(res, 200, v)
    }
    if (sub === 'onsite' && method === 'GET') {
      const v = onsiteView(sku, String(q.get('team') || '').trim().toUpperCase())
      if (!v) return sendJson(res, 404, { error: 'unknown team at this event' })
      return sendJson(res, 200, v)
    }
    if (sub === 'sim' && method === 'GET') {
      const v = simulateView(sku, String(q.get('team') || '').trim().toUpperCase())
      if (!v) return sendJson(res, 404, { error: 'unknown team at this event' })
      return sendJson(res, 200, v)
    }
    if (sub === 'meta' && method === 'GET') {
      const v = metaView(sku)
      if (!v) return sendJson(res, 404, { error: 'unknown event' })
      return sendJson(res, 200, v)
    }
    if (sub === 'videos') {
      if (method === 'GET') return sendJson(res, 200, { videos: db.listVideos(sku) })
      if (method === 'POST') {
        const b = await body(req)
        const id = youtubeId(b.youtube_id || b.url)
        if (!id) return sendJson(res, 400, { error: 'could not read a YouTube video id from that value' })
        const videoId = db.addVideo(sku, {
          youtube_id: id,
          label: b.label || null,
          stream_start: b.stream_start || null,
          duration_s: num(b.duration_s),
          field: b.field || null,
          notes: b.notes || null
        })
        invalidate(sku)
        return sendJson(res, 200, { id: videoId, youtube_id: id })
      }
    }
    if (sub === 'align' && method === 'POST') {
      const b = await body(req)
      const result = alignEvent(sku, b.offsets || {})
      return sendJson(res, 200, result)
    }
    if (sub === 'report' && method === 'GET') {
      const ev = db.getEvent(sku)
      if (!ev) return sendJson(res, 404, { error: 'unknown event' })
      const team = q.get('team')
      if (team) {
        const tv = teamView(sku, team)
        if (!tv) return sendJson(res, 404, { error: 'unknown team' })
        return sendText(res, 200, teamReport({ teamView: tv, event: ev }), 'text/markdown; charset=utf-8')
      }
      const s = summary(sku)
      if (!s) return sendJson(res, 404, { error: 'unknown event' })
      const meta = metaView(sku)
      return sendText(res, 200, eventReport({ event: ev, summary: s, meta }), 'text/markdown; charset=utf-8')
    }

    return sendJson(res, 404, { error: 'not found' })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error(`[api] ${req.method} ${url.pathname} → ${err.message}`)
    return sendJson(res, status, { error: err.message })
  }
}
