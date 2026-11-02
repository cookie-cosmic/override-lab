// Match attribution: who actually produced the margin, and why the match was lost.
//
// Two independent lenses:
//  1. Phase decomposition (only when the source provides auto/driver/penalty splits)
//  2. Shapley attribution over alliance members, using partner-independent OPR values
// Both are stated as estimates: the public data has no point-by-point timeline, so the
// causal claims below are counterfactual-under-model, never observed facts.
import { mean, quantile, sum, round, clamp } from '../util.js'
import { teamsOf, isScored } from './ratings.js'
import { pFromScores } from './winprob.js'

function replacementLevel(ratings) {
  // A replacement fill has to be genuinely weak. Using a mid-quartile OPR makes an
  // average teammate's marginal value negative, which zeroes out real contributors.
  const vals = ratings.list.filter((t) => t.mu != null).map((t) => t.mu)
  return vals.length ? Math.max(0.5, quantile(vals, 0.05)) : 1
}

function allianceCapacity(ratings) {
  const scores = ratings.matches.filter(isScored).flatMap((m) => [m.red_score, m.blue_score])
  return scores.length >= 8 ? quantile(scores, 0.97) : Infinity
}

/**
 * Exact Shapley values for an alliance of up to 3 teams.
 * Value function: sum of member shrunk score means with a replacement-level fill, capped
 * at the event's ~97th percentile alliance score — field objects are finite, so a third
 * strong robot adds less than the first two. This cap is what stops the decomposition
 * from collapsing into plain OPR shares.
 */
export function shapleyAlliance(members, ratings, n = null) {
  const size = n ?? members.length
  if (!members.length) return { members: [], shares: [] }
  const repl = replacementLevel(ratings)
  const capacity = allianceCapacity(ratings)
  const muOf = (t) => ratings.teams.get(t)?.mu ?? repl
  const value = (subset) => {
    const raw = sum(subset.map(muOf)) + (size - subset.length) * repl
    return Number.isFinite(capacity) ? Math.min(raw, capacity) : raw
  }
  const contrib = members.map((member, i) => {
    const others = members.filter((_, j) => j !== i)
    let phi = 0
    const subsets = 1 << others.length
    for (let mask = 0; mask < subsets; mask++) {
      const subset = others.filter((_, j) => mask & (1 << j))
      const s = subset.length
      // n! denominator terms for a full alliance size of `size`
      const w = (factorial(s) * factorial(size - s - 1)) / factorial(size)
      phi += w * (value([...subset, member]) - value(subset))
    }
    return { team: member, phi: Math.max(0, phi) }
  })
  const total = sum(contrib.map((c) => c.phi))
  if (total <= 1e-9) {
    return {
      members: [...members],
      replacement: round(repl, 1),
      shares: members.map((t) => ({ team: t, share: round(1 / members.length, 4), shapleyPoints: null }))
    }
  }
  return {
    members: members.map((t) => t),
    replacement: round(repl, 1),
    shares: contrib.map((c) => ({ team: c.team, share: round(c.phi / total, 4), shapleyPoints: round(c.phi, 2) }))
  }
}

