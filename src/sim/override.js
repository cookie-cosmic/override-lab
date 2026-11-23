/**
 * JavaScript port of the reference Override simulator (github.com/Joboyoyo/vex-override-sim).
 *
 * The original is Python + pygame; it cannot run in a browser or in the Node API, so the tab
 * runs this port in the page instead. The model is unchanged:
 *
 *   - core/rules.yaml   -> POINTS / RULES below
 *   - core/scoring.py   -> scorePins / park / auto bonus / AWP
 *   - strategy/scenario.py -> DEFAULT_SCENARIO
 *   - strategy/strategies.py -> STRATEGIES (safe, yellow_gamble, hybrid, do_nothing)
 *   - strategy/simulate.py -> playOneMatch / runMatchup
 *
 * Scoring, per Game Manual v0.1:
 *   Each pin has two coloured halves and only one of them is visible once stacked
 *   (the bottom sits in the goal, the top is capped). So a pin is worth either:
 *   - 5 to the alliance whose colour is on top ("safe" orientation), or
 *   - 10 to the owner of the quadrant toggle / midfield majority, if the yellow half is on top.
 *     A yellow half in a quadrant the opponent owns pays THEM 10 — the gamble's downside.
 *   - Yellow in an unset or yellow toggle scores for nobody.
 *   Plus: +8 per robot parked in midfield at the buzzer, +12 to the higher auto score
 *   (+6 each on a tie), and an AWP if >= 7 pins score across >= 3 goals with >= 2 pins each,
 *   with both robots clear of the perimeter and no auto violations.
 */

export const POINTS = {
  alliancePin: 5,
  yellowPin: 10,
  park: 8,
  autoBonus: 12,
  autoTie: 6
}

export const RULES = {
  match: { autoSeconds: 15, driverSeconds: 105, endgameSeconds: 20 },
  field: { sizeFt: 12, quadrants: 4, goals: 9, pins: 63, cups: 56, toggles: 4 },
  awp: { pins: 7, goals: 3, perGoal: 2 },
  loading: { matchLoadsPerAlliance: 10, matchLoadsDriverOnly: true }
}

// Goal -> scoring quadrant, and whether yellow halves there are owned by the midfield majority.
const GOALS = [
  { id: 0, quadrant: 3, awpSide: 'red' },
  { id: 1, quadrant: 2, awpSide: 'red' },
  { id: 2, quadrant: 0, awpSide: 'blue' },
  { id: 3, quadrant: 1, awpSide: 'blue' },
  { id: 4, quadrant: 0, awpSide: 'blue' },
  { id: 5, quadrant: 1, awpSide: 'blue' },
  { id: 6, quadrant: 2, awpSide: 'red' },
  { id: 7, quadrant: 3, awpSide: 'red' },
  { id: 8, quadrant: null, awpSide: null, midfield: true }
]

// strategies.py lays the field out diagonally: red owns the left and bottom quadrants.
const LAYOUT = {
  red: { allianceGoals: [0, 1], shorts: [6, 7], ownQuadrants: [2, 3], oppQuadrants: [0, 1] },
  blue: { allianceGoals: [2, 3], shorts: [4, 5], ownQuadrants: [0, 1], oppQuadrants: [2, 3] }
}

export const STRATEGIES = [
  {
    id: 'safe',
    label: 'Safe',
    blurb: 'Alliance colour committed everywhere. 5 points a pin, no toggle dependency.'
  },
  {
    id: 'yellow_gamble',
    label: 'Yellow gamble',
    blurb: 'Yellow committed everywhere: 10 a pin if the toggles hold, 10 to them if they do not.'
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    blurb: 'Safe scoring, but spends the endgame denying both opponent toggles.'
  },
  {
    id: 'do_nothing',
    label: 'Do nothing',
    blurb: 'Baseline: no pins, no toggles, no park. Useful to read the floor of the model.'
  }
]

