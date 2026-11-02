// View assembly: turns engine output into exactly what each screen needs.
import { analysis } from './analytics.js'
import * as db from './db.js'
import { teamsOf, isScored } from './engine/ratings.js'
import { attributeMatch } from './engine/attribution.js'
import { wpaTimeline, pFromScores } from './engine/winprob.js'
import { prescribe } from './engine/prescribe.js'
import { attackVectors, metricsFor } from './engine/counters.js'
import { teamBriefing, matchPostMortem, eventDigest } from './engine/narrative.js'
import { simulateAlliances, simulateMatchup } from './engine/sim.js'
import { round, sum, mean, quantile, isElimRound, roundLabel } from './util.js'

const winnerOf = (m) => (m.red_score == null || m.blue_score == null ? null : m.red_score > m.blue_score ? 'red' : m.red_score < m.blue_score ? 'blue' : 'tie')

function histogram(values, binSize) {
  if (!values.length) return []
  const min = Math.floor(Math.min(...values) / binSize) * binSize
  const max = Math.ceil(Math.max(...values) / binSize) * binSize
  const bins = []
  for (let x = min; x <= max; x += binSize) bins.push({ from: x, to: x + binSize, count: 0 })
  for (const v of values) {
    const i = Math.max(0, Math.min(bins.length - 1, Math.floor((v - min) / binSize)))
    bins[i].count++
  }
  return bins
}

function correlate(rows, xKey, yKey) {
  const pairs = rows.map((r) => [r[xKey], r[yKey]]).filter(([x, y]) => x != null && y != null)
  if (pairs.length < 6) return null
  const mx = mean(pairs.map((p) => p[0]))
  const my = mean(pairs.map((p) => p[1]))
  let num = 0
  let dx = 0
  let dy = 0
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my)
    dx += (x - mx) ** 2
    dy += (y - my) ** 2
  }
  const r = dx && dy ? num / Math.sqrt(dx * dy) : 0
  return { r: round(r, 3), n: pairs.length }
}

