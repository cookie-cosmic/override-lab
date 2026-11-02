// RobotEvents / VEX Events API v2 client.
// Requires a personal bearer token (RobotEvents account -> API -> token).
// Set ROBOTEVENTS_TOKEN in the environment (never commit it).
//
// Documented behaviour this client designs around:
//  - default page size is 50, and `next_page` is not a full URL -> we always paginate manually
//  - the `scored` boolean is unreliable -> we treat "non-null scores" as final
//  - eliminations are expressed via `round` (1 practice, 2 qual, 3 QF, 4 SF, 5 F, 6 R16)
//  - `score_details` keys are season dependent -> stored raw, never assumed
const BASE = 'https://events.vex.com/api/v2'

export class RobotEvents {
  constructor(token) {
    this.token = token
    if (!token) throw new Error('RobotEvents API token required (ROBOTEVENTS_TOKEN)')
  }

  async get(pathname, params = {}) {
    const url = new URL(`${BASE}${pathname}`)
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item)
      else url.searchParams.set(k, v)
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' }
      })
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
        continue
      }
      if (!res.ok) throw new Error(`RobotEvents ${pathname} HTTP ${res.status}`)
      return res.json()
    }
    throw new Error(`RobotEvents ${pathname} failed after retries`)
  }

  async paged(pathname, params = {}, cap = 60) {
    const out = []
    let page = 1
    for (let i = 0; i < cap; i++) {
      // 250 is the documented maximum page size; the season schedule is over a thousand events.
      const json = await this.get(pathname, { per_page: 250, ...params, page })
      const rows = json.data || []
      out.push(...rows)
      // The payload exposes next_page_url / last_page. There is no `next_page` field, and
      // trusting one meant every list stopped at the first page.
      const meta = json.meta || {}
      const last = Number(meta.last_page)
      const more = meta.next_page_url ? true : Number.isFinite(last) ? page < last : false
      if (!more || !rows.length) break
      page += 1
    }
    return out
  }

  async resolveEventId(sku) {
    const json = await this.get('/events', { 'sku[]': [sku] })
    const ev = (json.data || [])[0]
    if (!ev) throw new Error(`RobotEvents: unknown event ${sku}`)
    return ev
  }

  /**
   * Events a team is registered for in one season — past, present and upcoming.
   *
   * `/events?team[]=` expects the numeric team id and rejects a number like 37S with a 422,
   * which silently emptied every team-scoped event list. Resolve the team first and read the
   * list from the team resource instead.
   */
  async eventsForTeam(team, seasonId) {
    const id = /^\d+$/.test(String(team || '').trim()) ? Number(team) : await this.teamIdFor(team)
    if (!id) return []
    return this.paged(`/teams/${id}/events`, { 'season[]': seasonId ? [seasonId] : undefined }, 6)
  }

  /** The whole season schedule, completed events included. Cached in-process by callers. */
  async seasonEvents(seasonId) {
    return this.paged('/events', { 'season[]': seasonId ? [seasonId] : undefined }, 20)
  }

  /** The API id behind a team number, needed for the team's season match history. */
  async teamIdFor(number) {
    const want = String(number || '').trim().toUpperCase()
    if (!want) return null
    const json = await this.get('/teams', { 'number[]': [want] })
    const rows = (json.data || []).filter((t) => String(t.number || '').trim().toUpperCase() === want)
    // Numbers are reused across seasons and programs, so the newest record is the live one.
    return rows.sort((a, b) => Number(b.id) - Number(a.id))[0]?.id ?? null
  }

  /** Every match a team has played this season, with its event attached to each row. */
  async teamMatches(teamId, seasonId) {
    return this.paged(`/teams/${teamId}/matches`, { 'season[]': seasonId ? [seasonId] : undefined }, 8)
  }

  mapTeams(teams) {
    return (teams || []).map((t) => ({
      id: t.id ?? null,
      number: t.number,
      name: t.team_name || t.name,
      org: t.organization,
      city: t.location?.city,
      region: t.location?.region,
      country: t.location?.country,
      grade: t.grade
    }))
  }

  async fetchEventBundle(sku, { team = null, division = null, maxMatches = 1500, maxSkills = 1200, maxAwards = 60, rosterOnly = false } = {}) {
    const ev = await this.resolveEventId(sku)
    const id = ev.id
    const allDivisions = ev.divisions || []

    // An event that has not run yet has no matches, rankings or awards to read. Fetching the
    // whole bundle anyway costs four extra requests and stores nothing, so planning mode
    // loads the one thing that exists: the roster.
    if (rosterOnly) {
      const teams = await this.paged(`/events/${id}/teams`, {}, 6).catch(() => [])
      return {
        event: {
          sku,
          name: ev.name,
          program: ev.program?.code || 'VRC',
          season: ev.season?.name || null,
          start_date: ev.start,
          end_date: ev.end,
          loc_venue: ev.location?.venue,
          loc_city: ev.location?.city,
          loc_region: ev.location?.region,
          loc_country: ev.location?.country
        },
        divisions: allDivisions.map((d) => d.name),
        teamDivision: null,
        teams: this.mapTeams(teams),
        rankings: [],
        matches: [],
        skills: [],
        awards: [],
        videos: [],
        mode: 'roster',
        intake: { teams: teams.length, matches: 0, scored: 0, skills: 0, awards: 0, truncated: false, rosterOnly: true },
        source: { provider: 'robotevents', fetched_at: new Date().toISOString(), division: null }
      }
    }

    // There is no /events/{id}/matches route. Divisions ride on the event payload, and both
    // matches and rankings hang off a division id, so every fetch is division-scoped.
    const divisionList = (allDivisions.length
      ? allDivisions
      : await this.paged(`/events/${id}/divisions`, {}, 1).catch(() => [])
    ).map((d) => ({ id: d.id, name: d.name }))

    let matches = []
    for (const d of divisionList) {
      if (matches.length >= maxMatches) break
      const pages = Math.max(1, Math.ceil((maxMatches - matches.length) / 250))
      const rows = await this.paged(`/events/${id}/divisions/${d.id}/matches`, {}, pages).catch(() => [])
      matches.push(...rows.map((m) => ({ ...m, division: m.division || { id: d.id, name: d.name } })))
      // A team only plays in one division, so there is nothing to read past that one.
      if (
        team &&
        rows.some((m) =>
          (m.alliances || []).some((a) =>
            (a.teams || []).some((t) => String(t.team?.code || t.team?.name || '').toUpperCase() === String(team).toUpperCase())
          )
        )
      ) {
        break
      }
    }
    const truncated = matches.length > maxMatches
    if (truncated) matches = matches.slice(0, maxMatches)

    // Which division did this team actually play? Read it off the matches. A championship
    // event runs several divisions and the other five are noise in a review of this team.
    let divName = division
    if (!divName && team) {
      const want = String(team).toUpperCase()
      const tally = new Map()
      for (const m of matches) {
        // Team numbers arrive in `team.name` on this API; `code` is null, so it must be a fallback.
        const inMatch = (m.alliances || []).some((a) =>
          (a.teams || []).some((t) => String(t.team?.code || t.team?.name || '').toUpperCase() === want)
        )
        if (!inMatch) continue
        const name = m.division?.name || 'Default'
        tally.set(name, (tally.get(name) || 0) + 1)
      }
      divName = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    }
    const divId = (divisionList.find((d) => d.name === divName) || (divisionList.length === 1 ? divisionList[0] : null))?.id
    const scoped = divName ? matches.filter((m) => (m.division?.name || 'Default') === divName) : matches

    const [teams, rankings, skills, awards] = await Promise.all([
      this.paged(`/events/${id}/teams`, {}, 4).catch(() => []),
      divId ? this.paged(`/events/${id}/divisions/${divId}/rankings`, {}, 4).catch(() => []) : [],
      this.paged(`/events/${id}/skills`, {}, 8).catch(() => []),
      this.paged(`/events/${id}/awards`, {}, 4).catch(() => [])
    ])

    const participants = new Set()
    for (const m of scoped) {
      for (const a of m.alliances || []) {
        for (const t of a.teams || []) {
          const code = t.team?.code || t.team?.name
          if (code) participants.add(String(code).toUpperCase())
        }
      }
    }
    const scopedSkills = skills
      .filter((s) => {
        const code = s.team?.code || s.team?.name
        return !code || participants.has(String(code).toUpperCase())
      })
      .flatMap((s) =>
        (s.rank != null ? [s] : [s.driver, s.programming, s.high_score]).filter(Boolean).length ? normalizeSkills(s) : []
      )
      .slice(0, maxSkills)
    const scopedAwards = awards.slice(0, maxAwards)

    return {
      event: {
        sku,
        // Division names usually already say "Division", so only add the word when they do not.
        name: divName ? `${ev.name} — ${/division/i.test(divName) ? divName : `${divName} division`}` : ev.name,
        program: ev.program?.code || 'VRC',
        season: ev.season?.name || null,
        start_date: ev.start,
        end_date: ev.end,
        loc_venue: ev.location?.venue,
        loc_city: ev.location?.city,
        loc_region: ev.location?.region,
        loc_country: ev.location?.country
      },
      divisions: allDivisions.map((d) => d.name),
      teamDivision: divName,
      teams: this.mapTeams(teams),
      rankings: rankings.map((r) => ({
        division: r.division?.name || 'Default',
        team: r.team?.code || r.team?.name,
        rank: r.rank,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        wp: r.wp,
        ap: r.ap,
        sp: r.sp,
        trsp: r.trsp ?? r.sp,
        max_score: r.high_score,
        opr: r.opr,
        dpr: r.dpr,
        ccwm: r.ccwm
      })),
      matches: scoped.map((m) => rowFromRobotEvents(m)),
      skills: scopedSkills,
      awards: scopedAwards.map((a) => ({ name: a.title || a.name, team: a.team?.code || a.winner_team?.[0] || null, order: a.order })),
      videos: [],
      intake: {
        teams: teams.length,
        matches: scoped.length,
        scored: scoped.filter((m) => (m.alliances || []).some((a) => a.score != null)).length,
        skills: scopedSkills.length,
        awards: scopedAwards.length,
        truncated
      },
      source: { provider: 'robotevents', fetched_at: new Date().toISOString(), division: divName || null }
    }
  }
}