export const DEFAULT_SCENARIO = {
  autoPinSuccess: 0.9,
  autoToggleSetSuccess: 0.85,
  driverPinSuccess: 0.92,
  robotsClearPerimeter: 0.95,
  myToggleHeld: 0.5,
  oppToggleDenied: 0.5,
  robotReachesMidfield: 0.8
}

export const SCENARIO_FIELDS = [
  { key: 'autoPinSuccess', label: 'Auto pin success', hint: 'per attempted autonomous pin' },
  { key: 'autoToggleSetSuccess', label: 'Auto toggle set', hint: 'per attempted toggle in auto' },
  { key: 'driverPinSuccess', label: 'Match-load success', hint: 'per attempted driver pin' },
  { key: 'robotsClearPerimeter', label: 'Bots clear of perimeter', hint: 'both robots, end of auto (AWP)' },
  { key: 'myToggleHeld', label: 'My toggle survives', hint: 'auto-set toggles still owned at the buzzer' },
  { key: 'oppToggleDenied', label: 'I deny their toggle', hint: 'per toggle in the denial list' },
  { key: 'robotReachesMidfield', label: 'Reach midfield', hint: 'per robot committed to the park' }
]

export function makeSpec(id, alliance) {
  const L = LAYOUT[alliance]
  const base = {
    id,
    alliance,
    autoPins: 7,
    autoOrient: 'safe',
    autoGoals: [L.allianceGoals[0], L.shorts[0], L.shorts[1]],
    autoToggles: [L.ownQuadrants[0]],
    matchLoads: 10,
    matchLoadOrient: 'safe',
    matchLoadGoal: L.allianceGoals[1],
    denyQuadrants: [L.oppQuadrants[0]],
    midfieldRobots: 1
  }
  if (id === 'yellow_gamble') {
    return { ...base, autoOrient: 'yellow', autoToggles: [...L.ownQuadrants], matchLoadOrient: 'yellow', denyQuadrants: [], midfieldRobots: 2 }
  }
  if (id === 'hybrid') {
    return { ...base, autoToggles: [...L.ownQuadrants], denyQuadrants: [...L.oppQuadrants] }
  }
  if (id === 'do_nothing') {
    return { ...base, autoPins: 0, autoToggles: [], matchLoads: 0, denyQuadrants: [], midfieldRobots: 0 }
  }
  return base
}

const other = (alliance) => (alliance === 'red' ? 'blue' : 'red')
const hit = (p, rnd) => rnd() < p
const between = (lo, hi, rnd) => lo + rnd() * (hi - lo)

