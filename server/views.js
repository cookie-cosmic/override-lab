// View assembly: turns engine output into exactly what each screen needs.
import { analysis } from './analytics.js'
import * as db from './db.js'
import { teamsOf, isScored } from './engine/ratings.js'
import { attributeMatch } from './engine/attribution.js'
import { wpaTimeline, pFromScores } from './engine/winprob.js'
import { prescribe } from './engine/prescribe.js'
import { attackVectors, metricsFor, planFromVectors, vectorsFromMetrics } from './engine/counters.js'
import { aggregateWeaknesses, eventWeaknesses, fieldBaseline, historyWeaknesses, topWeaknesses } from './engine/weakness.js'
import { teamHistory } from './history.js'
import { teamBriefing, matchPostMortem, eventDigest } from './engine/narrative.js'
import { simulateAlliances, simulateMatchup } from './engine/sim.js'
import { round, sum, mean, quantile, pctRank, isElimRound, roundLabel } from './util.js'

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
    quality,
    // A running event has a schedule before it has a single score. Says so instead of
    // pretending the empty leaderboards mean an empty field.
    noScores: scored.length === 0,
    notes: scored.length
      ? []
      : [`${event.name} has matches on the schedule but no final scores yet — simulation and counters fall back to each team's season until the first result lands.`]
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
        muA: t.mu + 2 * partnerMu,
        muB: (a.ratings.teams.get(vs)?.mu ?? a.ratings.eventMean) + 2 * partnerMu,
        sigmaA: Math.sqrt((t.sdPoints ?? 12) ** 2 + 2 * 12 ** 2),
        sigmaB: Math.sqrt(((a.ratings.teams.get(vs)?.sdPoints ?? 12) ** 2) + 2 * 12 ** 2),
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

// ---- opponent & counters --------------------------------------------------------------
//
// One opponent, read deeply from whichever evidence exists:
//  - event mode: the matches it played here (ratings, percentiles, form, head-to-head), or
//  - conceptual mode: its season at the tournaments before this one, so the counter sheet is
//    usable in the pit before the event has produced a single score.
//
// Both paths end in the same shape: strengths, weaknesses, every rule that fired, a plan with
// its expected point swing, and a simulated score distribution against your team.

const RATING_PCT = [
  { key: 'avgPoints', label: 'average points', dir: 'desc', unit: 'pts per match' },
  { key: 'floor', label: 'floor', dir: 'desc', unit: 'pts' },
  { key: 'ceiling', label: 'ceiling', dir: 'desc', unit: 'pts' },
  { key: 'autonPerMatch', label: 'autonomous', dir: 'desc', unit: 'auton pts' },
  { key: 'driverPerMatch', label: 'driver phase', dir: 'desc', unit: 'driver pts' },
  { key: 'penaltyPerMatch', label: 'penalty discipline', dir: 'asc', unit: 'penalty pts' },
  { key: 'clutch', label: 'elimination form', dir: 'desc', unit: 'pts' }
]

function percentileOf(team, field, key, dir = 'desc', pick = (t) => t[key]) {
  const v = pick(team)
  if (v == null) return null
  const vals = field.map(pick).filter((z) => z != null && Number.isFinite(z))
  if (vals.length < 4) return null
  // pctRank counts values below x, so for "lower is better" the rank flips.
  const better = dir === 'desc' ? pctRank(vals, v) : 1 - pctRank(vals, v)
  return round(better, 3)
}

function ratingStrengths(team, field) {
  const out = []
  for (const check of RATING_PCT) {
    const p = percentileOf(team, field, check.key, check.dir)
    const v = team[check.key]
    if (p == null || p < 0.75) continue
    out.push({
      id: check.key,
      label: check.label,
      detail: `${round(v, 1)} ${check.unit} — better than ${Math.round(p * 100)}% of the field`,
      percentile: p
    })
  }
  const prog = percentileOf(team, field, 'prog', 'desc', (t) => t.skills?.prog)
  if (prog != null && prog >= 0.75) {
    out.push({ id: 'prog', label: 'programming skills', detail: `${round(team.skills?.prog, 0)} pts — top quarter of the field`, percentile: prog })
  }
  return out.sort((x, y) => y.percentile - x.percentile)
}

