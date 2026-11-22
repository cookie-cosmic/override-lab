// Weakness detection: the specific holes in an opponent's game, in terms a coach can act on.
//
// Two sources feed it:
//  - the counter rule base (data/counter-rules.json), where a rule only fires because an
//    opponent metric crossed a threshold, and
//  - the rating model itself: a low floor, a wide spread, penalties or a thin sample are
//    weaknesses even when no rule fires.
//
// Conceptual mode has neither of those (the event has not run), so historyWeaknesses() reads
// the same idea off a team's season: scoring below the field, a losing record, a collapse in
// form, or simply too little evidence to trust any of it.
//
// Every entry is a claim about observed numbers. None of it says a team cannot improve.
import { round } from '../util.js'

const WEIGHT = { high: 3, medium: 2, low: 1 }

function add(list, id, label, detail, severity = 'medium') {
  if (list.some((w) => w.id === id)) return
  list.push({ id, label, detail, severity, weight: WEIGHT[severity] || 2 })
}

const median = (values) => {
  const vals = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b)
  return vals.length ? vals[Math.floor(vals.length / 2)] : null
}

/** Field medians, used as the comparison baseline instead of hardcoded numbers. */
export function fieldBaseline(teams = []) {
  const list = (teams || []).filter((t) => t && t.matches > 0)
  return {
    auton: median(list.map((t) => t.autonPerMatch)),
    penalties: median(list.map((t) => t.penaltyPerMatch)),
    floor: median(list.map((t) => t.floor)),
    avgPoints: median(list.map((t) => t.avgPoints)),
    cv: median(list.map((t) => t.cv)),
    winRate: median(list.map((t) => t.winRate)),
    prog: median(list.map((t) => t.skills?.prog))
  }
}

/**
 * Weaknesses visible in one event's results.
 * `vectors` are the counter-rule hits already computed for this opponent.
 */
export function eventWeaknesses(team, { vectors = [], baseline = {} } = {}) {
  const out = []
  if (!team) return out
  const b = baseline || {}

  if (team.penaltyPerMatch != null && team.penaltyPerMatch >= 4 && (b.penalties == null || team.penaltyPerMatch > b.penalties * 1.2)) {
    add(out, 'penalties', 'gives away penalties', `${round(team.penaltyPerMatch, 1)} pts of penalties per match`, 'high')
  }
  if (team.autonPerMatch != null && team.autonPerMatch < (b.auton != null ? b.auton * 0.65 : 8)) {
    add(out, 'auton', 'thin autonomous', `${round(team.autonPerMatch, 1)} auton pts per match vs ${b.auton != null ? round(b.auton, 1) : 'the field'}`, 'high')
  }
  if (team.cv != null && team.cv > Math.max(0.32, (b.cv ?? 0) * 1.3)) {
    add(out, 'inconsistent', 'inconsistent scoring', `spread is ${Math.round(team.cv * 100)}% of its average`, 'medium')
  }
  if (team.ceiling != null && team.floor != null && team.ceiling - team.floor >= 60) {
    add(out, 'spread', 'huge floor-to-ceiling gap', `${round(team.floor, 0)} floor, ${round(team.ceiling, 0)} ceiling`, 'medium')
  }
  if (team.floor != null && b.floor != null && team.floor < b.floor * 0.75) {
    add(out, 'floor', 'low floor', `worst-case matches land near ${round(team.floor, 0)} pts`, 'medium')
  }
  if (team.clutch != null && team.clutch < -3) {
    add(out, 'clutch', 'fades in eliminations', `${round(team.clutch, 1)} pts below its qualification average in elims`, 'medium')
  }
  if (team.matches >= 5 && team.winRate != null && team.winRate < 0.4) {
    add(out, 'record', 'losing record here', `${team.wins}–${team.losses} at this event`, 'medium')
  }
  if (team.skills?.prog != null && team.skills.prog > 0 && team.skills.prog < 15) {
    add(out, 'prog', 'weak programming skills', `${round(team.skills.prog, 0)} programming pts`, 'low')
  }
  if (team.matches > 0 && team.matches < 4) {
    add(out, 'sample', 'thin sample', `only ${team.matches} match${team.matches === 1 ? '' : 'es'} to judge from`, 'low')
  }

  // A rule only fires when a threshold was crossed, so each hit names something to attack.
  // A rule about a metric already described above would only restate it ("contest autonomous"
  // next to "thin autonomous"), so that one is skipped.
  const metricId = {
    autonPerMatch: 'auton',
    penaltyPerMatch: 'penalties',
    floor: 'floor',
    cv: 'inconsistent',
    clutch: 'clutch',
    ceiling: 'spread',
    ceilingGap: 'spread',
    spread: 'spread',
    winRate: 'record'
  }
  for (const v of vectors) {
    if (!v) continue
    const covered = metricId[v.metric]
    if (covered && out.some((w) => w.id === covered)) continue
    const severity = (v.expectedPoints ?? 0) >= 10 ? 'high' : 'medium'
    add(out, `counter-${v.id || v.title}`, v.title, v.trigger || v.action, severity)
  }
  return out.sort((x, y) => y.weight - x.weight)
}

