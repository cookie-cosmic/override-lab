// Ratings: OPR (ridge least squares), Elo with bootstrap intervals, per-team point
// distributions, strength of schedule, and schedule luck (wins above expectation).
import { mean, sd, quantile, sum, solveLinear, clamp, rng, round, isElimRound } from '../util.js'
import { pFromScores, calibrationReport, sigmaFromMatches } from './winprob.js'

export function teamsOf(match) {
  const clean = (v) => {
    const s = v == null ? '' : String(v).trim()
    return s || ''
  }
  return {
    red: [clean(match.red1), clean(match.red2), clean(match.red3)].filter(Boolean),
    blue: [clean(match.blue1), clean(match.blue2), clean(match.blue3)].filter(Boolean)
  }
}

export const isScored = (m) => m.red_score != null && m.blue_score != null

const zeros = (n) => Array.from({ length: n }, () => new Array(n).fill(0))

/** Ridge-regularised OPR. Falls back to coordinate updates for very large fields. */
function solveOpr(scored, numbers, idx) {
  const n = numbers.length
  if (!n) return { opr: [] }

  if (n > 140) {
    const acc = new Array(n).fill(0)
    const cnt = new Array(n).fill(0)
    for (const m of scored) {
      const al = teamsOf(m)
      for (const side of ['red', 'blue']) {
        const sc = side === 'red' ? m.red_score : m.blue_score
        for (const t of al[side]) {
          const i = idx.get(t)
          if (i == null) continue
          acc[i] += sc
          cnt[i]++
        }
      }
    }
    const opr = acc.map((v, i) => (cnt[i] ? v / cnt[i] : 0))
    for (let it = 0; it < 50; it++) {
      const next = opr.slice()
      for (const m of scored) {
        const al = teamsOf(m)
        for (const side of ['red', 'blue']) {
          const ids = al[side].map((t) => idx.get(t)).filter((i) => i != null)
          if (!ids.length) continue
          const sc = side === 'red' ? m.red_score : m.blue_score
          const rest = sum(ids.map((i) => opr[i]))
          for (const i of ids) next[i] = Math.max(0, 0.75 * opr[i] + 0.25 * (sc - (rest - opr[i])))
        }
      }
      for (let i = 0; i < n; i++) opr[i] = next[i]
    }
    return { opr }
  }

  const A = zeros(n)
  const b = new Array(n).fill(0)
  let rows = 0
  for (const m of scored) {
    const al = teamsOf(m)
    for (const side of ['red', 'blue']) {
      const ids = al[side].map((t) => idx.get(t)).filter((i) => i != null)
      if (!ids.length) continue
      const sc = side === 'red' ? m.red_score : m.blue_score
      rows++
      for (const i of ids) {
        b[i] += sc
        for (const j of ids) A[i][j] += 1
      }
    }
  }
  if (!rows) return { opr: new Array(n).fill(0) }
  const diag = mean(A.map((row, i) => row[i])) || 1
  const lam = diag * 0.08
  for (let i = 0; i < n; i++) A[i][i] += lam
  const x = solveLinear(A, b)
  return { opr: x.map((v) => Math.max(0, v)) }
}

/** Sequential Elo. Returns final ratings and the pre-match expectation per match. */
export function runElo(scored, numbers, { K = 14 } = {}) {
  const ratings = new Map(numbers.map((t) => [t, 1500]))
  const pre = new Map()
  const ordered = [...scored].sort(
    (a, b) => (Date.parse(a.scheduled || 0) || 0) - (Date.parse(b.scheduled || 0) || 0)
  )
  for (const m of ordered) {
    const al = teamsOf(m)
    if (!al.red.length || !al.blue.length) continue
    const rRed = mean(al.red.map((t) => ratings.get(t) ?? 1500))
    const rBlue = mean(al.blue.map((t) => ratings.get(t) ?? 1500))
    const diff = rRed - rBlue
    const pRed = 1 / (1 + Math.pow(10, -diff / 400))
    if (m.match_key) pre.set(m.match_key, { p: pRed, diff })
    const margin = Math.abs(m.red_score - m.blue_score)
    const outcome = m.red_score > m.blue_score ? 1 : m.red_score < m.blue_score ? 0 : 0.5
    // margin-of-victory multiplier: blowouts move ratings more, capped so one runaway
    // match cannot dominate the whole field.
    const mov = clamp(Math.log(margin + 2) / Math.log(12), 0.45, 2.2)
    const delta = K * mov * (outcome - pRed)
    for (const t of al.red) ratings.set(t, (ratings.get(t) ?? 1500) + delta)
    for (const t of al.blue) ratings.set(t, (ratings.get(t) ?? 1500) - delta)
  }
  return { ratings, pre }
}