/** The same metric names the counter rules use, read from a season instead of an event. */
function historyMetrics(h) {
  if (!h) return {}
  return {
    avgPoints: h.avgScore,
    floor: h.floor,
    ceiling: h.ceiling,
    spread: h.floor != null && h.ceiling != null ? round(h.ceiling - h.floor, 1) : null,
    cv: h.cv,
    consistency: h.cv != null ? round(1 - h.cv, 3) : null,
    winRate: h.winRate,
    avgMargin: h.avgMargin,
    matches: h.matches,
    autonPerMatch: null,
    driverPerMatch: null,
    penaltyPerMatch: null,
    clutch: null,
    rank: null,
    opr: null,
    elo: null
  }
}

function seasonStrengths(h) {
  if (!h || !h.matches) return []
  const out = []
  if (h.winRate != null && h.winRate >= 0.6) {
    out.push({ id: 'record', label: 'winning season', detail: `${h.wins}–${h.losses}${h.ties ? `–${h.ties}` : ''} across ${h.matches} matches`, percentile: null })
  }
  if (h.avgScore != null && h.avgScore >= 120) {
    out.push({ id: 'scoring', label: 'puts points on the board', detail: `${round(h.avgScore, 0)} pts per match`, percentile: null })
  }
  if (h.ceiling != null && h.ceiling >= 180) {
    out.push({ id: 'ceiling', label: 'explosive ceiling', detail: `${round(h.ceiling, 0)} pts at the 90th percentile`, percentile: null })
  }
  if (h.floor != null && h.floor >= 110) {
    out.push({ id: 'floor', label: 'reliable floor', detail: `rarely drops below ${round(h.floor, 0)} pts`, percentile: null })
  }
  if (h.cv != null && h.cv <= 0.22) {
    out.push({ id: 'consistency', label: 'consistent scorer', detail: `spread is only ${Math.round(h.cv * 100)}% of its average`, percentile: null })
  }
  const form = (h.form || []).filter((g) => g.won != null)
  if (form.length >= 4 && form.slice(0, 4).filter((g) => g.won).length >= 3) {
    out.push({ id: 'form', label: 'in form right now', detail: `${form.slice(0, 4).filter((g) => g.won).length} wins in the last four`, percentile: null })
  }
  return out
}

function planSteps(attack) {
  if (!attack?.top?.length) return []
  const top = attack.top
  const hasTag = (v, re) => (v.tags || []).some((t) => re.test(t))
  const auton = top.find((v) => hasTag(v, /auton|early/i))
  const end = top.find((v) => hasTag(v, /endgame|climb|park|late/i))
  const main = top.find((v) => v !== auton && v !== end)
  const steps = []
  if (auton) steps.push({ phase: 'autonomous', text: `${auton.title} — ${auton.action}`, points: auton.expectedPoints })
  if (main) steps.push({ phase: 'driver', text: `${main.title} — ${main.action}`, points: main.expectedPoints })
  if (end) steps.push({ phase: 'endgame', text: `${end.title} — ${end.action}`, points: end.expectedPoints })
  for (const v of top) {
    if ([auton, main, end].includes(v)) continue
    steps.push({ phase: 'if it stalls', text: `${v.title} — ${v.action}`, points: v.expectedPoints })
  }
  return steps
}

function simAgainst({ oppMu, ownMu, oppSd, ownSd, partnerSd = 12, basis }) {
  if (oppMu == null || ownMu == null) return null
  // A is the opponent, B is your alliance, so pB is your win probability.
  const sim = simulateMatchup({
    muA: oppMu + 0,
    muB: ownMu + 0,
    sigmaA: Math.sqrt((oppSd ?? partnerSd) ** 2 + partnerSd ** 2),
    sigmaB: Math.sqrt((ownSd ?? partnerSd) ** 2 + partnerSd ** 2),
    n: 4000
  })
  return {
    basis,
    oppWinProb: sim.pA,
    ownWinProb: sim.pB,
    tieRate: sim.tieRate,
    mostLikely: { opp: sim.mostLikely.a, own: sim.mostLikely.b },
    bands: { opp: sim.scoreA, own: sim.scoreB },
    margin: sim.margin,
    samples: sim.samples
  }
}

