// Prescription engine: turns "you should improve" into "improve this, by this much,
// for this much win probability per practice hour".
//
// Method: for every match the team actually played, recompute P(win) after adding the
// realistic improvement to their alliance's expected score. ROI = mean ΔP / practice
// hours. It is a marginal analysis under the score model — assumptions are stated on
// every row, not hidden.
import { mean, round, clamp, quantile, sum } from '../util.js'
import { teamsOf, isScored } from './ratings.js'
import { pFromScores } from './winprob.js'

export const PRACTICE_DIMS = [
  {
    key: 'auton',
    label: 'Autonomous consistency',
    unit: 'pts / match',
    hours: 12,
    gain: (t) => clamp(t.autonPerMatch ?? (t.skills?.prog ?? 0) * 0.4, 4, 12),
    note: 'One extra autonomous objective executed every match. Assumes an existing working auton.'
  },
  {
    key: 'driver',
    label: 'Driver-control throughput',
    unit: 'pts / match',
    hours: 10,
    gain: () => 8,
    note: 'Roughly one extra scoring cycle per 20s of driver control.'
  },
  {
    key: 'penalty',
    label: 'Penalty discipline',
    unit: 'pts / match',
    hours: 3,
    gain: (t) => clamp((t.penaltyPerMatch || 0) * 0.6, 1, 6),
    note: 'Cheapest win available: eliminate avoidable contact and expansion calls.'
  },
  {
    key: 'consistency',
    label: 'Score floor / reliability',
    unit: 'pts / match',
    hours: 8,
    gain: (t) => clamp((t.mu - (t.floor ?? t.mu)) * 0.4, 2, 10),
    note: 'Raise the bad-match floor: wire management, battery discipline, repeatable routine.'
  },
  {
    key: 'endgame',
    label: 'Endgame conversion',
    unit: 'pts / match',
    hours: 6,
    gain: (t) => clamp(((t.clutch ?? 0) > 0 ? 6 : 9), 4, 12),
    note: 'Convert the endgame in every match instead of half of them.'
  },
  {
    key: 'ceiling',
    label: 'Peak output (ceiling)',
    unit: 'pts / match',
    hours: 16,
    gain: () => 12,
    note: 'Raise the best-case score: extra mechanism capacity or a faster cycle path.'
  }
]

export function prescribe(teamNumber, ratings) {
  const team = ratings.teams.get(teamNumber)
  if (!team) return null
  const sigma = ratings.sigmaMargin

  const played = ratings.matches.filter((m) => {
    if (!isScored(m)) return false
    const al = teamsOf(m)
    return al.red.includes(teamNumber) || al.blue.includes(teamNumber)
  })
  if (!played.length) {
    return { team: teamNumber, matches: 0, dims: [], gaps: [], baselineWinProb: null, note: 'No completed matches to model.' }
  }

  const baselines = played.map((m) => {
    const al = teamsOf(m)
    const own = al.red.includes(teamNumber) ? 'red' : 'blue'
    const other = own === 'red' ? 'blue' : 'red'
    const muOwn = sum(al[own].map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
    const muOpp = sum(al[other].map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
    return { match: m, muOwn, muOpp, own, base: pFromScores(muOwn, muOpp, sigma) }
  })
  const baselineWinProb = mean(baselines.map((b) => b.base))

  const dims = PRACTICE_DIMS.map((d) => {
    const gain = d.gain(team)
    const deltas = baselines.map((b) => pFromScores(b.muOwn + gain, b.muOpp, sigma) - b.base)
    const deltaP = mean(deltas)
    const roi = deltaP / d.hours
    return {
      key: d.key,
      label: d.label,
      unit: d.unit,
      gainPoints: round(gain, 1),
      deltaP: round(deltaP, 4),
      hours: d.hours,
      roi: round(roi, 5),
      roiPer10h: round(roi * 10 * 100, 2),
      note: d.note,
      matchesModelled: played.length
    }
  }).sort((a, b) => b.roi - a.roi)

  // Marginal value declines: cap the recommendation at the field's top decile for the metric.
  const field = ratings.list.filter((t) => t.matches > 0)
  const gaps = [
    { key: 'avgPoints', label: 'Average points', value: team.avgPoints, unit: 'pts' },
    { key: 'floor', label: 'Floor (p10)', value: team.floor, unit: 'pts' },
    { key: 'ceiling', label: 'Ceiling (p90)', value: team.ceiling, unit: 'pts' },
    { key: 'autonPerMatch', label: 'Autonomous', value: team.autonPerMatch, unit: 'pts' },
    { key: 'penaltyPerMatch', label: 'Penalties per match', value: team.penaltyPerMatch, unit: 'pts', lowerIsBetter: true },
    { key: 'skillsProg', label: 'Programming skills', value: team.skills?.prog, unit: 'pts' },
    { key: 'skillsDriver', label: 'Driver skills', value: team.skills?.driver, unit: 'pts' }
  ]
    .map((g) => {
      const vals = field.map((t) => (g.key === 'skillsProg' ? t.skills?.prog : g.key === 'skillsDriver' ? t.skills?.driver : t[g.key])).filter((v) => v != null)
      if (g.value == null || vals.length < 5) return { ...g, percentile: null, topDecile: null, gap: null }
      const sorted = [...vals].sort((a, b) => a - b)
      const pct = vals.filter((v) => (g.lowerIsBetter ? v > g.value : v < g.value)).length / vals.length
      const topDecile = quantile(sorted, g.lowerIsBetter ? 0.1 : 0.9)
      return {
        ...g,
        percentile: round(pct, 3),
        topDecile: round(topDecile, 1),
        gap: round(g.lowerIsBetter ? g.value - topDecile : topDecile - g.value, 1)
      }
    })
    .sort((a, b) => (b.gap ?? -999) - (a.gap ?? -999))

  const best = dims[0]
  const summary = best
    ? `${team.team}: ${Math.round(baselineWinProb * 100)}% average win probability across ${played.length} completed matches. Highest-leverage practice: ${best.label.toLowerCase()} (+${best.gainPoints} ${best.unit} → +${(best.deltaP * 100).toFixed(1)}pp, ${best.roiPer10h}pp per 10 practice hours).`
    : `${team.team}: no completed matches.`

  return {
    team: teamNumber,
    matches: played.length,
    baselineWinProb: round(baselineWinProb, 4),
    dims,
    gaps,
    summary,
    caveat:
      played.length < 6
        ? 'Fewer than 6 completed matches: these estimates carry wide uncertainty. Treat the ranking, not the decimals, as the signal.'
        : 'Marginal analysis under the score model; assumes improvement applies to every future match.'
  }
}