/** Deterministic PRNG so a run can be repeated from its seed. */
export function rngFrom(seed) {
  let a = (Number(seed) || 1) >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Score every visible half of every placed pin. `toggles[q]` is 'red' | 'blue' | null. */
function scorePins(pins, toggles, midfieldOwner, buckets) {
  let red = 0
  let blue = 0
  for (const pin of pins) {
    if (pin.orient === 'safe') {
      if (pin.alliance === 'red') red += POINTS.alliancePin
      else blue += POINTS.alliancePin
      if (buckets) buckets[pin.alliance].alliancePin += POINTS.alliancePin
      continue
    }
    const goal = GOALS[pin.goal]
    const owner = goal.midfield ? midfieldOwner : toggles[goal.quadrant]
    if (!owner) continue
    if (owner === 'red') red += POINTS.yellowPin
    else blue += POINTS.yellowPin
    if (buckets) {
      buckets[owner].yellowPin += POINTS.yellowPin
      if (owner !== pin.alliance) buckets[other(pin.alliance)].yellowConceded += POINTS.yellowPin
    }
  }
  return { red, blue }
}

/** AWP counting: pins scoring for `alliance`, excluding goals on its opponent's side of the line. */
function awpGoals(world, alliance) {
  const perGoal = {}
  for (const pin of world.pins) {
    const goal = GOALS[pin.goal]
    if (goal.awpSide && goal.awpSide !== alliance) continue
    const owner = goal.midfield ? world.midfieldOwner : world.toggles[goal.quadrant]
    let scoresForUs = false
    if (pin.orient === 'safe') scoresForUs = pin.alliance === alliance
    else scoresForUs = owner === alliance
    if (!scoresForUs) continue
    perGoal[pin.goal] = (perGoal[pin.goal] || 0) + 1
  }
  return perGoal
}

function awpEligible(world, alliance) {
  const perGoal = awpGoals(world, alliance)
  const total = Object.values(perGoal).reduce((n, c) => n + c, 0)
  if (total < RULES.awp.pins) return false
  const qualifying = Object.values(perGoal).filter((c) => c >= RULES.awp.perGoal).length
  if (qualifying < RULES.awp.goals) return false
  return world.clear[alliance]
}

/** One match: auto placements, auto toggles, auto snapshot, match loads, buzzer, park, score. */
export function playOneMatch(red, blue, scenario, rnd, buckets) {
  const world = { pins: [], toggles: [null, null, null, null], midfield: { red: 0, blue: 0 }, clear: {} }

  // Autonomous: pin attempts spread round-robin across the declared goals.
  const auto = { red: [], blue: [] }
  for (const [alliance, spec] of [
    ['red', red],
    ['blue', blue]
  ]) {
    for (let i = 0; i < spec.autoPins; i += 1) {
      if (hit(scenario.autoPinSuccess, rnd)) {
        const pin = { alliance, goal: spec.autoGoals[i % spec.autoGoals.length], orient: spec.autoOrient }
        auto[alliance].push(pin)
        world.pins.push(pin)
      }
    }
  }

  // Autonomous toggles. Own quadrants do not overlap, so order only matters for a mirror plan.
  for (const [alliance, spec] of [
    ['red', red],
    ['blue', blue]
  ]) {
    for (const q of spec.autoToggles) {
      if (hit(scenario.autoToggleSetSuccess, rnd)) world.toggles[q] = alliance
    }
  }

  world.clear.red = hit(scenario.robotsClearPerimeter, rnd)
  world.clear.blue = hit(scenario.robotsClearPerimeter, rnd)

  // Auto snapshot: pins placed in auto, toggles as they stand, no park, no bonus yet.
  const autoScore = scorePins(world.pins, world.toggles, null, null)
  const awp = { red: awpEligible(world, 'red'), blue: awpEligible(world, 'blue') }

  // Driver match loads.
  for (const [alliance, spec] of [
    ['red', red],
    ['blue', blue]
  ]) {
    for (let i = 0; i < spec.matchLoads; i += 1) {
      if (hit(scenario.driverPinSuccess, rnd)) {
        world.pins.push({ alliance, goal: spec.matchLoadGoal, orient: spec.matchLoadOrient })
      }
    }
  }

  // Buzzer: an auto-set toggle survives pressure, then the opponent's denial list may clear it.
  for (const [alliance, spec] of [
    ['red', red],
    ['blue', blue]
  ]) {
    for (const q of spec.autoToggles) {
      if (world.toggles[q] === alliance && !hit(scenario.myToggleHeld, rnd)) world.toggles[q] = null
    }
  }
  for (const [alliance, spec] of [
    ['red', red],
    ['blue', blue]
  ]) {
    const enemy = other(alliance)
    for (const q of spec.denyQuadrants) {
      if (world.toggles[q] === enemy && hit(scenario.oppToggleDenied, rnd)) world.toggles[q] = null
    }
  }

  // Endgame park. Midfield majority also owns yellow halves in the tall goal.
  for (const [alliance, spec] of [
    ['red', red],
    ['blue', blue]
  ]) {
    for (let i = 0; i < spec.midfieldRobots; i += 1) {
      if (hit(scenario.robotReachesMidfield, rnd)) world.midfield[alliance] += 1
    }
  }
  world.midfieldOwner =
    world.midfield.red > world.midfield.blue ? 'red' : world.midfield.blue > world.midfield.red ? 'blue' : null

  const scored = scorePins(world.pins, world.toggles, world.midfieldOwner, buckets)

  // Auto bonus: +12 to the higher auto score, +6 each on a tie (including 0-0).
  let redBonus = 0
  let blueBonus = 0
  if (autoScore.red > autoScore.blue) redBonus = POINTS.autoBonus
  else if (autoScore.blue > autoScore.red) blueBonus = POINTS.autoBonus
  else {
    redBonus = POINTS.autoTie
    blueBonus = POINTS.autoTie
  }

  const park = { red: world.midfield.red * POINTS.park, blue: world.midfield.blue * POINTS.park }
  if (buckets) {
    buckets.red.park += park.red
    buckets.blue.park += park.blue
    buckets.red.autoBonus += redBonus
    buckets.blue.autoBonus += blueBonus
  }

  return {
    red: scored.red + park.red + redBonus,
    blue: scored.blue + park.blue + blueBonus,
    autoRed: autoScore.red,
    autoBlue: autoScore.blue,
    awpRed: awp.red,
    awpBlue: awp.blue
  }
}

const mean = (xs) => xs.reduce((n, x) => n + x, 0) / (xs.length || 1)
const sd = (xs) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / (xs.length || 1))
}
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))]
const r1 = (x) => Math.round(x * 10) / 10