function h2hRows(a, team, other) {
  if (!other) return null
  const rows = a.ratings.matches.filter((m) => {
    const al = teamsOf(m)
    return (al.red.includes(team) && al.blue.includes(other)) || (al.blue.includes(team) && al.red.includes(other))
  })
  const played = rows.filter(isScored)
  const wins = played.filter((m) => {
    const al = teamsOf(m)
    const teamRed = al.red.includes(team)
    return teamRed ? m.red_score > m.blue_score : m.blue_score > m.red_score
  }).length
  return {
    team,
    other,
    played: played.length,
    wins,
    losses: played.length - wins,
    matches: rows.map((m) => {
      const al = teamsOf(m)
      const teamRed = al.red.includes(team)
      return {
        key: m.match_key,
        roundLabel: roundLabel(m.round),
        matchnum: m.matchnum,
        teamScore: teamRed ? m.red_score : m.blue_score,
        otherScore: teamRed ? m.blue_score : m.red_score,
        won: isScored(m) ? (teamRed ? m.red_score > m.blue_score : m.blue_score > m.red_score) : null
      }
    })
  }
}

/** One opponent, from this event's completed matches. */
function eventOpponent(a, team, own) {
  const t = a.ratings.teams.get(team)
  const field = a.ratings.list.filter((x) => x.matches > 0)
  const style = a.archetypes.teams.get(team) || null
  const metrics = metricsFor(t, style)
  const baseline = fieldBaseline(a.ratings.list)
  const attack = attackVectors({ opponentNumber: team, ownNumber: own, ratings: a.ratings, archetypes: a.archetypes })
  const weaknesses = topWeaknesses(eventWeaknesses(t, { vectors: attack?.top || [], baseline }), 6)

  const played = a.ratings.matches.filter((m) => {
    const al = teamsOf(m)
    return al.red.includes(team) || al.blue.includes(team)
  })
  const results = played
    .map((m) => {
      const al = teamsOf(m)
      const side = al.red.includes(team) ? 'red' : 'blue'
      const other = side === 'red' ? 'blue' : 'red'
      const ownScore = side === 'red' ? m.red_score : m.blue_score
      const oppScore = side === 'red' ? m.blue_score : m.red_score
      return {
        key: m.match_key,
        round: m.round,
        roundLabel: roundLabel(m.round),
        matchnum: m.matchnum,
        side,
        alliance: al[side],
        opponents: al[other],
        ownScore,
        oppScore,
        won: ownScore != null && oppScore != null ? ownScore > oppScore : null,
        scheduled: m.scheduled
      }
    })
    .sort((x, y) => (Date.parse(y.scheduled || 0) || 0) - (Date.parse(x.scheduled || 0) || 0))

  const ownTeam = own ? a.ratings.teams.get(own) : null
  const ownStyle = own ? a.archetypes.teams.get(own) : null
  const ownMetrics = ownTeam ? metricsFor(ownTeam, ownStyle) : null
  const partner = field.length ? quantile(field.map((x) => x.mu), 0.5) : a.ratings.eventMean
  const sim = ownTeam
    ? simAgainst({
        oppMu: t.mu + 2 * partner,
        ownMu: ownTeam.mu + 2 * partner,
        oppSd: t.sdPoints,
        ownSd: ownTeam.sdPoints,
        basis: 'event'
      })
    : null

  return {
    mode: 'event',
    event: a.event,
    team: { ...t, record: { wins: t.wins, losses: t.losses, ties: t.ties } },
    style,
    tendencies: style?.tendencies || null,
    metrics,
    ownMetrics,
    percentiles: {
      avgPoints: percentileOf(t, field, 'avgPoints'),
      floor: percentileOf(t, field, 'floor'),
      ceiling: percentileOf(t, field, 'ceiling'),
      autonPerMatch: percentileOf(t, field, 'autonPerMatch'),
      penaltyPerMatch: percentileOf(t, field, 'penaltyPerMatch', 'asc'),
      cv: percentileOf(t, field, 'cv', 'asc'),
      elo: percentileOf(t, field, 'elo')
    },
    strengths: ratingStrengths(t, field),
    weaknesses,
    attack,
    plan: attack
      ? {
          winProb: attack.winProb,
          winProbWithPlan: attack.winProbWithPlan,
          deltaP: attack.deltaP,
          swingPoints: attack.swingPoints,
          steps: planSteps(attack),
          roles: attack.roles,
          triggers: attack.triggers
        }
      : null,
    sim,
    h2h: h2hRows(a, team, own),
    briefing: teamBriefing({ team, ratings: a.ratings, styleEntry: style }),
    results: results.slice(0, 12),
    matches: results.slice(0, 10).map((r) => ({
      key: r.key,
      roundLabel: r.roundLabel,
      matchnum: r.matchnum,
      own: r.alliance,
      opp: r.opponents,
      ownScore: r.ownScore,
      oppScore: r.oppScore
    })),
    notes: []
  }
}

