// Counter-strategy engine: a deterministic recommendation layer over the fitted model.
// The rule base lives in data/counter-rules.json and is editable from the UI, because
// coaches disagree with priors and should be able to fix them without touching code.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clamp, round, sum } from '../util.js'
import { pFromScores } from './winprob.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RULES_PATH = process.env.COUNTER_RULES || path.join(ROOT, 'data', 'counter-rules.json')

let cache = null
export function loadRules({ fresh = false } = {}) {
  if (cache && !fresh) return cache
  try {
    cache = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'))
  } catch {
    cache = { version: 0, rules: [], notes: 'rules file missing' }
  }
  return cache
}
export function saveRules(next) {
  const body = { ...next, version: Number(next.version || 1) }
  fs.writeFileSync(RULES_PATH, JSON.stringify(body, null, 2))
  cache = null
  return loadRules()
}

const OPS = {
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b
}

export function metricsFor(team, styleEntry) {
  const ten = styleEntry?.tendencies || {}
  return {
    autonPerMatch: team.autonPerMatch,
    driverPerMatch:
      team.driverPerMatch ?? (team.avgPoints != null && team.autonPerMatch != null ? round(team.avgPoints - team.autonPerMatch, 1) : null),
    avgPoints: team.avgPoints,
    floor: team.floor,
    ceiling: team.ceiling,
    spread: team.floor != null && team.ceiling != null ? round(team.ceiling - team.floor, 1) : null,
    ceilingGap: team.floor != null && team.ceiling != null ? round(team.ceiling - team.floor, 1) : null,
    cv: team.cv,
    consistency: team.cv != null ? round(1 - team.cv, 3) : null,
    penaltyPerMatch: team.penaltyPerMatch,
    clutch: team.clutch,
    winRate: team.winRate,
    autonShare: ten.autonShareOfMatch ?? null,
    skillsProg: team.skills?.prog,
    skillsDriver: team.skills?.driver,
    skillsCombined: team.skills?.combined,
    opr: team.opr,
    elo: team.elo,
    rank: team.rank
  }
}

export function attackVectors({ opponentNumber, ownNumber, ratings, archetypes }) {
  const opp = ratings.teams.get(opponentNumber)
  if (!opp) return null
  const own = ownNumber ? ratings.teams.get(ownNumber) : null
  const oppMetrics = metricsFor(opp, archetypes?.teams.get(opponentNumber))
  const ownMetrics = own ? metricsFor(own, archetypes?.teams.get(ownNumber)) : null
  const rules = loadRules().rules || []

  const vectors = []
  for (const r of rules) {
    const observed = oppMetrics[r.when.metric]
    if (observed == null) continue
    const op = OPS[r.when.op]
    if (!op || !op(observed, r.when.value)) continue
    let capability = 0.7
    if (r.requires) {
      if (ownMetrics) {
        const mv = ownMetrics[r.requires.metric]
        capability = mv == null ? 0.6 : clamp(mv / r.requires.min, 0, 1)
      } else capability = 0.65
    }
    const confW = r.confidence === 'high' ? 1 : r.confidence === 'medium' ? 0.85 : 0.7
    vectors.push({
      id: r.id,
      title: r.title,
      action: r.action,
      trigger: r.trigger,
      roles: r.roles || [],
      tags: r.tags || [],
      confidence: r.confidence,
      metric: r.when.metric,
      observed: round(observed, 2),
      threshold: r.when.value,
      expectedPoints: r.expectedPoints,
      capability: round(capability, 2),
      score: round(r.expectedPoints * (0.55 + 0.45 * capability) * confW, 2)
    })
  }
  vectors.sort((a, b) => b.score - a.score)
  const top = vectors.slice(0, 4)
  const swing = sum(top.map((v) => v.expectedPoints * v.capability)) * 0.5
  const muOpp = opp.mu
  const muOwn = own?.mu ?? ratings.eventMean
  const baseP = pFromScores(muOwn, muOpp, ratings.sigmaMargin)
  const planP = pFromScores(muOwn + swing * 0.4, muOpp - swing * 0.6, ratings.sigmaMargin)

  return {
    opponent: opponentNumber,
    own: ownNumber || null,
    archetype: archetypes?.teams.get(opponentNumber)?.archetype || null,
    metrics: oppMetrics,
    vectors,
    top,
    swingPoints: round(swing, 1),
    winProb: round(baseP, 4),
    winProbWithPlan: round(planP, 4),
    deltaP: round(planP - baseP, 4),
    roles: [...new Set(top.flatMap((v) => v.roles))],
    triggers: top.map((v) => ({ trigger: v.trigger, from: v.title })),
    coverage: {
      rulesEvaluated: rules.length,
      rulesFired: vectors.length,
      metricsMissing: rules.map((r) => r.when.metric).filter((m) => oppMetrics[m] == null).filter((m, i, a) => a.indexOf(m) === i)
    },
    rulesVersion: loadRules().version
  }
}
