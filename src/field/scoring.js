// Override field model and scoring.
//
// Geometry follows the 12 ft field used by the season's reference implementation: nine goals,
// four wall-midpoint toggles, diagonal quadrants and the tall goal in the centre of the
// midfield. Scoring follows the manual's definitions rather than headline totals:
//
//   - a pin scores per *visible* half, and visibility comes from the stack (a pin in the goal
//     has its bottom half covered; a cup's clear face decides which neighbouring half shows);
//   - an alliance-coloured half is 5 points to that alliance;
//   - a visible yellow half is 10 points to whoever owns it: the quadrant's toggle for a
//     quadrant goal, or the alliance with more robots in the midfield for the tall goal;
//   - a yellow or unset toggle owns nothing, and a toggle state never scores directly;
//   - each robot parked in the midfield is 8 points;
//   - the autonomous bonus is 12 to the higher auto score, or 6 each on a tie (including 0–0).
//
// AWP is evaluated from the same visible halves: seven pins for the alliance across at least
// three goals with two or more pins each, on the alliance's own side of the autonomous line,
// with both robots clear of the perimeter.

export const POINTS = {
  alliancePin: 5,
  yellowPin: 10,
  midfieldPerRobot: 8,
  autoBonus: 12,
  autoBonusTie: 6
}

export const AWP_RULES = {
  pins: 7,
  goals: 3,
  perGoal: 2
}

// Field coordinates run -6..6 on both axes. +y is up the field (blue's top wall).
export const GOALS = [
  { id: 0, kind: 'alliance', alliance: 'red', x: -4, y: -2, quadrant: 3, awpSide: 'red', label: 'Red goal' },
  { id: 1, kind: 'alliance', alliance: 'red', x: -2, y: -4, quadrant: 2, awpSide: 'red', label: 'Red goal' },
  { id: 2, kind: 'alliance', alliance: 'blue', x: 2, y: 4, quadrant: 0, awpSide: 'blue', label: 'Blue goal' },
  { id: 3, kind: 'alliance', alliance: 'blue', x: 4, y: 2, quadrant: 1, awpSide: 'blue', label: 'Blue goal' },
  { id: 4, kind: 'short', alliance: 'neutral', x: -2, y: 4, quadrant: 0, awpSide: 'blue', label: 'Neutral goal' },
  { id: 5, kind: 'short', alliance: 'neutral', x: 4, y: -2, quadrant: 1, awpSide: 'blue', label: 'Neutral goal' },
  { id: 6, kind: 'short', alliance: 'neutral', x: 2, y: -4, quadrant: 2, awpSide: 'red', label: 'Neutral goal' },
  { id: 7, kind: 'short', alliance: 'neutral', x: -4, y: 2, quadrant: 3, awpSide: 'red', label: 'Neutral goal' },
  { id: 8, kind: 'tall', alliance: 'neutral', x: 0, y: 0, quadrant: 0, midfield: true, awpSide: 'neutral', label: 'Tall goal' }
]

export const TOGGLES = [
  { q: 0, x: 0, y: 6, side: 'top' },
  { q: 1, x: 6, y: 0, side: 'right' },
  { q: 2, x: 0, y: -6, side: 'bottom' },
  { q: 3, x: -6, y: 0, side: 'left' }
]

export const QUADRANT_NAMES = ['Top', 'Right', 'Bottom', 'Left']

// -6..6 → 24..576 inside a 600 box, leaving room for wall toggles and labels.
export const toSvg = (x, y) => ({ x: 300 + x * 46, y: 300 - y * 46 })

export const PIN_PRESETS = [
  { id: 'red', label: 'Red / yellow', top: 'red', bottom: 'yellow' },
  { id: 'blue', label: 'Blue / yellow', top: 'blue', bottom: 'yellow' },
  { id: 'yellow', label: 'Yellow / yellow', top: 'yellow', bottom: 'yellow' },
  { id: 'split', label: 'Red / blue', top: 'red', bottom: 'blue' }
]

let uid = 0
export const nextId = () => `${Date.now().toString(36)}-${(uid++).toString(36)}`

export function emptyScenario() {
  return {
    goals: {},
    toggles: { 0: 'yellow', 1: 'yellow', 2: 'yellow', 3: 'yellow' },
    robots: { red: 0, blue: 0 },
    auto: { red: '', blue: '' },
    perimeterClear: { red: true, blue: true }
  }
}