/** One opponent, from its season before this event. */
async function conceptualOpponent(a, team, own, { token }) {
  const row = db.get('SELECT * FROM teams WHERE sku = ? AND number = ?', a.event.sku, team)
  const history = await teamHistory(team, { token }).catch(() => null)
  const name = history?.teamName || row?.name || null
  const base = {
    mode: 'conceptual',
    event: a.event,
    team: {
      team,
      name,
      avgPoints: history?.avgScore ?? null,
      floor: history?.floor ?? null,
      ceiling: history?.ceiling ?? null,
      cv: history?.cv ?? null,
      winRate: history?.winRate ?? null,
      elo: null,
      rank: null,
      clutch: null,
      matches: history?.matches ?? 0,
      wins: history?.wins ?? 0,
      losses: history?.losses ?? 0,
      ties: history?.ties ?? 0,
      record: { wins: history?.wins ?? 0, losses: history?.losses ?? 0, ties: history?.ties ?? 0 }
    },
    season: history || null,
    matches: [],
    results: [],
    h2h: null
  }

  if (!history || !history.matches) {
    return {
      ...base,
      noHistory: true,
      notes: [
        `${team} has no matches at ${a.event.name} yet and no readable ${a.event.season || 'current-season'} results, so there is no counter sheet to build.`,
        'Paste a RobotEvents key in the sidebar and its previous tournaments become available.'
      ]
    }
  }

  const metrics = historyMetrics(history)
  // Your own side: this event if it has played here, otherwise its own season.
  // Both sides must land on alliance-score units: an event rating is a per-team share, a
  // season profile already is an alliance average.
  const partnerShare = medianOf(a.ratings.list.filter((x) => x.matches > 0).map((x) => x.mu)) ?? 0
  let ownMetrics = null
  let ownMu = null
  let ownSd = null
  let ownSource = null
  if (own) {
    const r = a.ratings.teams.get(own)
    if (r && r.matches > 0) {
      ownMetrics = metricsFor(r, a.archetypes.teams.get(own))
      ownMu = r.mu + 2 * partnerShare
      ownSd = Math.sqrt((r.sdPoints ?? 12) ** 2 + 2 * 12 ** 2)
      ownSource = 'event'
    } else {
      const oh = await teamHistory(own, { token }).catch(() => null)
      if (oh && oh.matches) {
        ownMetrics = historyMetrics(oh)
        ownMu = oh.avgScore ?? 0
        ownSd = oh.sd ?? 18
        ownSource = 'season'
      }
    }
  }

  const vectors = vectorsFromMetrics(metrics, ownMetrics)
  // Two season distributions are wider than one event's residual spread, so with no results
  // here the spread has to come from the two teams themselves — 18 would call a 66-point gap
  // a certainty.
  const sigma = a.ratings.matches.some(isScored)
    ? a.ratings.sigmaMargin
    : Math.sqrt((history.sd ?? 30) ** 2 + (ownSd ?? 30) ** 2)
  const muOpp = history.avgScore ?? 0
  const attack = planFromVectors({
    vectors,
    oppMetrics: metrics,
    muOpp,
    muOwn: ownMu ?? muOpp,
    sigmaMargin: sigma,
    archetype: null
  })

  const sim =
    ownMu != null
      ? simAgainst({
          oppMu: muOpp,
          ownMu,
          oppSd: history.sd ?? 18,
          ownSd: ownSd ?? 18,
          basis: 'season'
        })
      : null

  return {
    ...base,
    metrics,
    ownMetrics,
    percentiles: null,
    strengths: seasonStrengths(history),
    weaknesses: topWeaknesses(historyWeaknesses(history, {}), 6),
    attack,
    plan: {
      winProb: ownMu != null ? attack.winProb : null,
      winProbWithPlan: ownMu != null ? attack.winProbWithPlan : null,
      deltaP: ownMu != null ? attack.deltaP : null,
      swingPoints: attack.swingPoints,
      steps: planSteps(attack),
      roles: attack.roles,
      triggers: attack.triggers
    },
    sim,
    ownSource,
    results: (history.form || []).map((g, i) => ({
      key: `season-${i}`,
      roundLabel: 'Season',
      matchnum: null,
      alliance: [],
      opponents: [],
      ownScore: g.own,
      oppScore: g.opp,
      won: g.won,
      eventName: g.eventName,
      scheduled: g.date
    })),
    events: history.events || [],
    notes: [
      `${team} has no completed matches at ${a.event.name} yet — this sheet is built from its ${a.event.season || 'current'} season: ${history.wins}–${history.losses}${history.ties ? `–${history.ties}` : ''} over ${history.matches} matches.`,
      'Rules that read autonomous, driver, penalty or clutch numbers cannot fire until the event scores matches; the coverage line below lists exactly what was missing.',
      ownMu != null
        ? `Win probability compares your ${ownSource === 'event' ? 'event' : 'season'} form with theirs, both with a median ally.`
        : 'Pick your team above to get a win probability and a simulated score.'
    ]
  }
}

