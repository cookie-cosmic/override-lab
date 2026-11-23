import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { peekTeam, writeTeamData } from '../team/store.js'
import { useTeamStore } from '../team/TeamContext.jsx'
import {
  AWP_RULES,
  GOALS,
  PIN_PRESETS,
  POINTS,
  QUADRANT_NAMES,
  TOGGLES,
  emptyScenario,
  goalById,
  makeCup,
  makePin,
  midfieldOwner,
  normalizeScenario,
  ownerLabel,
  scoreScenario,
  stackOf,
  toSvg,
  toggleOwner,
  visibleHalves
} from '../field/scoring.js'
import { Badge, Btn, Card, Empty, Note, Table } from '../components/ui.jsx'
import { navigate } from '../router.js'

const clone = (v) => JSON.parse(JSON.stringify(v))
const COLOR_HEX = { red: '#e5484d', blue: '#2f6fed', yellow: '#f2b705' }

function GoalShape({ goal, selected, count, onSelect, owner }) {
  const p = toSvg(goal.x, goal.y)
  const r = goal.kind === 'tall' ? 20 : goal.kind === 'alliance' ? 16 : 13
  const fill = goal.kind === 'alliance' ? (goal.alliance === 'red' ? 'rgba(229,72,77,.22)' : 'rgba(47,111,237,.2)') : 'var(--panel-2)'
  return (
    <g
      className={`fgoal ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(goal.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(goal.id)
        }
      }}
      aria-label={`${goal.label}${count ? `, ${count} items` : ', empty'}. ${owner}`}
    >
      <circle cx={p.x} cy={p.y} r={r + 7} fill="transparent" />
      <circle
        cx={p.x}
        cy={p.y}
        r={r}
        fill={fill}
        stroke={selected ? 'var(--text)' : goal.kind === 'alliance' ? COLOR_HEX[goal.alliance] : 'var(--line-2)'}
        strokeWidth={selected ? 2.4 : 1.6}
      />
      {goal.kind === 'tall' ? (
        <circle cx={p.x} cy={p.y} r={r * 0.45} fill="none" stroke="var(--muted)" strokeWidth="1.2" />
      ) : null}
      {count ? (
        <text x={p.x} y={p.y + 4} textAnchor="middle" className="fgoal-count">
          {count}
        </text>
      ) : null}
      <text x={p.x} y={p.y - r - 6} textAnchor="middle" className="fgoal-label">
        {goal.kind === 'alliance' ? goal.alliance.toUpperCase() : goal.kind === 'tall' ? 'TALL' : 'N'}
      </text>
    </g>
  )
}

function StackView({ stack, goal, onChange }) {
  if (!stack.length) {
    return <p className="dim small">Empty goal. Add a pin to start a stack; cups go between pins and control which halves are visible.</p>
  }
  return (
    <div className="stack-view">
      <div className="tiny dim" style={{ marginBottom: 4 }}>
        Bottom → top
      </div>
      {stack.map((node, i) => {
        if (node.type === 'cup') {
          return (
            <button
              key={node.id}
              type="button"
              className="stack-node cup"
              onClick={() =>
                onChange((s) => {
                  const arr = [...stackOf(s, goal.id)]
                  arr[i] = { ...arr[i], clearUp: !arr[i].clearUp }
                  s.goals[goal.id] = arr
                })
              }
              title="Click to flip the cup's clear face"
            >
              <span className="cup-glyph" aria-hidden="true">{node.clearUp ? '⌣' : '⌢'}</span>
              cup · clear face {node.clearUp ? 'up (clear on top)' : 'down (clear on bottom)'}
            </button>
          )
        }
        const visible = visibleHalves(stack).find((r) => r.index === i)?.halves || []
        return (
          <div key={node.id} className="stack-node pin">
            <span className="pin-glyph" aria-hidden="true">
              <span style={{ background: COLOR_HEX[node.top] }} />
              <span style={{ background: COLOR_HEX[node.bottom] }} />
            </span>
            <span>
              pin {i + 1} · {node.top}/{node.bottom}
              <span className="tiny dim">
                {' '}
                visible: {visible.length ? visible.map((h) => (h === 0 ? 'top' : 'bottom')).join(' + ') : 'none'}
              </span>
            </span>
            <button
              type="button"
              className="link tiny"
              onClick={() =>
                onChange((s) => {
                  const arr = [...stackOf(s, goal.id)]
                  arr[i] = { ...arr[i], top: arr[i].bottom, bottom: arr[i].top }
                  s.goals[goal.id] = arr
                })
              }
            >
              flip
            </button>
            <button
              type="button"
              className="link tiny"
              onClick={() =>
                onChange((s) => {
                  s.goals[goal.id] = stackOf(s, goal.id).filter((n) => n.id !== node.id)
                })
              }
            >
              remove
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function Field({ query }) {
  const { active, prefs, setPref } = useTeam()
  const team = active?.number || null
  const [scenario, setScenario] = useState(() => normalizeScenario(peekTeam(team, 'field-draft', emptyScenario())))
  const [goalId, setGoalId] = useState(8)
  const [pinPreset, setPinPreset] = useState('red')
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const { value: saved, save: saveSaved } = useTeamStore('field-scenarios', { items: [] })
  const loadedTeam = useRef(team)

  useEffect(() => {
    if (loadedTeam.current === team) return
    loadedTeam.current = team
    setScenario(normalizeScenario(peekTeam(team, 'field-draft', emptyScenario())))
    setPast([])
    setFuture([])
  }, [team])

  useEffect(() => {
    if (team) writeTeamData(team, 'field-draft', scenario)
  }, [scenario, team])

  // A shared read-only link carries the scenario in the URL; it is not saved until the user
  // chooses to keep it.
  useEffect(() => {
    const payload = query?.get('scenario')
    if (!payload) return
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(payload))))
      setScenario(normalizeScenario(parsed))
      setName(query.get('name') || '')
    } catch {
      /* a broken link leaves the current draft alone */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (fn) => {
    setPast((p) => [...p.slice(-40), clone(scenario)])
    setFuture([])
    setScenario((prev) => {
      const next = clone(prev)
      fn(next)
      return normalizeScenario(next)
    })
  }

  const undo = () => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [clone(scenario), ...f])
    setScenario(prev)
  }
  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setFuture((f) => f.slice(1))
    setPast((p) => [...p, clone(scenario)])
    setScenario(next)
  }

  const result = useMemo(() => scoreScenario(scenario), [scenario])
  const goal = goalById(goalId) || GOALS[8]
  const stack = stackOf(scenario, goal.id)
  const flip = prefs.fieldOrientation === 'red-top'

  // Pins never sit directly on pins: a pin placed above another needs the cup that the real
  // stack has. Without it the halves between them are physically hidden and nothing scores.
  const addPin = () => change((s) => {
    const current = stackOf(s, goal.id)
    const needsCup = current.length > 0 && current[current.length - 1].type === 'pin'
    s.goals[goal.id] = [...current, ...(needsCup ? [makeCup(false)] : []), makePin(pinPreset)]
  })
  const addCup = (clearUp) => change((s) => { s.goals[goal.id] = [...stackOf(s, goal.id), makeCup(clearUp)] })
  const removeTop = () => change((s) => { s.goals[goal.id] = stackOf(s, goal.id).slice(0, -1) })
  const clearGoal = () => change((s) => { delete s.goals[goal.id] })
  const cycleToggle = (q) => change((s) => {
    const order = ['yellow', 'red', 'blue']
    const cur = s.toggles[q] || 'yellow'
    s.toggles[q] = order[(order.indexOf(cur) + 1) % order.length]
  })

  const saveScenario = () => {
    const entry = {
      id: `${Date.now()}`,
      name: name.trim() || `Scenario ${saved.items.length + 1}`,
      note: note.trim() || null,
      savedAt: new Date().toISOString(),
      scenario
    }
    saveSaved((prev) => ({ items: [entry, ...(prev.items || [])].slice(0, 25) }))
    setName('')
    setNote('')
  }

  const copyLink = async () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(scenario))))
    const url = `${window.location.origin}${window.location.pathname}#/field?scenario=${encodeURIComponent(payload)}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      window.prompt('Copy this read-only scenario link', url)
    }
  }

  if (!active) {
    return (
      <Empty>
        Choose a team first — field scenarios are saved per team.{' '}
        <button className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.
      </Empty>
    )
  }

  return (
    <div className="field-layout">
      <Card
        title="Override field"
        subtitle={`${active.number} · click a goal to edit it, a toggle to change its state`}
        right={
          <div className="row" style={{ gap: 6 }}>
            <Btn size="sm" onClick={undo} disabled={!past.length}>Undo</Btn>
            <Btn size="sm" onClick={redo} disabled={!future.length}>Redo</Btn>
            <Btn size="sm" variant="ghost" onClick={() => change((s) => Object.assign(s, emptyScenario()))}>Reset</Btn>
          </div>
        }
      >
        <div className={`field-svg-wrap ${flip ? 'flip' : ''}`}>
          <svg viewBox="0 0 600 600" className="field-svg" role="group" aria-label="Override field">
            <rect x="24" y="24" width="552" height="552" rx="14" className="field-surface" />
            <polygon points="24,24 576,24 300,300" className="quad blue" />
            <polygon points="576,24 576,576 300,300" className="quad blue" />
            <polygon points="24,576 576,576 300,300" className="quad red" />
            <polygon points="24,24 24,576 300,300" className="quad red" />
            <line x1="24" y1="24" x2="576" y2="576" className="autoline" />
            <line x1="576" y1="24" x2="24" y2="576" className="autoline dashed" />
            <rect x="252" y="252" width="96" height="96" className="midfield-box" />
            <text x="300" y="245" textAnchor="middle" className="midfield-label">MIDFIELD</text>

            {TOGGLES.map((t) => {
              const p = toSvg(t.x, t.y)
              const state = scenario.toggles[t.q] || 'yellow'
              return (
                <g
                  key={t.q}
                  className="toggle"
                  onClick={() => cycleToggle(t.q)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      cycleToggle(t.q)
                    }
                  }}
                  aria-label={`Quadrant ${t.side} toggle, ${state}. Activate to change.`}
                >
                  <rect
                    x={p.x - 11}
                    y={p.y - 11}
                    width="22"
                    height="22"
                    transform={`rotate(45 ${p.x} ${p.y})`}
                    fill={state === 'yellow' ? COLOR_HEX.yellow : COLOR_HEX[state]}
                    stroke="var(--text)"
                    strokeWidth="1.4"
                  />
                  <text x={p.x} y={p.y + 26} textAnchor="middle" className="toggle-label">
                    {state === 'yellow' ? 'Y' : state === 'red' ? 'R' : 'B'}
                  </text>
                </g>
              )
            })}

            {GOALS.map((g) => (
              <GoalShape
                key={g.id}
                goal={g}
                selected={g.id === goal.id}
                count={stackOf(scenario, g.id).filter((n) => n.type === 'pin').length}
                onSelect={setGoalId}
                owner={ownerLabel(scenario, g)}
              />
            ))}

            {/* Robots in the midfield: one square per parked robot, red left, blue right. */}
            {Array.from({ length: Math.min(2, Number(scenario.robots.red) || 0) }).map((_, i) => (
              <rect key={`r${i}`} x={262 + i * 14} y={310} width="11" height="11" rx="2" fill={COLOR_HEX.red} aria-hidden="true" />
            ))}
            {Array.from({ length: Math.min(2, Number(scenario.robots.blue) || 0) }).map((_, i) => (
              <rect key={`b${i}`} x={314 + i * 14} y={310} width="11" height="11" rx="2" fill={COLOR_HEX.blue} aria-hidden="true" />
            ))}
          </svg>
        </div>

        <div className="field-legend tiny dim">
          <span><i className="dot red" /> red side (y + x &lt; 0)</span>
          <span><i className="dot blue" /> blue side</span>
          <span>yellow diamond = quadrant toggle (cycle yellow → red → blue)</span>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={flip}
              onChange={(e) => setPref({ fieldOrientation: e.target.checked ? 'red-top' : 'blue-bottom' })}
            />
            view from red side
          </label>
        </div>
      </Card>

      <Card
        title={`${goal.label} · quadrant ${QUADRANT_NAMES[goal.quadrant]}`}
        subtitle={ownerLabel(scenario, goal)}
        right={<Btn size="sm" variant="ghost" onClick={clearGoal} disabled={!stack.length}>Clear goal</Btn>}
      >
        <StackView stack={stack} goal={goal} onChange={change} />

        <div className="field-controls">
          <label className="field-control">
            <span className="tiny dim">Pin type</span>
            <select value={pinPreset} onChange={(e) => setPinPreset(e.target.value)}>
              {PIN_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <Btn size="sm" variant="primary" onClick={addPin}>+ Pin</Btn>
          <Btn size="sm" onClick={() => addCup(true)}>+ Cup (clear up)</Btn>
          <Btn size="sm" onClick={() => addCup(false)}>+ Cup (clear down)</Btn>
          <Btn size="sm" variant="ghost" onClick={removeTop} disabled={!stack.length}>Remove top</Btn>
        </div>
        <p className="tiny dim">
          A pin scores each visible half: {POINTS.alliancePin} for an alliance colour, {POINTS.yellowPin} for yellow to
          the owner. The bottom half of a pin sitting in the goal is always covered.
        </p>

        <div className="toggle-row">
          <span className="tiny dim">Toggles</span>
          {TOGGLES.map((t) => (
            <button
              key={t.q}
              type="button"
              className={`toggle-chip ${scenario.toggles[t.q] || 'yellow'}`}
              onClick={() => cycleToggle(t.q)}
              title="Change this quadrant's toggle"
            >
              {QUADRANT_NAMES[t.q]}: {scenario.toggles[t.q] || 'yellow'}
            </button>
          ))}
        </div>

        <div className="field-controls">
          <label className="field-control">
            <span className="tiny dim">Red robots in midfield</span>
            <input
              type="number"
              min="0"
              max="2"
              value={scenario.robots.red}
              onChange={(e) => change((s) => { s.robots.red = Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
            />
          </label>
          <label className="field-control">
            <span className="tiny dim">Blue robots in midfield</span>
            <input
              type="number"
              min="0"
              max="2"
              value={scenario.robots.blue}
              onChange={(e) => change((s) => { s.robots.blue = Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
            />
          </label>
          <span className="tiny dim">
            {midfieldOwner(scenario) === 'none' ? 'tied — tall goal yellow pays nobody' : `yellow in tall goal pays ${midfieldOwner(scenario)}`}
          </span>
        </div>

        <div className="field-controls">
          <label className="field-control">
            <span className="tiny dim">Auto score · red</span>
            <input
              type="number"
              min="0"
              value={scenario.auto.red}
              placeholder="—"
              onChange={(e) => change((s) => { s.auto.red = e.target.value })}
            />
          </label>
          <label className="field-control">
            <span className="tiny dim">Auto score · blue</span>
            <input
              type="number"
              min="0"
              value={scenario.auto.blue}
              placeholder="—"
              onChange={(e) => change((s) => { s.auto.blue = e.target.value })}
            />
          </label>
        </div>

        <div className="perimeter-row tiny">
          <span className="dim">Robots clear of the perimeter (AWP):</span>
          {['red', 'blue'].map((side) => (
            <label key={side} className="inline-check">
              <input
                type="checkbox"
                checked={Boolean(scenario.perimeterClear[side])}
                onChange={(e) => change((s) => { s.perimeterClear[side] = e.target.checked })}
              />
              {side}
            </label>
          ))}
        </div>
      </Card>

      <Card title="Live score" subtitle="updates with every placement">
        <div className="big-score">
          <span className="red">{result.red}</span>
          <span className="dim">–</span>
          <span className="blue">{result.blue}</span>
        </div>
        <div className="tiny dim" style={{ textAlign: 'center', marginBottom: 10 }}>
          red {result.margin === 0 ? 'level' : result.margin > 0 ? `+${result.margin}` : result.margin}
        </div>

        <Table head={['Source', 'Side', 'Pts']}>
          {['alliance_pin', 'yellow_pin', 'midfield', 'auto_bonus'].map((src) => {
            const rows = result.lines.filter((l) => l.source === src)
            const red = rows.filter((r) => r.alliance === 'red').reduce((s, r) => s + r.points, 0)
            const blue = rows.filter((r) => r.alliance === 'blue').reduce((s, r) => s + r.points, 0)
            if (!red && !blue) return null
            return (
              <tr key={src}>
                <td>{src.replace('_', ' ')}</td>
                <td className="mono">{red} / {blue}</td>
                <td className="mono">{red + blue}</td>
              </tr>
            )
          })}
        </Table>
        {result.unowned.length > 0 && (
          <p className="tiny dim">{result.unowned.length} visible yellow half{result.unowned.length === 1 ? '' : 's'} score nothing — the toggle that applies belongs to nobody.</p>
        )}

        <div className="awp-grid">
          {['red', 'blue'].map((side) => (
            <div key={side} className={`awp-card ${side}`}>
              <div className="row">
                <strong>{side} AWP</strong>
                <span className="spacer" />
                <Badge tone={result.awp[side].earned ? 'good' : 'warn'}>{result.awp[side].earned ? 'requirements met' : 'not met'}</Badge>
              </div>
              <ul className="tiny">
                {result.awp[side].requirements.map((r) => (
                  <li key={r.id} className={r.met ? 'met' : 'dim'}>
                    {r.met ? '✓' : '○'} {r.label} <span className="mono">({r.value})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="tiny dim">
          AWP here is a checklist on a planned end state, not a guarantee of an official Autonomous Win Point.
        </p>
      </Card>

      <Card title="Saved scenarios" subtitle={`${active.number} only`}>
        <div className="save-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scenario name" maxLength={40} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={80} />
          <Btn size="sm" variant="primary" onClick={saveScenario}>Save</Btn>
          <Btn size="sm" variant="ghost" onClick={copyLink}>{linkCopied ? 'Link copied' : 'Read-only link'}</Btn>
        </div>
        {!saved.items.length && <p className="dim small">Nothing saved for this team yet.</p>}
        {saved.items.length > 0 && (
          <Table head={['Scenario', 'Score', 'Saved', '']}>
            {saved.items.map((s) => {
              const score = scoreScenario(s.scenario)
              return (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.note ? <span className="tiny dim"> · {s.note}</span> : null}
                  </td>
                  <td className="mono">{score.red}–{score.blue}</td>
                  <td className="mono tiny">{new Date(s.savedAt).toLocaleDateString()}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Btn size="sm" variant="ghost" onClick={() => setScenario(normalizeScenario(s.scenario))}>Load</Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => saveSaved((prev) => ({ items: prev.items.filter((x) => x.id !== s.id) }))}
                      >
                        Delete
                      </Btn>
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
        <Note>
          Scenarios are stored in this browser under {active.number}. Switching teams never overwrites another team&apos;s
          saved field work.
        </Note>
      </Card>
    </div>
  )
}