export function normalizeScenario(input) {
  const base = emptyScenario()
  if (!input || typeof input !== 'object') return base
  return {
    ...base,
    ...input,
    goals: input.goals && typeof input.goals === 'object' ? input.goals : {},
    toggles: { ...base.toggles, ...(input.toggles || {}) },
    robots: { ...base.robots, ...(input.robots || {}) },
    auto: { ...base.auto, ...(input.auto || {}) },
    perimeterClear: { ...base.perimeterClear, ...(input.perimeterClear || {}) }
  }
}

export const stackOf = (scenario, goalId) => scenario.goals?.[goalId] || []

export function makePin(presetId = 'red') {
  const p = PIN_PRESETS.find((x) => x.id === presetId) || PIN_PRESETS[0]
  return { id: nextId(), type: 'pin', preset: p.id, top: p.top, bottom: p.bottom }
}

export function makeCup(clearUp = true) {
  return { id: nextId(), type: 'cup', clearUp }
}

/**
 * Visible half indices for every pin in a stack, exactly as the field physics defines them:
 * 0 = top half, 1 = bottom half.
 */
export function visibleHalves(stack = []) {
  const out = []
  stack.forEach((node, i) => {
    if (node.type !== 'pin') return
    const halves = []
    if (i > 0) {
      const below = stack[i - 1]
      if (below && below.type === 'cup' && below.clearUp) halves.push(1)
    }
    if (i === stack.length - 1) {
      halves.push(0)
    } else {
      const above = stack[i + 1]
      if (above && above.type === 'cup' && !above.clearUp) halves.push(0)
    }
    out.push({ index: i, pin: node, halves })
  })
  return out
}

export function midfieldOwner(scenario) {
  const red = Number(scenario.robots?.red) || 0
  const blue = Number(scenario.robots?.blue) || 0
  if (red > blue) return 'red'
  if (blue > red) return 'blue'
  return 'none'
}

export function toggleOwner(scenario, quadrant) {
  const state = scenario.toggles?.[quadrant] || 'yellow'
  return state === 'red' || state === 'blue' ? state : 'none'
}

/** Which alliance a visible yellow half pays, if any. */
export function yellowPayee(scenario, goal) {
  return goal.midfield ? midfieldOwner(scenario) : toggleOwner(scenario, goal.quadrant)
}

const GOAL_BY_ID = new Map(GOALS.map((g) => [g.id, g]))