export async function opponentView(sku, team, own = null, { token = null } = {}) {
  const a = analysis(sku)
  if (!a) return null
  const rating = a.ratings.teams.get(team)
  const registered = db.getTeams(sku).some((r) => String(r.number || '').trim().toUpperCase() === team)
  if (!rating && !registered) return null
  const playedHere = Boolean(rating && rating.matches > 0 && a.ratings.matches.some(isScored))
  return playedHere ? eventOpponent(a, team, own) : conceptualOpponent(a, team, own, { token })
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
/**
 * Simulation view: one team against every other team in the event.
 *
 * This is the onsite matchup model run for the whole field at once, so the answer to "who do we
 * need to prepare for" is a ranked list rather than a hunch. Each row carries the same numbers
 * the team lab shows for a single matchup: win probability, projected score, margin band, the
 * counters that fire against that opponent, and the weaknesses those counters exploit.
 *
 * Two modes, because an event that has not run has no results:
 *  - `event`      — this team has played here; everything comes from the event's own matches.
 *  - `conceptual` — nothing has been played yet (or not by this team); each team is described
 *                   by its current-season results at the tournaments it already attended.
 *                   Same thresholds, same simulation, clearly labelled basis.
 *
 * Both modes pad each alliance with the field's median ally, which is stated in `model` and in
 * the notes: it flatters a strong team less than assuming the best partner, and it is never a
 * prediction of a real bracket.
 */
const SIM_TIER = (p) => (p >= 0.7 ? 'easy' : p >= 0.58 ? 'favorable' : p >= 0.42 ? 'even' : p >= 0.3 ? 'tough' : 'threat')
const r1 = (v) => (v == null ? null : round(v, 1))
const upper = (v) => String(v ?? '').trim().toUpperCase()
const medianOf = (values) => {
  const vals = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b)
  return vals.length ? vals[Math.floor(vals.length / 2)] : null
}

const tierCounts = (rows) => ({
  opponents: rows.length,
  easy: rows.filter((r) => r.tier === 'easy').length,
  favorable: rows.filter((r) => r.tier === 'favorable').length,
  even: rows.filter((r) => r.tier === 'even').length,
  tough: rows.filter((r) => r.tier === 'tough').length,
  threat: rows.filter((r) => r.tier === 'threat').length
})

const finishRows = (rows) => {
  // Hardest first: the point of the tab is to find the problems, not to admire the easy draws.
  rows.sort((x, y) => x.p - y.p || (y.elo ?? 0) - (x.elo ?? 0))
  const meanP = rows.length ? mean(rows.map((r) => r.p)) : null
  return {
    rows,
    counts: tierCounts(rows),
    edge: {
      meanP: meanP == null ? null : round(meanP, 3),
      expectedWins: meanP == null ? null : round(meanP * rows.length, 1),
      hardest: rows[0]?.team || null,
      easiest: rows[rows.length - 1]?.team || null
    }
  }
}

export async function simulateView(sku, team, { token = null } = {}) {
  const a = analysis(sku)
  if (!a) return null
  const rosterRows = db.getTeams(sku)
  const rating = a.ratings.teams.get(team)
  const registered = rosterRows.some((r) => upper(r.number) === team)
  if (!rating && !registered) return null
  const scored = a.ratings.matches.filter(isScored)
  const playedHere = scored.length > 0 && (rating?.matches ?? 0) > 0
  return playedHere ? eventSimulation(a, team) : conceptualSimulation(a, team, rosterRows, { token })
}