export function summary(sku) {
  const a = analysis(sku)
  if (!a) return null
  const { event, ratings, archetypes } = a

  // A future event has a roster and nothing else. Ratings, win probabilities and prescriptions
  // are all built from completed matches, so this returns the roster instead of fake numbers.
  if (!ratings.matches.length) {
    const roster = db.getTeams(sku).map((t) => ({
      team: t.number,
      name: t.name,
      org: t.org,
      city: t.city,
      region: t.region,
      country: t.country,
      grade: t.grade
    }))
    return {
      event,
      rosterOnly: true,
      roster,
      awards: a.awards,
      count: { teams: roster.length, matches: 0, scored: 0 },
      model: { sigmaMargin: null, eventMean: null, calibration: null },
      digest: { paragraphs: [], claims: [] },
      leaderboards: { power: [], scoring: [], floor: [], ceiling: [], auton: [], skills: [], penalties: [], clutch: [], luck: [], unlucky: [] },
      upsets: [],
      bracket: { rounds: [], champion: null },
      distributions: { allianceScores: [], margins: [], close: 0, blowouts: 0, medianMargin: 0 },
      archetypes: { clusters: [], teams: [] },
      quality: {
        teams: 0,
        matches: 0,
        scored: 0,
        unscored: 0,
        missingSchedule: 0,
        breakdownAvailable: 0,
        videos: a.videos.length,
        aligned: 0,
        tagged: 0,
        scouting: 0,
        calibrationN: 0
      },
      notes: [`${event.name} has not run yet, so only the roster is loaded. Team analysis comes from previous tournaments.`]
    }
  }

  const played = ratings.list.filter((t) => t.matches > 0)
  const scored = ratings.matches.filter(isScored)
  const allianceScores = scored.flatMap((m) => [m.red_score, m.blue_score])
  const signedMargins = scored.map((m) => m.red_score - m.blue_score)
  const absMargins = signedMargins.map(Math.abs)

  const leader = (key, dir = 'desc', n = 5) =>
    played
      .filter((t) => t[key] != null)
      .sort((x, y) => (dir === 'desc' ? y[key] - x[key] : x[key] - y[key]))
      .slice(0, n)
      .map((t) => ({ team: t.team, name: t.name, value: round(t[key], 1), elo: t.elo, matches: t.matches }))

  const upsets = scored
    .map((m) => {
      const pRed = m.pRed ?? 0.5
      const w = winnerOf(m)
      if (!w || w === 'tie') return null
      const winnerP = w === 'red' ? pRed : 1 - pRed
      return {
        key: m.match_key,
        matchnum: m.matchnum,
        round: m.round,
        roundLabel: roundLabel(m.round),
        red: teamsOf(m).red,
        blue: teamsOf(m).blue,
        redScore: m.red_score,
        blueScore: m.blue_score,
        winner: w,
        winnerP: round(winnerP, 3),
        margin: Math.abs(m.red_score - m.blue_score)
      }
    })
    .filter((m) => m && m.winnerP < 0.4)
    .sort((x, y) => x.winnerP - y.winnerP)
    .slice(0, 6)

  const elims = scored.filter((m) => isElimRound(m.round))
  const bracket = {}
  for (const m of elims) {
    const r = Number(m.round)
    if (!bracket[r]) bracket[r] = []
    bracket[r].push({
      key: m.match_key,
      matchnum: m.matchnum,
      field: m.field,
      scheduled: m.scheduled,
      red: teamsOf(m).red,
      blue: teamsOf(m).blue,
      redScore: m.red_score,
      blueScore: m.blue_score,
      winner: winnerOf(m)
    })
  }
  const bracketRounds = Object.keys(bracket)
    .map(Number)
    .sort((x, y) => x - y)
    .map((r) => ({ round: r, label: roundLabel(r), matches: bracket[r] }))
  const finalMatch = [...(bracket[5] || [])].sort((a, b) => (b.matchnum || 0) - (a.matchnum || 0))[0] || null
  const champion = finalMatch ? (finalMatch.winner === 'red' ? finalMatch.red : finalMatch.blue) : null

  const tagged = db.all(
    'SELECT match_key, COUNT(*) AS c FROM score_events WHERE match_key LIKE ? GROUP BY match_key',
    `${sku}::%`
  )
  const media = new Map(a.media.map((m) => [m.match_key, m]))
  const quality = {
    teams: played.length,
    matches: ratings.matches.length,
    scored: scored.length,
    unscored: ratings.matches.length - scored.length,
    missingSchedule: ratings.matches.filter((m) => !m.scheduled).length,
    breakdownAvailable: scored.filter((m) => m.red_auto != null).length,
    videos: a.videos.length,
    aligned: a.media.length,
    tagged: tagged.length,
    scouting: a.scouting.length,
    calibrationN: ratings.calibration?.n ?? 0
  }

  return {
    event,
    awards: a.awards,
    count: { teams: played.length, matches: ratings.matches.length, scored: scored.length },
    model: {
      sigmaMargin: ratings.sigmaMargin,
      eventMean: ratings.eventMean,
      calibration: ratings.calibration
    },
    digest: eventDigest({ event, ratings, archetypes }),
    leaderboards: {
      power: [...played].sort((x, y) => y.elo - x.elo).slice(0, 10).map((t) => ({
        team: t.team,
        name: t.name,
        elo: t.elo,
        band: t.eloBand,
        opr: t.opr,
        avgPoints: t.avgPoints,
        rank: t.rank,
        winsAboveExpectation: t.winsAboveExpectation
      })),
      scoring: leader('avgPoints'),
      floor: leader('floor'),
      ceiling: leader('ceiling'),
      auton: leader('autonPerMatch'),
      skills: played
        .filter((t) => t.skills?.combined != null)
        .sort((x, y) => y.skills.combined - x.skills.combined)
        .slice(0, 5)
        .map((t) => ({ team: t.team, value: t.skills.combined, driver: t.skills.driver, prog: t.skills.prog })),
      penalties: leader('penaltyPerMatch', 'desc'),
      clutch: leader('clutch'),
      luck: [...played].sort((x, y) => y.winsAboveExpectation - x.winsAboveExpectation).slice(0, 5).map((t) => ({ team: t.team, value: t.winsAboveExpectation })),
      unlucky: [...played].sort((x, y) => x.winsAboveExpectation - y.winsAboveExpectation).slice(0, 5).map((t) => ({ team: t.team, value: t.winsAboveExpectation }))
    },
    upsets,
    bracket: { rounds: bracketRounds, champion },
    distributions: {
      allianceScores: histogram(allianceScores, 20),
      margins: histogram(signedMargins, 10),
      close: absMargins.filter((m) => m <= 5).length,
      blowouts: absMargins.filter((m) => m >= 25).length,
      medianMargin: round(quantile(absMargins, 0.5), 1)
    },
    archetypes: {
      clusters: archetypes.clusters,
      teams: [...archetypes.teams.values()]
    },
    quality
  }
}