export function scoreScenario(input) {
  const scenario = normalizeScenario(input)
  const lines = []
  const perGoal = []
  const add = (source, alliance, points, detail) => {
    // Unscored yellow halves are kept as zero-point lines so the UI can explain them.
    if (!points && source !== 'yellow_unowned') return
    lines.push({ source, alliance, points, detail })
  }

  for (const goal of GOALS) {
    const stack = stackOf(scenario, goal.id)
    if (!stack.length) continue
    const owner = goal.midfield ? midfieldOwner(scenario) : null
    const visible = visibleHalves(stack)
    const detail = { goalId: goal.id, goalLabel: goal.label, red: 0, blue: 0, halves: [] }
    for (const row of visible) {
      for (const half of row.halves) {
        const color = half === 0 ? row.pin.top : row.pin.bottom
        const where = `${goal.label} · ${half === 0 ? 'top' : 'bottom'} half`
        if (color === 'red') {
          add('alliance_pin', 'red', POINTS.alliancePin, where)
          detail.red += POINTS.alliancePin
        } else if (color === 'blue') {
          add('alliance_pin', 'blue', POINTS.alliancePin, where)
          detail.blue += POINTS.alliancePin
        } else {
          const payee = goal.midfield ? owner : toggleOwner(scenario, goal.quadrant)
          if (payee === 'red' || payee === 'blue') {
            add('yellow_pin', payee, POINTS.yellowPin, `${where} · yellow owned by ${payee}`)
            if (payee === 'red') detail.red += POINTS.yellowPin
            else detail.blue += POINTS.yellowPin
          } else {
            add('yellow_unowned', 'none', 0, `${where} · no owner, 0 points`)
            detail.halves.push({ color, state: 'unowned' })
            continue
          }
        }
        detail.halves.push({ color, state: 'scored' })
      }
    }
    perGoal.push(detail)
  }

  for (const side of ['red', 'blue']) {
    const robots = Math.min(2, Math.max(0, Number(scenario.robots?.[side]) || 0))
    for (let i = 0; i < robots; i++) add('midfield', side, POINTS.midfieldPerRobot, `robot ${i + 1} parked`)
  }

  const autoRed = scenario.auto.red === '' || scenario.auto.red == null ? null : Number(scenario.auto.red)
  const autoBlue = scenario.auto.blue === '' || scenario.auto.blue == null ? null : Number(scenario.auto.blue)
  if (Number.isFinite(autoRed) && Number.isFinite(autoBlue)) {
    if (autoRed > autoBlue) add('auto_bonus', 'red', POINTS.autoBonus, `auto ${autoRed}–${autoBlue}`)
    else if (autoBlue > autoRed) add('auto_bonus', 'blue', POINTS.autoBonus, `auto ${autoBlue}–${autoRed}`)
    else {
      add('auto_bonus', 'red', POINTS.autoBonusTie, `auto tied ${autoRed}–${autoBlue}`)
      add('auto_bonus', 'blue', POINTS.autoBonusTie, `auto tied ${autoRed}–${autoBlue}`)
    }
  }

  const totals = { red: 0, blue: 0 }
  for (const line of lines) {
    if (line.alliance === 'red') totals.red += line.points
    if (line.alliance === 'blue') totals.blue += line.points
  }

  // -- AWP, from the same visible halves -------------------------------------------------
  const awp = {}
  for (const side of ['red', 'blue']) {
    const opposing = side === 'red' ? 'blue' : 'red'
    const pinsByGoal = new Map()
    for (const goal of GOALS) {
      if (goal.awpSide === opposing) continue
      const stack = stackOf(scenario, goal.id)
      if (!stack.length) continue
      const payee = goal.midfield ? midfieldOwner(scenario) : toggleOwner(scenario, goal.quadrant)
      for (const row of visibleHalves(stack)) {
        const scores = row.halves.some((half) => {
          const color = half === 0 ? row.pin.top : row.pin.bottom
          if (color === side) return true
          return color === 'yellow' && payee === side
        })
        if (!scores) continue
        pinsByGoal.set(goal.id, (pinsByGoal.get(goal.id) || 0) + 1)
      }
    }
    const pins = [...pinsByGoal.values()].reduce((a, b) => a + b, 0)
    const qualifyingGoals = [...pinsByGoal.values()].filter((n) => n >= AWP_RULES.perGoal).length
    const clear = Boolean(scenario.perimeterClear?.[side])
    const requirements = [
      { id: 'pins', label: `At least ${AWP_RULES.pins} pins scoring for ${side}`, met: pins >= AWP_RULES.pins, value: `${pins}/${AWP_RULES.pins}` },
      {
        id: 'goals',
        label: `${AWP_RULES.goals} goals with ${AWP_RULES.perGoal}+ pins`,
        met: qualifyingGoals >= AWP_RULES.goals,
        value: `${qualifyingGoals}/${AWP_RULES.goals}`
      },
      { id: 'perimeter', label: 'Both robots clear of the perimeter', met: clear, value: clear ? 'yes' : 'no' }
    ]
    awp[side] = {
      earned: requirements.every((r) => r.met),
      requirements,
      pins,
      goals: qualifyingGoals
    }
  }

  return {
    red: totals.red,
    blue: totals.blue,
    margin: totals.red - totals.blue,
    lines: lines.filter((l) => l.points),
    unowned: lines.filter((l) => l.source === 'yellow_unowned'),
    perGoal,
    awp,
    auto: { red: autoRed, blue: autoBlue }
  }
}

/** A short, plain description of a goal's owner, for the field tooltip. */
export function ownerLabel(scenario, goal) {
  if (goal.midfield) {
    const owner = midfieldOwner(scenario)
    return owner === 'none' ? 'midfield tied — no yellow owner' : `midfield ${owner} — yellow pays ${owner}`
  }
  const state = scenario.toggles?.[goal.quadrant] || 'yellow'
  return state === 'yellow' || state === 'none' ? 'yellow toggle — yellow pays nobody' : `toggle ${state} — yellow pays ${state}`
}

export const goalById = (id) => GOAL_BY_ID.get(Number(id))