/** Weaknesses read from a team's previous tournaments, for an event that has not run. */
export function historyWeaknesses(history, { baseline = {} } = {}) {
  const out = []
  if (!history || !history.matches) return out
  const b = baseline || {}
  if (history.avgScore != null && b.avgScore != null && history.avgScore < b.avgScore * 0.8) {
    add(out, 'scoring', 'below-field scoring', `${round(history.avgScore, 0)} pts per match vs ${round(b.avgScore, 0)} for the field`, 'high')
  }
  if (history.avgMargin != null && history.avgMargin <= -8) {
    add(out, 'margin', 'loses by double digits', `${round(history.avgMargin, 1)} average margin`, 'high')
  }
  if (history.winRate != null && history.matches >= 6 && history.winRate < 0.4) {
    add(out, 'record', 'losing season record', `${history.wins}–${history.losses}${history.ties ? `–${history.ties}` : ''} this season`, 'high')
  }
  if (history.cv != null && history.cv > Math.max(0.3, (b.cv ?? 0) * 1.3)) {
    add(out, 'inconsistent', 'inconsistent scoring', `spread is ${Math.round(history.cv * 100)}% of its average`, 'medium')
  }
  if (history.floor != null && b.floor != null && history.floor < b.floor * 0.8) {
    add(out, 'floor', 'low floor', `10th-percentile matches near ${round(history.floor, 0)} pts`, 'medium')
  }
  const form = (history.form || []).filter((g) => g.won != null)
  if (form.length >= 4 && form.slice(0, 4).filter((g) => g.won).length <= 1) {
    add(out, 'form', 'poor recent form', `${form.slice(0, 4).filter((g) => g.won).length} win${form.slice(0, 4).filter((g) => g.won).length === 1 ? '' : 's'} in the last ${Math.min(5, form.length)} matches`, 'medium')
  }
  if (history.matches < 6) {
    add(out, 'sample', 'thin sample', `only ${history.matches} match${history.matches === 1 ? '' : 'es'} this season`, 'low')
  }
  if ((history.events || []).length === 1) {
    add(out, 'experience', 'one event of experience', 'nothing yet from a second tournament', 'low')
  }
  return out.sort((x, y) => y.weight - x.weight)
}

/** Top n weaknesses, deduplicated by id. */
export function topWeaknesses(list, n = 4) {
  const seen = new Set()
  const out = []
  for (const w of list || []) {
    const key = w.id || w.label
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
    if (out.length >= n) break
  }
  return out
}

/** Count how often each weakness turns up across the field, for the soft-spot summary. */
export function aggregateWeaknesses(rows, n = 6) {
  const tally = new Map()
  for (const row of rows || []) {
    for (const w of row.weaknesses || []) {
      const cur = tally.get(w.id) || { id: w.id, label: w.label, count: 0, teams: [] }
      cur.count += 1
      if (cur.teams.length < 6) cur.teams.push(row.team)
      tally.set(w.id, cur)
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, n)
}