export function matchList(sku) {
  const a = analysis(sku)
  if (!a) return null
  const media = new Map(a.media.map((m) => [m.match_key, m]))
  const tagged = new Map(
    db
      .all('SELECT match_key, COUNT(*) AS c FROM score_events WHERE match_key LIKE ? GROUP BY match_key', `${sku}::%`)
      .map((r) => [r.match_key, r.c])
  )
  return a.ratings.matches.map((m) => {
    const al = teamsOf(m)
    const w = winnerOf(m)
    const pRed = m.pRed ?? 0.5
    return {
      key: m.match_key,
      round: m.round,
      roundLabel: roundLabel(m.round),
      division: m.division,
      instance: m.instance,
      matchnum: m.matchnum,
      field: m.field,
      scheduled: m.scheduled,
      red: al.red,
      blue: al.blue,
      redScore: m.red_score,
      blueScore: m.blue_score,
      scored: isScored(m),
      winner: w,
      margin: m.red_score != null && m.blue_score != null ? m.red_score - m.blue_score : null,
      pRed: round(pRed, 3),
      upset: w && w !== 'tie' ? (w === 'red' ? pRed < 0.4 : pRed > 0.6) : false,
      projected: { muRed: round(m.muRed, 1), muBlue: round(m.muBlue, 1), margin: round(m.projectedMargin, 1) },
      breakdown: m.red_auto != null,
      media: media.get(m.match_key) || null,
      tagged: tagged.get(m.match_key) || 0,
      video: m.video || null
    }
  })
}

export function matchDetail(sku, key) {
  const a = analysis(sku)
  if (!a) return null
  const m = a.ratings.matches.find((x) => x.match_key === key)
  if (!m) return null
  const al = teamsOf(m)
  const attribution = attributeMatch(m, a.ratings)
  const events = db.listScoreEvents(key)
  const mediaRow = a.media.find((x) => x.match_key === key) || null
  const video = mediaRow ? a.videos.find((v) => v.id === mediaRow.video_id) || null : null
  const wpa = wpaTimeline({
    events,
    finalRed: m.red_score,
    finalBlue: m.blue_score,
    sigmaEnd: a.ratings.sigmaMargin
  })
  const card = (list) =>
    list.map((t) => {
      const s = a.ratings.teams.get(t) || {}
      return {
        team: t,
        name: s.name || null,
        avgPoints: s.avgPoints,
        floor: s.floor,
        ceiling: s.ceiling,
        elo: s.elo,
        opr: s.opr,
        archetype: a.archetypes.teams.get(t)?.archetype || null
      }
    })
  return {
    key,
    match: {
      ...m,
      red: al.red,
      blue: al.blue,
      winner: winnerOf(m)
    },
    teams: { red: card(al.red), blue: card(al.blue) },
    attribution,
    postMortem: matchPostMortem({ match: m, attribution, ratings: a.ratings }),
    wpa,
    scoreEvents: events,
    media: mediaRow,
    video,
    sigma: a.ratings.sigmaMargin
  }
}