function rowFromRobotEvents(m) {
  const row = {
    division: m.division?.name || 'Default',
    round: m.round,
    instance: m.instance,
    matchnum: m.matchnum,
    field: m.field || null,
    scheduled: m.scheduled,
    scored: m.scored ? 1 : (m.alliances || []).some((a) => a.score !== null) ? 1 : 0,
    video: m.video || null,
    score_details: {}
  }
  for (const alliance of m.alliances || []) {
    const color = String(alliance.color || '').toLowerCase().includes('red') ? 'red' : 'blue'
    const teams = (alliance.teams || []).map((t) => t.team?.code || t.team?.name || '').filter(Boolean)
    row[`${color}1`] = teams[0] || ''
    row[`${color}2`] = teams[1] || ''
    row[`${color}3`] = teams[2] || ''
    row[`${color}_score`] = alliance.score
    row[`${color}score`] = alliance.score
    row.score_details[color] = alliance.score_details || {}
  }
  return row
}

function normalizeSkills(s) {
  // The v2 skills payload nests driver/programming objects; VexDB uses type 0/1/2.
  const out = []
  const push = (type, obj) => {
    if (!obj) return
    const score = obj.score ?? obj.high_score
    if (score === undefined || score === null) return
    out.push({ team: s.team?.code, type, rank: obj.rank ?? s.rank ?? null, attempts: obj.attempts ?? null, score })
  }
  push(2, { score: s.score, rank: s.rank, attempts: s.attempts })
  if (s.driver) push(0, s.driver)
  if (s.programming) push(1, s.programming)
  return out
}

export function robotEventsToken() {
  return process.env.ROBOTEVENTS_TOKEN || process.env.VEX_TOKEN || ''
}