/** Everything from this event's completed matches. */
function eventSimulation(a, team) {
  const t = a.ratings.teams.get(team)
  const sigma = a.ratings.sigmaMargin
  const partnerSd = 12
  const field = a.ratings.list.filter((x) => x.matches > 0 && x.team !== team)
  const partnerMu = field.length ? quantile(field.map((x) => x.mu), 0.5) : a.ratings.eventMean
  const baseline = fieldBaseline(a.ratings.list)
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
      ties: s?.ties ?? 0,
      winRate: s?.winRate != null ? round(s.winRate, 3) : null,
      rank: s?.rank ?? null,
      source: 'event'
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
      // Two median allies complete each alliance, so the projection is an alliance score
      // rather than a slice of one.
      muA: t.mu + 2 * partnerMu,
      muB: o.mu + 2 * partnerMu,
      sigmaA: Math.sqrt((t.sdPoints ?? partnerSd) ** 2 + 2 * partnerSd ** 2),
      sigmaB: Math.sqrt((o.sdPoints ?? partnerSd) ** 2 + 2 * partnerSd ** 2),
      n: 2000
    })
    const av = attackVectors({ opponentNumber: o.team, ownNumber: team, ratings: a.ratings, archetypes: a.archetypes })
    const all = eventWeaknesses(o, { vectors: av?.top || [], baseline })
    const p = sim.pA
    const tier = SIM_TIER(p)
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
      weaknesses: topWeaknesses(all, 5),
      weaknessCount: all.length,
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

  const { counts, edge } = finishRows(rows)

  return {
    event: a.event,
    mode: 'event',
    basis: `completed matches at ${a.event.name}`,
    team: { ...ownCard(team), record: { wins: t.wins, losses: t.losses, ties: t.ties } },
    style: a.archetypes.teams.get(team) || null,
    model: {
      sigmaMargin: sigma,
      eventMean: a.ratings.eventMean,
      partnerMu: r1(partnerMu),
      partnerSd,
      simulations: 2000,
      calibration: a.ratings.calibration,
      basis: 'event results'
    },
    counts,
    edge: { ...edge, examplePartner: r1(partnerMu) },
    watchlist: rows.filter((r) => r.tier === 'threat' || r.tier === 'tough').slice(0, 8),
    gifts: [...rows].filter((r) => r.tier === 'easy' || r.tier === 'favorable').sort((x, y) => y.p - x.p).slice(0, 8),
    opponents: rows,
    softSpots: aggregateWeaknesses(rows),
    distribution: histogram(rows.map((r) => r.p), 0.1),
    notes: [
      `Every opponent was simulated 2,000 times with two median allies (${r1(partnerMu)} pts each) added to both sides, so this is matchup strength rather than a predicted bracket.`,
      `Win probabilities come from the same model as the onsite tab, with the field spread σ = ${sigma}.`,
      `Sample sizes differ per team: ${rows.length} opponents, from ${Math.min(...rows.map((r) => r.matches))} to ${Math.max(...rows.map((r) => r.matches))} matches each.`,
      'Weaknesses are read from this event only: low floor, wide spread, penalty leakage, thin autonomous, a losing record, plus whatever the counter rules fired on.'
    ]
  }
}

/** Read season histories for the teams that have no usable event results. Cached by history.js. */
async function seasonHistories(numbers, token) {
  const out = new Map()
  const queue = [...new Set(numbers.filter(Boolean))]
  if (!queue.length) return out
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift()
      try {
        const h = await Promise.race([
          teamHistory(n, { token }),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('history timeout')), 12000)
            if (timer.unref) timer.unref()
          })
        ])
        if (h && h.matches) out.set(n, h)
      } catch {
        // A team with no readable season simply has no conceptual entry.
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
}

/**
 * Conceptual mode: the event has not produced results, so every number comes from what each
 * team has already done this season. It answers the same question — who is a problem, who is a
 * free win — from evidence that exists before the first qualification match.
 */