export function teamView(sku, team, vs = null) {
  const a = analysis(sku)
  if (!a) return null
  const t = a.ratings.teams.get(team)
  // No match rows at all means nothing has been played here, so even though the roster gives
  // every number a rating entry, there is nothing to profile yet.
  if (!t || !a.ratings.matches.length) {
    // Registered but nothing played: the team lab still opens, with the roster row it has.
    const row = db.get('SELECT * FROM teams WHERE sku = ? AND number = ?', sku, team)
    if (!row) return null
    return {
      rosterOnly: true,
      team: { team: row.number, name: row.name, org: row.org, city: row.city, region: row.region, country: row.country, grade: row.grade },
      matches: [],
      notes: [`${row.number} is registered here, but no matches have been played yet. Its season comes from previous tournaments.`]
    }
  }
  const style = a.archetypes.teams.get(team) || null
  const prescription = prescribe(team, a.ratings)
  const briefing = teamBriefing({ team, ratings: a.ratings, prescription, styleEntry: style })
  const played = a.ratings.matches.filter((m) => {
    const al = teamsOf(m)
    return al.red.includes(team) || al.blue.includes(team)
  })

  const field = a.ratings.list.filter((x) => x.matches > 0)
  const pct = (key, dir = 'desc') => {
    const v = key === 'skillsProg' ? t.skills?.prog : key === 'skillsDriver' ? t.skills?.driver : t[key]
    if (v == null) return null
    const vals = field.map((x) => (key === 'skillsProg' ? x.skills?.prog : key === 'skillsDriver' ? x.skills?.driver : x[key])).filter((z) => z != null)
    if (vals.length < 5) return null
    const better = vals.filter((z) => (dir === 'desc' ? z < v : z > v)).length
    return round(better / vals.length, 3)
  }

  const partnerMu = quantile(field.map((x) => x.mu), 0.5)
  const h2h = vs
    ? played.filter((m) => {
        const al = teamsOf(m)
        return [...al.red, ...al.blue].includes(vs)
      })
    : []
  const sim = vs
    ? simulateMatchup({
        muA: t.mu + partnerMu,
        muB: (a.ratings.teams.get(vs)?.mu ?? a.ratings.eventMean) + partnerMu,
        sigmaA: Math.sqrt((t.sdPoints ?? 12) ** 2 + 12 ** 2),
        sigmaB: Math.sqrt(((a.ratings.teams.get(vs)?.sdPoints ?? 12) ** 2) + 12 ** 2),
        n: 5000
      })
    : null

  return {
    team: t,
    style,
    prescription,
    briefing,
    percentiles: {
      avgPoints: pct('avgPoints'),
      floor: pct('floor'),
      ceiling: pct('ceiling'),
      autonPerMatch: pct('autonPerMatch'),
      penaltyPerMatch: pct('penaltyPerMatch', 'asc'),
      cv: pct('cv', 'asc'),
      skillsProg: pct('skillsProg'),
      skillsDriver: pct('skillsDriver'),
      elo: pct('elo')
    },
    matches: played.map((m) => {
      const al = teamsOf(m)
      const own = al.red.includes(team) ? 'red' : 'blue'
      const other = own === 'red' ? 'blue' : 'red'
      const ownScore = own === 'red' ? m.red_score : m.blue_score
      const oppScore = own === 'red' ? m.blue_score : m.red_score
      return {
        key: m.match_key,
        round: m.round,
        roundLabel: roundLabel(m.round),
        matchnum: m.matchnum,
        scheduled: m.scheduled,
        side: own,
        own: al[own],
        opp: al[other],
        ownScore,
        oppScore,
        won: ownScore != null && oppScore != null ? ownScore > oppScore : null,
        pWin: round(own === 'red' ? m.pRed ?? 0.5 : 1 - (m.pRed ?? 0.5), 3),
        projected: own === 'red' ? round(m.muRed, 1) : round(m.muBlue, 1)
      }
    }),
    vs: vs ? { team: vs, sim, h2h: h2h.map((m) => ({ key: m.match_key, red: teamsOf(m).red, blue: teamsOf(m).blue, redScore: m.red_score, blueScore: m.blue_score })) } : null,
    attack: vs ? attackVectors({ opponentNumber: vs, ownNumber: team, ratings: a.ratings, archetypes: a.archetypes }) : null,
    counterable: attackVectors({ opponentNumber: team, ownNumber: vs, ratings: a.ratings, archetypes: a.archetypes })
  }
}

export function opponentView(sku, team, own = null) {
  const a = analysis(sku)
  if (!a) return null
  const t = a.ratings.teams.get(team)
  if (!t) return null
  const style = a.archetypes.teams.get(team) || null
  const attack = attackVectors({ opponentNumber: team, ownNumber: own, ratings: a.ratings, archetypes: a.archetypes })
  if (!attack) return null
  const played = a.ratings.matches.filter((m) => {
    const al = teamsOf(m)
    return al.red.includes(team) || al.blue.includes(team)
  })
  return {
    team: t,
    style,
    tendencies: style?.tendencies || null,
    metrics: metricsFor(t, style),
    attack,
    briefing: teamBriefing({ team, ratings: a.ratings, styleEntry: style }),
    matches: played.slice(-10).map((m) => {
      const al = teamsOf(m)
      const ownSide = al.red.includes(team) ? 'red' : 'blue'
      const other = ownSide === 'red' ? 'blue' : 'red'
      return {
        key: m.match_key,
        round: m.round,
        roundLabel: roundLabel(m.round),
        matchnum: m.matchnum,
        side: ownSide,
        own: al[ownSide],
        opp: al[other],
        ownScore: ownSide === 'red' ? m.red_score : m.blue_score,
        oppScore: ownSide === 'red' ? m.blue_score : m.red_score
      }
    })
  }
}

