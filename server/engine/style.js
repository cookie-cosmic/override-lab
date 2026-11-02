// Style profile: turns hard numbers into the archetypes coaches actually reason with,
// then folds in human scouting when it exists (10 fields per team beats a terabyte of CV).
import { mean, sd, round, clamp, sum, quantile } from '../util.js'

export const DIMS = [
  { key: 'scoring', label: 'Scoring output' },
  { key: 'ceiling', label: 'Peak output' },
  { key: 'floor', label: 'Floor' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'auton', label: 'Autonomous' },
  { key: 'skills', label: 'Skills runs' },
  { key: 'clutch', label: 'Elimination clutch' },
  { key: 'discipline', label: 'Penalty discipline' }
]

export const SCOUTING_FIELDS = [
  { key: 'archetype', label: 'Robot archetype', type: 'text', hint: 'e.g. fast single-object cycler, hoarder, wall bot' },
  { key: 'autonRoutine', label: 'Autonomous routine', type: 'text', hint: 'starting tile + first 3 actions' },
  { key: 'autonReliability', label: 'Auton reliability 0-1', type: 'number', hint: 'fraction of matches the auton completes' },
  { key: 'startPosition', label: 'Start position', type: 'text', hint: 'e.g. red near / far' },
  { key: 'targetPriority', label: 'Target priority', type: 'text', hint: 'what they score first and always' },
  { key: 'cycleStyle', label: 'Cycle style', type: 'text', hint: 'single object, stack, multi-object dump' },
  { key: 'endgame', label: 'Endgame mechanism', type: 'text', hint: 'climb / park / elevate / none' },
  { key: 'endgameRate', label: 'Endgame success 0-1', type: 'number', hint: 'fraction of matches the endgame lands' },
  { key: 'defense', label: 'Defensive willingness 0-1', type: 'number', hint: '0 = never blocks, 1 = dedicated defender' },
  { key: 'notes', label: 'Pit notes', type: 'text', hint: 'anything else worth remembering' }
]

function rawFeatures(team) {
  return {
    scoring: team.avgPoints ?? 0,
    ceiling: team.ceiling ?? 0,
    floor: team.floor ?? 0,
    consistency: team.cv == null ? 0 : -team.cv,
    auton: team.autonPerMatch ?? (team.skills?.prog != null ? team.skills.prog * 0.5 : 0),
    skills: team.skills?.combined ?? team.skills?.driver ?? 0,
    clutch: team.clutch ?? 0,
    discipline: -(team.penaltyPerMatch ?? 0)
  }
}

export function tendencies(team) {
  return {
    autonShareOfMatch: team.avgPoints ? round((team.autonPerMatch ?? 0) / team.avgPoints, 3) : null,
    spread: team.floor != null && team.ceiling != null ? round(team.ceiling - team.floor, 1) : null,
    penaltyRate: team.penaltyPerMatch,
    clutchDelta: team.clutch,
    reliability: team.cv,
    winRate: team.winRate,
    ceilingUpside: team.avgPoints ? round((team.ceiling ?? 0) / team.avgPoints, 2) : null
  }
}

/**
 * z-score vectors over the analysed field.
 * Dimensions with no variance are dropped: a metric every team shares (e.g. autonomous
 * points when the archive has no auton split) cannot discriminate between teams, and
 * leaving it in would silently add noise to every cluster distance.
 */
export function featureMatrix(ratings) {
  const active = ratings.list.filter((t) => t.matches > 0)
  const raw = new Map(active.map((t) => [t.team, rawFeatures(t)]))
  const stats = {}
  const dims = []
  for (const d of DIMS) {
    const vals = active.map((t) => raw.get(t.team)[d.key])
    const m = mean(vals)
    const s = sd(vals)
    stats[d.key] = { mean: m, sd: s }
    if (s > 1e-6) dims.push(d.key)
  }
  const z = new Map()
  for (const t of active) {
    const r = raw.get(t.team)
    const vec = {}
    for (const d of DIMS) {
      vec[d.key] = dims.includes(d.key) ? clamp((r[d.key] - stats[d.key].mean) / stats[d.key].sd, -4, 4) : 0
    }
    z.set(t.team, vec)
  }
  return { z, stats, active, raw, dims }
}

const dist = (a, b, dims) => {
  let s = 0
  for (const k of dims) s += (a[k] - b[k]) ** 2
  return s
}