async function conceptualSimulation(a, team, rosterRows, { token }) {
  const names = new Map(rosterRows.map((r) => [upper(r.number), r.name || null]))
  const scoredHere = a.ratings.matches.some(isScored)
  const fromEvent = (n) => {
    const r = a.ratings.teams.get(n)
    return scoredHere && r && r.matches > 0 ? r : null
  }
  const numbers = [
    ...new Set([...rosterRows.map((r) => upper(r.number)), ...(scoredHere ? a.ratings.list.map((x) => x.team) : []), team].filter(Boolean))
  ]
  const opponents = numbers.filter((n) => n !== team)
  const needHistory = [team, ...opponents].filter((n) => !fromEvent(n))
  const history = await seasonHistories(needHistory, token)
  const ownEvent = fromEvent(team)
  const ownSeason = history.get(team) || null
  const sigma = a.ratings.sigmaMargin ?? 18

  // One scale for both sources: the score a team's alliance puts up. An event rating is a
  // per-team share, so it is completed with two median allies; a season profile is already an
  // alliance average. Without this, conceptual scores came out a third of the real thing.
  const eventPartner = medianOf(a.ratings.list.filter((x) => x.matches > 0).map((x) => x.mu)) ?? 0
  const allySd = 12
  const eventAlliance = (ev) => (ev ? ev.mu + 2 * eventPartner : null)
  const eventSd = (ev) => (ev ? Math.sqrt((ev.sdPoints ?? allySd) ** 2 + 2 * allySd ** 2) : null)

  const ownMu = ownEvent ? eventAlliance(ownEvent) : ownSeason?.avgScore ?? null
  const ownSd = ownEvent ? eventSd(ownEvent) : ownSeason?.sd ?? 18

  if (ownMu == null) {
    return {
      rosterOnly: true,
      mode: 'conceptual',
      needsHistory: true,
      event: a.event,
      team: { team, name: names.get(team) || null, source: 'roster' },
      roster: numbers.map((n) => ({ team: n, name: names.get(n) || null })),
      counts: { opponents: 0, easy: 0, favorable: 0, even: 0, tough: 0, threat: 0 },
      opponents: [],
      watchlist: [],
      gifts: [],
      softSpots: [],
      notes: [
        `${team} has no completed matches at ${a.event.name} yet and no readable ${a.event.season || 'current-season'} results, so there is nothing honest to simulate from.`,
        'Paste a RobotEvents key in the sidebar (it stays in your browser) and the previous tournaments become available; cached seasons need no key at all.'
      ]
    }
  }

  const fieldStats = opponents
    .map((n) => {
      const ev = fromEvent(n)
      const h = history.get(n) || null
      if (!ev && !h) return null
      return {
        n,
        ev,
        h,
        mu: ev ? eventAlliance(ev) : h.avgScore ?? null,
        sd: ev ? eventSd(ev) : h.sd ?? 18
      }
    })
    .filter((s) => s && s.mu != null)

  const allyShare = eventPartner
  const eventBaseline = fieldBaseline(a.ratings.list)
  const historyBaseline = fieldBaseline(
    fieldStats.map((s) => ({
      matches: s.h?.matches ?? 0,
      cv: s.h?.cv ?? null,
      floor: s.h?.floor ?? null,
      avgPoints: s.h?.avgScore ?? null,
      winRate: s.h?.winRate ?? null
    }))
  )
  const seasonBase = {
    ...historyBaseline,
    avgScore: medianOf(fieldStats.map((s) => s.h?.avgScore)),
    cv: medianOf(fieldStats.map((s) => s.h?.cv)),
    floor: medianOf(fieldStats.map((s) => s.h?.floor))
  }

  const rows = fieldStats.map(({ n, ev, h, mu, sd }) => {
    const sim = simulateMatchup({ muA: ownMu, muB: mu, sigmaA: ownSd, sigmaB: sd, n: 2000 })
    const all = ev ? eventWeaknesses(ev, { baseline: eventBaseline }) : historyWeaknesses(h, { baseline: seasonBase })
    const p = sim.pA
    const wins = ev?.wins ?? h?.wins ?? 0
    const losses = ev?.losses ?? h?.losses ?? 0
    const ties = ev?.ties ?? h?.ties ?? 0
    return {
      team: n,
      name: ev?.name || names.get(n) || null,
      archetype: ev ? a.archetypes.teams.get(n)?.archetype || null : null,
      elo: ev?.elo ?? null,
      opr: r1(ev?.opr),
      avgPoints: r1(ev?.avgPoints ?? h?.avgScore),
      floor: r1(ev?.floor ?? h?.floor),
      ceiling: r1(ev?.ceiling ?? h?.ceiling),
      sdPoints: r1(ev?.sdPoints ?? h?.sd),
      matches: ev?.matches ?? h?.matches ?? 0,
      wins,
      losses,
      ties,
      winRate: ev?.winRate ?? h?.winRate ?? null,
      rank: ev?.rank ?? null,
      record: { wins, losses, ties },
      season: h
        ? {
            matches: h.matches,
            wins: h.wins,
            losses: h.losses,
            ties: h.ties,
            events: (h.events || []).length,
            avgMargin: h.avgMargin,
            avgOpp: h.avgOpp,
            lastPlayed: h.lastPlayed,
            form: (h.form || []).slice(0, 4),
            stale: Boolean(h.stale)
          }
        : null,
      source: ev ? 'event' : 'season',
      mu: r1(mu),
      p: round(p, 4),
      modelP: sim.modelP,
      tier: SIM_TIER(p),
      projected: sim.mostLikely,
      margin: r1(sim.margin.p50),
      band: { own: sim.scoreA, opp: sim.scoreB },
      weaknesses: topWeaknesses(all, 5),
      weaknessCount: all.length,
      plan: null,
      h2h: { played: 0, wins: 0, losses: 0, matches: [] }
    }
  })

  const { counts, edge } = finishRows(rows)
  const withSeason = rows.filter((r) => r.source === 'season').length

  return {
    event: a.event,
    mode: 'conceptual',
    basis: scoredHere ? 'your side from season results, opponents from this event' : 'each team’s current-season results before this event',
    team: {
      team,
      name: ownEvent?.name || names.get(team) || null,
      archetype: ownEvent ? a.archetypes.teams.get(team)?.archetype || null : null,
      elo: ownEvent?.elo ?? null,
      opr: r1(ownEvent?.opr),
      avgPoints: r1(ownEvent?.avgPoints ?? ownSeason?.avgScore),
      floor: r1(ownEvent?.floor ?? ownSeason?.floor),
      ceiling: r1(ownEvent?.ceiling ?? ownSeason?.ceiling),
      sdPoints: r1(ownSd),
      matches: ownEvent?.matches ?? ownSeason?.matches ?? 0,
      wins: ownEvent?.wins ?? ownSeason?.wins ?? 0,
      losses: ownEvent?.losses ?? ownSeason?.losses ?? 0,
      ties: ownEvent?.ties ?? ownSeason?.ties ?? 0,
      winRate: ownEvent?.winRate ?? ownSeason?.winRate ?? null,
      rank: ownEvent?.rank ?? null,
      record: {
        wins: ownEvent?.wins ?? ownSeason?.wins ?? 0,
        losses: ownEvent?.losses ?? ownSeason?.losses ?? 0,
        ties: ownEvent?.ties ?? ownSeason?.ties ?? 0
      },
      season: ownSeason
        ? {
            matches: ownSeason.matches,
            wins: ownSeason.wins,
            losses: ownSeason.losses,
            ties: ownSeason.ties,
            events: (ownSeason.events || []).length,
            avgMargin: ownSeason.avgMargin,
            lastPlayed: ownSeason.lastPlayed,
            form: (ownSeason.form || []).slice(0, 4)
          }
        : null,
      source: ownEvent ? 'event' : 'season'
    },
    style: null,
    model: {
      sigmaMargin: r1(
        scoredHere ? a.ratings.sigmaMargin : Math.sqrt(2) * (medianOf(fieldStats.map((s) => s.sd)) ?? 18)
      ),
      eventMean: r1(a.ratings.eventMean),
      partnerMu: r1(allyShare),
      partnerSd: allySd,
      simulations: 2000,
      calibration: null,
      basis: 'season results'
    },
    counts,
    edge: { ...edge, examplePartner: r1(allyShare) },
    watchlist: rows.filter((r) => r.tier === 'threat' || r.tier === 'tough').slice(0, 8),
    gifts: [...rows].filter((r) => r.tier === 'easy' || r.tier === 'favorable').sort((x, y) => y.p - x.p).slice(0, 8),
    opponents: rows,
    softSpots: aggregateWeaknesses(rows),
    distribution: histogram(rows.map((r) => r.p), 0.1),
    notes: [
      `${team} has no completed matches at ${a.event.name} yet, so nothing here is a result from this event — it is the field's season so far.`,
      `Both sides are on alliance-score units: a season profile is the team's average alliance score, and a team that already played here adds two median allies (${r1(allyShare)} pts each) to its own share.`,
      `${withSeason} of ${rows.length} opponents are described by their previous tournaments (record, floor, ceiling, form); the rest already have results here.`,
      'Weaknesses come from that season: below-field scoring, a losing record, a wide spread, poor recent form, too thin a sample to trust.',
      'A key in the sidebar lets the server read seasons it has not cached yet; cached teams simulate without one.'
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