const whenOf = (m) => {
  const v = Date.parse(m.scheduled || '')
  return Number.isNaN(v) ? Number.POSITIVE_INFINITY : v
}

/**
 * Onsite view: the same model, read while standing in the pit instead of after the fact.
 *
 * One row per match this team plays, in scheduled order, each carrying its alliance, the
 * counters that fire against every opponent on the other side, and the alliance-level roles
 * those counters imply. Unplayed matches are projections; played ones keep the plan next to
 * the result, because "what we meant to do" is the only useful review of a match you just
 * walked away from.
 */
export function onsiteView(sku, team) {
  const a = analysis(sku)
  if (!a) return null
  const t = a.ratings.teams.get(team)
  if (!t || !a.ratings.matches.length) {
    // Upcoming event: there is no schedule to project, so the tab shows the team's season
    // instead of inventing matchups that have not been drawn.
    const row = db.get('SELECT * FROM teams WHERE sku = ? AND number = ?', sku, team)
    if (!row) return null
    return {
      rosterOnly: true,
      event: a.event,
      team: { team: row.number, name: row.name, org: row.org, city: row.city, region: row.region, country: row.country, grade: row.grade },
      counts: { matches: 0, played: 0, upcoming: 0 },
      nextKey: null,
      matches: [],
      notes: [`Nothing is scheduled at ${a.event.name} yet — the match list appears once the event publishes its schedule.`]
    }
  }
  const style = a.archetypes.teams.get(team) || null
  const prescription = prescribe(team, a.ratings)
  const briefing = teamBriefing({ team, ratings: a.ratings, prescription, styleEntry: style })

  const cardOf = (num) => {
    const s = a.ratings.teams.get(num) || null
    return {
      team: num,
      name: s?.name || null,
      archetype: a.archetypes.teams.get(num)?.archetype || null,
      avgPoints: s?.avgPoints != null ? round(s.avgPoints, 1) : null,
      floor: s?.floor != null ? round(s.floor, 1) : null,
      ceiling: s?.ceiling != null ? round(s.ceiling, 1) : null,
      elo: s?.elo ?? null,
      opr: s?.opr != null ? round(s.opr, 1) : null,
      matches: s?.matches ?? 0
    }
  }

  const mine = a.ratings.matches
    .filter((m) => {
      const al = teamsOf(m)
      return al.red.includes(team) || al.blue.includes(team)
    })
    .sort((x, y) => whenOf(x) - whenOf(y) || Number(x.round) - Number(y.round) || Number(x.matchnum) - Number(y.matchnum))

  const rows = mine.map((m) => {
    const al = teamsOf(m)
    const own = al.red.includes(team) ? 'red' : 'blue'
    const other = own === 'red' ? 'blue' : 'red'
    const scored = isScored(m)
    const ownScore = own === 'red' ? m.red_score : m.blue_score
    const oppScore = own === 'red' ? m.blue_score : m.red_score
    const muOwn = round(sum(al[own].map((x) => a.ratings.teams.get(x)?.mu ?? a.ratings.eventMean)), 1)
    const muOpp = round(sum(al[other].map((x) => a.ratings.teams.get(x)?.mu ?? a.ratings.eventMean)), 1)
    // pRed is only set for matches that have been played, and it is always red-vs-blue, so it
    // needs the side flip. For an unplayed match, ask the score model directly: pFromScores
    // already answers "does the first alliance win", so flipping it here would double-count.
    const pOwn =
      m.pRed != null
        ? round(own === 'red' ? m.pRed : 1 - m.pRed, 3)
        : round(pFromScores(muOwn, muOpp, a.ratings.sigmaMargin), 3)
    const sim = simulateAlliances({ teamsA: al[own], teamsB: al[other], ratings: a.ratings, n: 2500 })

    const counters = al[other].map((opp) => {
      const av = attackVectors({ opponentNumber: opp, ownNumber: team, ratings: a.ratings, archetypes: a.archetypes })
      return {
        ...cardOf(opp),
        winProb: av?.winProb ?? null,
        winProbWithPlan: av?.winProbWithPlan ?? null,
        swingPoints: av?.swingPoints ?? null,
        top: (av?.top || []).slice(0, 2).map((v) => ({
          id: v.id,
          title: v.title,
          action: v.action,
          trigger: v.trigger,
          roles: v.roles || [],
          confidence: v.confidence,
          expectedPoints: v.expectedPoints,
          metric: v.metric,
          observed: v.observed
        }))
      }
    })
  
    const partners = al[own]
      .filter((x) => x !== team)
      .map((x) => {
        const p = cardOf(x)
        const stronger = p.avgPoints != null && t.avgPoints != null && p.avgPoints > t.avgPoints
        return {
          ...p,
          role: stronger ? 'primary scorer' : 'support / second scorer',
          note: stronger
            ? `Higher average than us (${p.avgPoints} vs ${round(t.avgPoints, 1)}) — keep their cycle clean and stay out of their lane.`
            : `Second scorer at ${p.avgPoints ?? 'n/a'} avg — give them the open lane and take the defensive half.`
        }
      })

    const roles = [...new Set(counters.flatMap((c) => c.top.flatMap((v) => v.roles || [])))]
    const plan = [
      {
        kind: 'model',
        text: `Projection ${muOwn} vs ${muOpp} — ${Math.round((sim.pA ?? pOwn) * 100)}% to win, most likely ${sim.mostLikely?.a}–${sim.mostLikely?.b}.`
      }
    ]
    for (const c of counters) {
      for (const v of c.top) plan.push({ kind: 'counter', team: c.team, confidence: v.confidence, text: `${v.title} — ${v.action}` })
    }
    if (roles.length) plan.push({ kind: 'role', text: `Alliance roles: ${roles.join(' · ')}.` })
    for (const p of partners) plan.push({ kind: 'partner', team: p.team, text: p.note })

    return {
      key: m.match_key,
      round: m.round,
      roundLabel: roundLabel(m.round),
      matchnum: m.matchnum,
      division: m.division,
      field: m.field,
      scheduled: m.scheduled,
      when: Number.isFinite(whenOf(m)) ? whenOf(m) : null,
      side: own,
      partners,
      opponents: al[other].map(cardOf),
      counters,
      roles,
      plan,
      pOwn,
      muOwn,
      muOpp,
      sim: {
        pA: sim.pA,
        pB: sim.pB,
        mostLikely: sim.mostLikely,
        margin: sim.margin,
        scoreA: sim.scoreA,
        scoreB: sim.scoreB
      },
      scored,
      ownScore,
      oppScore,
      won: scored ? ownScore > oppScore : null
    }
  })

  const pending = rows.filter((r) => !r.scored)
  const now = Date.now()
  const nextRow = pending.find((r) => r.when != null && r.when >= now) || pending[0] || null

  return {
    event: a.event,
    team: cardOf(team),
    style,
    briefing,
    prescription: prescription
      ? {
          baselineWinProb: prescription.baselineWinProb,
          summary: prescription.summary,
          caveat: prescription.caveat,
          note: prescription.note || null,
          dims: (prescription.dims || []).slice(0, 3)
        }
      : null,
    counts: { matches: rows.length, played: rows.filter((r) => r.scored).length, upcoming: pending.length },
    nextKey: nextRow?.key || null,
    matches: rows,
    notes: [
      rows.length ? null : `No matches for ${team} in this event yet.`,
      rows.length && !pending.length ? 'Every match this team played is already scored — use the post-event tabs to review them.' : null
    ].filter(Boolean)
  }
}