/**
 * Full event rating model. Everything here is derived from completed matches —
 * no scouting or video required.
 */
export function buildRatings({ sku, matches = [], teams = [], rankings = [], skills = [] }) {
  const scored = matches.filter(isScored)
  const nameOf = new Map()
  for (const t of teams) if (t?.number) nameOf.set(String(t.number).trim(), t.name || null)

  const numbersSet = new Set()
  for (const m of matches) {
    const al = teamsOf(m)
    for (const t of [...al.red, ...al.blue]) numbersSet.add(t)
  }
  for (const t of teams) if (t?.number) numbersSet.add(String(t.number).trim())
  const numbers = [...numbersSet].filter(Boolean).sort()
  const idx = new Map(numbers.map((t, i) => [t, i]))

  const { opr } = solveOpr(scored, numbers, idx)
  const oprRank = new Map(
    numbers
      .map((t, i) => ({ t, v: opr[i] }))
      .sort((a, b) => b.v - a.v)
      .map((r, i) => [r.t, i + 1])
  )

  const eloRun = runElo(scored, numbers)
  const elo = eloRun.ratings

  // Bootstrap the Elo ratings to get an honest interval instead of a fake point estimate.
  const rf = rng(9001)
  const boots = []
  for (let it = 0; it < 120 && scored.length > 0; it++) {
    const sample = Array.from({ length: scored.length }, () => scored[Math.floor(rf() * scored.length)])
    boots.push(runElo(sample, numbers).ratings)
  }
  const eloSd = new Map(numbers.map((t) => [t, Math.max(1, boots.length ? sd(boots.map((b) => b.get(t) ?? 1500)) : 40)]))

  const sigmaMargin = sigmaFromMatches(scored)

  // Per-team point series: each team gets its OPR share of every alliance score it played.
  const series = new Map(numbers.map((t) => [t, []]))
  for (const m of scored) {
    const al = teamsOf(m)
    for (const side of ['red', 'blue']) {
      const ts = al[side]
      if (!ts.length) continue
      const sc = side === 'red' ? m.red_score : m.blue_score
      const w = ts.map((t) => Math.max(0.5, opr[idx.get(t)] ?? 1))
      const tot = sum(w) || 1
      ts.forEach((t, k) => {
        const arr = series.get(t)
        if (arr) arr.push((sc * w[k]) / tot)
      })
    }
  }

  const rawMeans = new Map(numbers.map((t) => [t, series.get(t).length ? mean(series.get(t)) : 0]))
  const eventMean = mean([...rawMeans.values()]) || 0
  const K_SHRINK = 2.5
  const mu = new Map(
    numbers.map((t) => {
      const arr = series.get(t) || []
      const m = arr.length ? mean(arr) : eventMean
      return [t, (arr.length * m + K_SHRINK * eventMean) / (arr.length + K_SHRINK)]
    })
  )

  const rankingsByTeam = new Map(rankings.map((r) => [String(r.team).trim(), r]))
  const skillsByTeam = new Map()
  for (const s of skills) {
    const key = String(s.team).trim()
    const cur = skillsByTeam.get(key) || {}
    const type = Number(s.type)
    if (type === 0) cur.driver = s
    else if (type === 1) cur.prog = s
    else cur.combined = s
    skillsByTeam.set(key, cur)
  }

  const agg = new Map(
    numbers.map((t) => [
      t,
      { matches: 0, wins: 0, losses: 0, ties: 0, oppElo: [], expWins: 0, elim: [], qual: [], penalty: [], auto: [], driver: [] }
    ])
  )

  const annotated = []
  for (const m of matches) {
    const al = teamsOf(m)
    const muRed = sum(al.red.map((t) => mu.get(t) ?? eventMean))
    const muBlue = sum(al.blue.map((t) => mu.get(t) ?? eventMean))
    const scoredMatch = isScored(m)
    const pRed = scoredMatch ? pFromScores(muRed, muBlue, sigmaMargin) : null
    annotated.push({ ...m, muRed, muBlue, pRed, projectedMargin: muRed - muBlue })
    if (!scoredMatch) continue

    const isElim = isElimRound(m.round)
    const sides = [
      { teams: al.red, opp: al.blue, score: m.red_score, oppScore: m.blue_score, p: pRed, pen: m.red_penalty, auto: m.red_auto, drv: m.red_driver },
      { teams: al.blue, opp: al.red, score: m.blue_score, oppScore: m.red_score, p: 1 - pRed, pen: m.blue_penalty, auto: m.blue_auto, drv: m.blue_driver }
    ]
    for (const s of sides) {
      if (!s.teams.length) continue
      const won = s.score > s.oppScore
      const lost = s.score < s.oppScore
      const w = s.teams.map((t) => Math.max(0.5, opr[idx.get(t)] ?? 1))
      const tot = sum(w) || 1
      s.teams.forEach((t, k) => {
        const a = agg.get(t)
        if (!a) return
        a.matches++
        if (won) a.wins++
        else if (lost) a.losses++
        else a.ties++
        a.expWins += s.p
        for (const o of s.opp) a.oppElo.push(elo.get(o) ?? 1500)
        const pts = (s.score * w[k]) / tot
        if (isElim) a.elim.push(pts)
        else a.qual.push(pts)
        if (s.pen != null) a.penalty.push(s.pen)
        if (s.auto != null) a.auto.push((s.auto * w[k]) / tot)
        if (s.drv != null) a.driver.push((s.drv * w[k]) / tot)
      })
    }
  }

  const teamsOut = new Map()
  for (const t of numbers) {
    const a = agg.get(t)
    const s = series.get(t) || []
    const r = rankingsByTeam.get(t)
    const sk = skillsByTeam.get(t) || {}
    const mPts = s.length ? mean(s) : 0
    const sPts = sd(s)
    const teamElo = elo.get(t) ?? 1500
    const eSd = eloSd.get(t) ?? 40
    teamsOut.set(t, {
      team: t,
      name: nameOf.get(t) || null,
      matches: a.matches,
      wins: a.wins,
      losses: a.losses,
      ties: a.ties,
      winRate: a.matches ? round((a.wins + 0.5 * a.ties) / a.matches, 3) : 0,
      opr: round(opr[idx.get(t)] ?? 0, 1),
      oprRank: oprRank.get(t) ?? null,
      mu: round(mu.get(t) ?? 0, 1),
      elo: round(teamElo, 0),
      eloSd: round(eSd, 1),
      eloBand: [round(teamElo - 1.28 * eSd, 0), round(teamElo + 1.28 * eSd, 0)],
      avgPoints: round(mPts, 1),
      sdPoints: round(sPts, 1),
      floor: round(s.length ? quantile(s, 0.1) : 0, 1),
      ceiling: round(s.length ? quantile(s, 0.9) : 0, 1),
      max: round(s.length ? Math.max(...s) : 0, 1),
      cv: mPts ? round(sPts / mPts, 3) : null,
      sos: round(a.oppElo.length ? mean(a.oppElo) : 1500, 0),
      expWins: round(a.expWins, 2),
      winsAboveExpectation: round(a.wins - a.expWins, 2),
      elimPoints: a.elim.length ? round(mean(a.elim), 1) : null,
      qualPoints: a.qual.length ? round(mean(a.qual), 1) : null,
      clutch: a.elim.length && a.qual.length ? round(mean(a.elim) - mean(a.qual), 1) : null,
      penaltyPerMatch: a.penalty.length ? round(mean(a.penalty), 2) : null,
      autonPerMatch: a.auto.length ? round(mean(a.auto), 1) : null,
      driverPerMatch: a.driver.length ? round(mean(a.driver), 1) : null,
      skills: {
        driver: sk.driver?.score ?? null,
        prog: sk.prog?.score ?? null,
        combined: sk.combined?.score ?? null,
        attempts: sk.combined?.attempts ?? null
      },
      rank: r?.rank ?? null,
      wp: r?.wp ?? null,
      ap: r?.ap ?? null,
      sp: r?.sp ?? null,
      maxScore: r?.max_score ?? null
    })
  }

  const samples = annotated
    .filter((m) => isScored(m) && eloRun.pre.has(m.match_key))
    .map((m) => {
      const { diff } = eloRun.pre.get(m.match_key)
      const y = m.red_score > m.blue_score ? 1 : m.red_score < m.blue_score ? 0 : 0.5
      return { x: diff / 400, y }
    })
    .filter((s) => s.y === 0 || s.y === 1)

  const calibration = calibrationReport(samples)

  return {
    sku,
    numbers,
    teams: teamsOut,
    list: numbers.map((t) => teamsOut.get(t)),
    matches: annotated,
    sigmaMargin: round(sigmaMargin, 1),
    eventMean: round(eventMean, 1),
    calibration
  }
}

export function allianceMu(teamList, ratings) {
  return sum(teamList.map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
}

export function byTeamNumber(ratings) {
  return ratings.teams
}

export function rankList(ratings, key = 'elo') {
  return [...ratings.list].filter((t) => t.matches > 0).sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
}