function kmeans(points, k, dims, iters = 50) {
  const keys = [...points.keys()]
  if (!keys.length || !dims.length) return { assignments: new Map(), centroids: [] }
  k = Math.max(1, Math.min(k, keys.length))
  const centroids = [points.get(keys[0])]
  while (centroids.length < k) {
    let best = null
    let bestD = -1
    for (const key of keys) {
      const p = points.get(key)
      const dmin = Math.min(...centroids.map((c) => dist(p, c, dims)))
      if (dmin > bestD) {
        bestD = dmin
        best = p
      }
    }
    if (!best) break
    centroids.push(best)
  }
  let assign = new Map()
  for (let it = 0; it < iters; it++) {
    const next = new Map()
    for (const key of keys) {
      const p = points.get(key)
      let bi = 0
      let bd = Infinity
      centroids.forEach((c, i) => {
        const d = dist(p, c, dims)
        if (d < bd) {
          bd = d
          bi = i
        }
      })
      next.set(key, bi)
    }
    const changed = [...next.entries()].some(([k2, v]) => assign.get(k2) !== v)
    assign = next
    for (let i = 0; i < centroids.length; i++) {
      const members = [...assign.entries()].filter(([, v]) => v === i).map(([k2]) => points.get(k2))
      if (!members.length) continue
      const c = { ...centroids[i] }
      for (const d of dims) c[d] = mean(members.map((m) => m[d]))
      centroids[i] = c
    }
    if (!changed) break
  }
  return { assignments: assign, centroids }
}

function labelCluster(z, dims) {
  const entries = dims.map((k) => [k, z[k] || 0]).sort((a, b) => b[1] - a[1])
  const strong = entries.filter(([, v]) => v > 0.55).map(([k]) => k)
  const weak = entries.filter(([, v]) => v < -0.55).map(([k]) => k)
  const has = (k) => strong.includes(k)

  if (has('scoring') && has('ceiling')) return 'High-ceiling scorer'
  if (has('auton') && has('skills')) return 'Auton and skills specialist'
  if (has('floor') && has('consistency')) return 'Reliable floor-raiser'
  if (has('clutch') && has('scoring')) return 'Big-match scorer'
  if (has('clutch')) return 'Elimination riser'
  if (has('skills')) return 'Skills specialist'
  if (has('auton')) return 'Autonomous specialist'
  if (has('consistency') && weak.includes('ceiling')) return 'Low-ceiling grinder'
  if (has('discipline') && weak.includes('scoring')) return 'Low-output support bot'
  if (has('ceiling')) return 'Explosive but streaky'
  if (weak.includes('consistency')) return 'Volatile wildcard'
  if (weak.includes('scoring') && weak.includes('ceiling')) return 'Developing program'
  if (weak.includes('scoring')) return 'Under-powered'
  return 'Balanced all-rounder'
}

export function buildArchetypes(ratings, scoutingRows = []) {
  const { z, stats, active, dims } = featureMatrix(ratings)
  const k = clamp(Math.round(Math.sqrt(active.length / 3)), 3, 5)
  const { assignments, centroids } = kmeans(z, k, dims)
  const scouting = new Map(scoutingRows.map((r) => [r.team, r.data || {}]))

  const clusters = centroids.map((c, i) => {
    const members = [...assignments.entries()].filter(([, v]) => v === i).map(([key]) => key).sort()
    const signature = dims
      .map((k2) => [k2, c[k2] || 0])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k2]) => DIMS.find((d) => d.key === k2)?.label || k2)
    return {
      index: i,
      label: labelCluster(c, dims),
      centroid: Object.fromEntries(dims.map((k2) => [k2, round(c[k2] || 0, 2)])),
      members,
      size: members.length,
      signature
    }
  })

  // Disambiguate identical labels with the next-strongest dimension, which is more
  // informative than "(2)".
  const seen = new Map()
  for (const c of clusters) {
    const n = (seen.get(c.label) || 0) + 1
    seen.set(c.label, n)
    if (n > 1) c.label = `${c.label} · ${c.signature[1] || c.signature[0] || n}`
  }

  const teams = new Map()
  for (const t of active) {
    const idx = assignments.get(t.team)
    const cluster = clusters.find((c) => c.index === idx)
    const scout = scouting.get(t.team) || null
    teams.set(t.team, {
      team: t.team,
      archetype: scout?.archetype || cluster?.label || 'Unclassified',
      derivedArchetype: cluster?.label || 'Unclassified',
      clusterIndex: idx,
      z: Object.fromEntries(Object.entries(z.get(t.team) || {}).map(([k2, v]) => [k2, round(v, 2)])),
      signature: cluster?.signature || [],
      tendencies: tendencies(t),
      scouting: scout
    })
  }

  return { clusters, teams, dims: DIMS, activeDims: dims, stats, scoutingFields: SCOUTING_FIELDS }
}
