// Monte Carlo matchup simulation: sample score distributions rather than predicting a
// single winner, so the output is "62% to win 148-131" instead of a bare probability.
import { mean, sd, round, rng, sum, quantile } from '../util.js'
import { pFromScores } from './winprob.js'

export function simulateMatchup({ muA, muB, sigmaA = null, sigmaB = null, n = 6000, seed = 424242 }) {
  const sA = Math.max(4, sigmaA ?? 18)
  const sB = Math.max(4, sigmaB ?? 18)
  const rf = rng(seed)
  let winsA = 0
  let winsB = 0
  let ties = 0
  const margins = []
  const aScores = []
  const bScores = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, muA + rf.normal() * sA)
    const b = Math.max(0, muB + rf.normal() * sB)
    if (a > b) winsA++
    else if (b > a) winsB++
    else ties++
    margins.push(a - b)
    aScores.push(a)
    bScores.push(b)
  }
  const dist = (arr) => ({
    p10: round(quantile(arr, 0.1), 1),
    p25: round(quantile(arr, 0.25), 1),
    p50: round(quantile(arr, 0.5), 1),
    p75: round(quantile(arr, 0.75), 1),
    p90: round(quantile(arr, 0.9), 1)
  })
  return {
    pA: round((winsA + 0.5 * ties) / n, 4),
    pB: round((winsB + 0.5 * ties) / n, 4),
    tieRate: round(ties / n, 4),
    muA: round(muA, 1),
    muB: round(muB, 1),
    scoreA: dist(aScores),
    scoreB: dist(bScores),
    margin: dist(margins),
    mostLikely: { a: Math.round(quantile(aScores, 0.5)), b: Math.round(quantile(bScores, 0.5)) },
    modelP: round(pFromScores(muA, muB, Math.sqrt(sA ** 2 + sB ** 2) / Math.SQRT2), 4),
    samples: n
  }
}

export function simulateAlliances({ teamsA = [], teamsB = [], ratings, n = 6000, seed = 424242 }) {
  const muA = sum(teamsA.map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
  const muB = sum(teamsB.map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
  const spread = (list) => {
    const sds = list.map((t) => ratings.teams.get(t)?.sdPoints ?? 0)
    return Math.sqrt(sum(sds.map((s) => s * s))) || ratings.sigmaMargin
  }
  return simulateMatchup({ muA, muB, sigmaA: spread(teamsA), sigmaB: spread(teamsB), n, seed })
}