/** Run a matchup N times and aggregate the same statistics as simulate.py's MatchupStats. */
export function runMatchup(redId, blueId, scenario = DEFAULT_SCENARIO, trials = 2000, seed = Date.now()) {
  const redSpec = makeSpec(redId, 'red')
  const blueSpec = makeSpec(blueId, 'blue')
  const rnd = rngFrom(seed)
  const buckets = {
    red: { alliancePin: 0, yellowPin: 0, yellowConceded: 0, park: 0, autoBonus: 0 },
    blue: { alliancePin: 0, yellowPin: 0, yellowConceded: 0, park: 0, autoBonus: 0 }
  }
  const redScores = []
  const blueScores = []
  let redWins = 0
  let blueWins = 0
  let ties = 0
  let awpRed = 0
  let awpBlue = 0

  for (let i = 0; i < trials; i += 1) {
    const out = playOneMatch(redSpec, blueSpec, scenario, rnd, buckets)
    redScores.push(out.red)
    blueScores.push(out.blue)
    if (out.red > out.blue) redWins += 1
    else if (out.blue > out.red) blueWins += 1
    else ties += 1
    if (out.awpRed) awpRed += 1
    if (out.awpBlue) awpBlue += 1
  }

  const sortedRed = [...redScores].sort((a, b) => a - b)
  const sortedBlue = [...blueScores].sort((a, b) => a - b)
  const margins = redScores.map((r, i) => r - blueScores[i])
  // Avoid a spread over every score: 10k trials would push 20k arguments into Math.max.
  const top = redScores.concat(blueScores).reduce((m, x) => (x > m ? x : m), 0)

  // 10-point histogram, one row per bin, for the distribution readout.
  const bins = []
  const limit = Math.max(60, Math.ceil((top + 1) / 10) * 10)
  for (let from = 0; from <= limit; from += 10) {
    const count = (xs) => xs.filter((x) => x >= from && x < from + 10).length
    bins.push({ from, red: count(redScores), blue: count(blueScores) })
  }

  const side = (scores, sorted, wins, awpRate, b) => ({
    mean: r1(mean(scores)),
    sd: r1(sd(scores)),
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    winRate: wins / trials,
    awpRate: awpRate / trials,
    breakdown: {
      alliancePin: r1(b.alliancePin / trials),
      yellowPin: r1(b.yellowPin / trials),
      yellowConceded: r1(b.yellowConceded / trials),
      park: r1(b.park / trials),
      autoBonus: r1(b.autoBonus / trials)
    }
  })

  return {
    seed,
    trials,
    red: side(redScores, sortedRed, redWins, awpRed, buckets.red),
    blue: side(blueScores, sortedBlue, blueWins, awpBlue, buckets.blue),
    tieRate: ties / trials,
    margin: r1(mean(margins)),
    bins
  }
}