function factorial(n) {
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

/** Points attribution scaled so contributions add up to the observed alliance score. */
export function gradedContributions(match, ratings) {
  if (!isScored(match)) return null
  const al = teamsOf(match)
  const out = { red: null, blue: null }
  for (const side of ['red', 'blue']) {
    const members = al[side]
    if (!members.length) continue
    const sh = shapleyAlliance(members, ratings)
    const score = side === 'red' ? match.red_score : match.blue_score
    out[side] = sh.shares.map((s) => ({
      ...s,
      points: round(score * s.share, 1),
      perMatchMu: ratings.teams.get(s.team)?.mu ?? null
    }))
  }
  return out
}

export function phaseBreakdown(match) {
  const phases = []
  const push = (key, label, red, blue) => {
    if (red == null && blue == null) return
    phases.push({ key, label, red: red ?? 0, blue: blue ?? 0, delta: (red ?? 0) - (blue ?? 0) })
  }
  push('auton', 'Autonomous', match.red_auto, match.blue_auto)
  push('driver', 'Driver control', match.red_driver, match.blue_driver)
  push('penalty', 'Penalty points', match.red_penalty, match.blue_penalty)
  const covered = sum(phases.map((p) => p.red))
  return {
    available: phases.length > 0,
    phases,
    coverage: isScored(match) && match.red_score ? round(covered / match.red_score, 3) : null
  }
}

/**
 * Ranked causes for a lost match. Every weight is an indicator x magnitude, normalised;
 * the UI shows the shares so a coach can disagree with a specific factor.
 */
export function lossCauses(match, ratings, side = 'red') {
  if (!isScored(match)) return []
  const other = side === 'red' ? 'blue' : 'red'
  const own = match[`${side}_score`]
  const opp = match[`${other}_score`]
  const margin = own - opp
  if (margin >= 0) return []

  const al = teamsOf(match)
  const ownTeams = al[side]
  const causes = []

  const autoOwn = match[`${side}_auto`]
  const autoOpp = match[`${other}_auto`]
  if (autoOwn != null && autoOpp != null && autoOpp > autoOwn) {
    causes.push({
      key: 'auton',
      label: 'Autonomous deficit',
      magnitude: autoOpp - autoOwn,
      evidence: `lost the autonomous phase by ${round(autoOpp - autoOwn, 1)} points`
    })
  }
  const drvOwn = match[`${side}_driver`]
  const drvOpp = match[`${other}_driver`]
  if (drvOwn != null && drvOpp != null && drvOpp > drvOwn) {
    causes.push({
      key: 'driver',
      label: 'Driver-control deficit',
      magnitude: drvOpp - drvOwn,
      evidence: `out-scored by ${round(drvOpp - drvOwn, 1)} during driver control`
    })
  }
  const penOwn = match[`${side}_penalty`]
  const penOpp = match[`${other}_penalty`]
  if (penOwn != null && penOpp != null && penOpp > penOwn) {
    causes.push({
      key: 'penalty',
      label: 'Penalty points conceded',
      magnitude: penOpp - penOwn,
      evidence: `opponent collected ${round(penOpp - penOwn, 1)} more penalty points`
    })
  }

  const ownStats = ownTeams.map((t) => ratings.teams.get(t)).filter(Boolean)
  const oppStats = al[other].map((t) => ratings.teams.get(t)).filter(Boolean)
  const ownExpected = sum(ownStats.map((t) => t.mu ?? 0))
  const ownFloor = sum(ownStats.map((t) => t.floor ?? 0))
  const oppCeil = sum(oppStats.map((t) => t.ceiling ?? 0))
  if (ownFloor && own < ownFloor) {
    causes.push({
      key: 'execution',
      label: 'Executed below your own floor',
      magnitude: ownFloor - own,
      evidence: `scored ${round(own, 1)} against a 10th-percentile floor of ${round(ownFloor, 1)}`
    })
  }
  if (oppCeil && opp > oppCeil) {
    causes.push({
      key: 'opponent_ceiling',
      label: 'Opponent exceeded their ceiling',
      magnitude: opp - oppCeil,
      evidence: `opponent scored ${round(opp, 1)} versus a 90th-percentile ceiling of ${round(oppCeil, 1)}`
    })
  }
  const pOwn = side === 'red' ? match.pRed : 1 - (match.pRed ?? 0.5)
  if (pOwn != null && pOwn < 0.35) {
    causes.push({
      key: 'schedule',
      label: 'Structural mismatch',
      magnitude: (0.5 - pOwn) * 60,
      evidence: `pre-match win probability was only ${Math.round(pOwn * 100)}%`
    })
  }
  if (Math.abs(margin) <= 5) {
    causes.push({
      key: 'variance',
      label: 'Coin-flip margin',
      magnitude: 6 - Math.abs(margin),
      evidence: `final margin was ${Math.abs(margin)} points — inside normal match-to-match noise`
    })
  }

  if (ownExpected && own < ownExpected * 0.92) {
    causes.push({
      key: 'underperformed',
      label: 'Below your own projection',
      magnitude: ownExpected - own,
      evidence: `scored ${round(own, 1)} against a projected ${round(ownExpected, 1)}`
    })
  }
  // A loss must always carry at least one factor: silence reads as a bug, not a finding.
  if (!causes.length) {
    causes.push({
      key: 'output',
      label: 'Raw scoring gap',
      magnitude: Math.abs(margin) || 1,
      evidence: `out-scored by ${round(Math.abs(margin), 1)} with no single phase dominating — this archive carries finals only, so the gap cannot be localised further`
    })
  }

  const total = sum(causes.map((c) => c.magnitude)) || 1
  return causes
    .map((c) => ({ ...c, share: round(c.magnitude / total, 3), magnitude: round(c.magnitude, 1) }))
    .sort((a, b) => b.share - a.share)
}

/** Counterfactual swings for a lost match, computed against the score model. */
export function counterfactuals(match, ratings, side = 'red') {
  if (!isScored(match)) return []
  const other = side === 'red' ? 'blue' : 'red'
  const sigma = ratings.sigmaMargin
  const al = teamsOf(match)
  const ownMu = sum(al[side].map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
  const oppMu = sum(al[other].map((t) => ratings.teams.get(t)?.mu ?? ratings.eventMean))
  const baseP = pFromScores(ownMu, oppMu, sigma)
  const out = []
  const bump = (label, delta) => {
    const p = pFromScores(ownMu + delta, oppMu, sigma)
    out.push({ label, deltaPoints: round(delta, 1), winProb: round(p, 3), deltaP: round(p - baseP, 3) })
  }
  const autoOwn = match[`${side}_auto`]
  const autoOpp = match[`${other}_auto`]
  if (autoOwn != null && autoOpp != null && autoOpp > autoOwn) bump('Matching their autonomous', autoOpp - autoOwn)
  const penOpp = match[`${other}_penalty`]
  if (penOpp) bump('Conceding zero penalty points', penOpp)
  bump('One extra scoring cycle', 6)
  bump('Two extra scoring cycles', 12)
  return { baseP: round(baseP, 3), projections: out }
}

export function attributeMatch(match, ratings) {
  if (!isScored(match)) return { available: false, reason: 'match not scored' }
  const phases = phaseBreakdown(match)
  const contributions = gradedContributions(match, ratings)
  return {
    available: true,
    margin: match.red_score - match.blue_score,
    winner: match.red_score === match.blue_score ? 'tie' : match.red_score > match.blue_score ? 'red' : 'blue',
    phases,
    contributions,
    redLoss: lossCauses(match, ratings, 'red'),
    blueLoss: lossCauses(match, ratings, 'blue'),
    counterfactuals: {
      red: counterfactuals(match, ratings, 'red'),
      blue: counterfactuals(match, ratings, 'blue')
    }
  }
}