/**
 * Simulation view: one team against every other team in the event.
 *
 * This is the onsite matchup model run for the whole field at once, so the answer to "who do we
 * need to prepare for" is a ranked list rather than a hunch. Each row carries the same numbers
 * the team lab shows for a single matchup: win probability, projected score, margin band and the
 * counters that fire against that opponent.
 *
 * The simulation needs a hypothetical partner for both alliances, so both sides are padded with
 * the field's median ally. That is stated in `model` and in the notes, because it flatters a
 * strong team less than assuming the best partner and is never a real bracket.
 */
export function simulateView(sku, team) {
  const a = analysis(sku)
  if (!a) return null
  const t = a.ratings.teams.get(team)
  // Nothing to simulate when the event has no results, or when this team never played in it:
  // a rating entry with zero matches would otherwise be simulated as if it were real form.
  if (!t || t.matches === 0 || !a.ratings.matches.length) {
    const row = db.get('SELECT * FROM teams WHERE sku = ? AND number = ?', sku, team)
    if (!row) return null
    return {
      rosterOnly: true,
      event: a.event,
      team: { team: row.number, name: row.name, org: row.org, city: row.city, region: row.region, country: row.country },
      counts: { opponents: 0, easy: 0, favorable: 0, even: 0, tough: 0, threat: 0 },
      opponents: [],
      watchlist: [],
      gifts: [],
      notes: [
        a.ratings.matches.length
          ? `${row.number} has no matches at ${a.event.name} yet, so there is nothing to simulate. Its team lab shows its previous tournaments.`
          : `${a.event.name} has no scored matches yet, so there is nothing to simulate against. The team lab and onsite tab show this team's previous tournaments.`
      ]
    }
  }

  const r1 = (v) => (v == null ? null : round(v, 1))
  const sigma = a.ratings.sigmaMargin
  const partnerSd = 12
  const field = a.ratings.list.filter((x) => x.matches > 0 && x.team !== team)
  const partnerMu = field.length ? quantile(field.map((x) => x.mu), 0.5) : a.ratings.eventMean
  const ownCard = (num) => {
    const s = a.ratings.teams.get(num) || null
    return {
      team: num,
      name: s?.name || null,
      archetype: a.archetypes.teams.get(num)?.archetype || null,
      elo: s?.elo ?? null,
      opr: r1(s?.opr),
      avgPoints: r1(s?.avgPoints),
      floor: r1(s?.floor),
      ceiling: r1(s?.ceiling),
      sdPoints: r1(s?.sdPoints),
      matches: s?.matches ?? 0,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      winRate: s?.winRate != null ? round(s.winRate, 3) : null,
      rank: s?.rank ?? null
    }
  }

  const h2hOf = (other) => {
    const rows = a.ratings.matches.filter((m) => {
      const al = teamsOf(m)
      return (al.red.includes(team) && al.blue.includes(other)) || (al.blue.includes(team) && al.red.includes(other))
    })
    const mapped = rows.map((m) => {
      const al = teamsOf(m)
      const ownSide = al.red.includes(team) ? 'red' : 'blue'
      const otherSide = ownSide === 'red' ? 'blue' : 'red'
      const ownScore = ownSide === 'red' ? m.red_score : m.blue_score
      const oppScore = ownSide === 'red' ? m.blue_score : m.red_score
      return {
        key: m.match_key,
        roundLabel: roundLabel(m.round),
        matchnum: m.matchnum,
        own: ownScore,
        opp: oppScore,
        won: ownScore != null && oppScore != null ? ownScore > oppScore : null
      }
    })
    const played = mapped.filter((m) => m.won != null)
    return { played: played.length, wins: played.filter((m) => m.won).length, losses: played.filter((m) => !m.won).length, matches: mapped.slice(-5) }
  }

  const rows = field.map((o) => {
    const sim = simulateMatchup({
      muA: t.mu + partnerMu,
      muB: o.mu + partnerMu,
      sigmaA: Math.sqrt((t.sdPoints ?? partnerSd) ** 2 + partnerSd ** 2),
      sigmaB: Math.sqrt((o.sdPoints ?? partnerSd) ** 2 + partnerSd ** 2),
      n: 2000
    })
    const av = attackVectors({ opponentNumber: o.team, ownNumber: team, ratings: a.ratings, archetypes: a.archetypes })
    const p = sim.pA
    const tier = p >= 0.7 ? 'easy' : p >= 0.58 ? 'favorable' : p >= 0.42 ? 'even' : p >= 0.3 ? 'tough' : 'threat'
    return {
      ...ownCard(o.team),
      record: { wins: o.wins ?? 0, losses: o.losses ?? 0, ties: o.ties ?? 0 },
      sos: o.sos ?? null,
      mu: r1(o.mu),
      p: round(p, 4),
      modelP: sim.modelP,
      tier,
      projected: sim.mostLikely,
      margin: r1(sim.margin.p50),
      band: { own: sim.scoreA, opp: sim.scoreB },
      plan: av
        ? {
            winProb: av.winProb,
            winProbWithPlan: av.winProbWithPlan,
            deltaP: av.deltaP,
            swingPoints: av.swingPoints,
            top: (av.top || []).slice(0, 2).map((v) => ({
              id: v.id,
              title: v.title,
              action: v.action,
              trigger: v.trigger,
              confidence: v.confidence,
              expectedPoints: v.expectedPoints
            }))
          }
        : null,
      h2h: h2hOf(o.team)
    }
  })

  // Hardest first: the point of the tab is to find the problems, not to admire the easy draws.
  rows.sort((x, y) => x.p - y.p || y.elo - x.elo)
  const byTier = (name) => rows.filter((r) => r.tier === name)
  const meanP = rows.length ? mean(rows.map((r) => r.p)) : null

  return {
    event: a.event,
    team: ownCard(team),
    style: a.archetypes.teams.get(team) || null,
    model: {
      sigmaMargin: sigma,
      eventMean: a.ratings.eventMean,
      partnerMu: r1(partnerMu),
      partnerSd,
      simulations: 2000,
      calibration: a.ratings.calibration
    },
    counts: {
      opponents: rows.length,
      easy: byTier('easy').length,
      favorable: byTier('favorable').length,
      even: byTier('even').length,
      tough: byTier('tough').length,
      threat: byTier('threat').length
    },
    edge: {
      meanP: meanP == null ? null : round(meanP, 3),
      expectedWins: meanP == null ? null : round(meanP * rows.length, 1),
      hardest: rows[0]?.team || null,
      easiest: rows[rows.length - 1]?.team || null,
      examplePartner: r1(partnerMu)
    },
    watchlist: rows.filter((r) => r.tier === 'threat' || r.tier === 'tough').slice(0, 8),
    gifts: [...rows].filter((r) => r.tier === 'easy' || r.tier === 'favorable').sort((x, y) => y.p - x.p).slice(0, 8),
    opponents: rows,
    distribution: histogram(rows.map((r) => r.p), 0.1),
    notes: [
      `Every opponent was simulated 2,000 times with a median ally (${r1(partnerMu)} pts) added to both sides, so this is matchup strength rather than a predicted bracket.`,
      `Win probabilities come from the same model as the onsite tab, with the field spread σ = ${sigma}.`,
      `Sample sizes differ per team: ${rows.length} opponents, from ${Math.min(...rows.map((r) => r.matches))} to ${Math.max(...rows.map((r) => r.matches))} matches each.`
    ]
  }
}

export function metaView(sku) {
  const a = analysis(sku)
  if (!a) return null
  const { ratings, archetypes } = a
  const field = ratings.list.filter((t) => t.matches > 0)
  const top = [...field].sort((x, y) => y.elo - x.elo).slice(0, 18)

  const matrix = top.map((row) => ({
    team: row.team,
    cells: top.map((col) => {
      if (row.team === col.team) return null
      return round(pFromScores(row.mu, col.mu, ratings.sigmaMargin), 3)
    })
  }))

  const correlations = [
    { label: 'Average points vs win rate', ...correlate(field, 'avgPoints', 'winRate') },
    { label: 'Autonomous vs win rate', ...correlate(field, 'autonPerMatch', 'winRate') },
    { label: 'Floor vs win rate', ...correlate(field, 'floor', 'winRate') },
    { label: 'Ceiling vs win rate', ...correlate(field, 'ceiling', 'winRate') },
    { label: 'Penalties vs win rate', ...correlate(field, 'penaltyPerMatch', 'winRate') },
    { label: 'Programming skills vs win rate', ...correlate(field.map((t) => ({ ...t, skillsProg: t.skills?.prog })), 'skillsProg', 'winRate') }
  ].filter((c) => c.r != null)

  const byArchetype = archetypes.clusters.map((c) => {
    const members = c.members.map((m) => ratings.teams.get(m)).filter((t) => t && t.matches > 0)
    return {
      label: c.label,
      size: members.length,
      avgPoints: round(mean(members.map((t) => t.avgPoints)), 1),
      winRate: round(mean(members.map((t) => t.winRate)), 3),
      avgElo: round(mean(members.map((t) => t.elo)), 0),
      members: c.members
    }
  })

  return {
    clusters: archetypes.clusters,
    archetypePerformance: byArchetype,
    matrix: { teams: top.map((t) => t.team), rows: matrix, sigma: ratings.sigmaMargin },
    correlations,
    calibration: ratings.calibration,
    distributions: summary(sku)?.distributions || null,
    counts: { teams: field.length, matches: ratings.matches.filter(isScored).length }
  }
}
