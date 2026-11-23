import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useTeamStore } from '../team/TeamContext.jsx'
import { GOALS, QUADRANT_NAMES, TOGGLES, toSvg } from '../field/scoring.js'
import { Badge, Btn, Card, Empty, Note, Stat, Table } from '../components/ui.jsx'
import { navigate } from '../router.js'
import { fmt } from '../api.js'

const AUTO_SECONDS = 15
const AWP = { pins: 7, goals: 3, perGoal: 2 }

const DEFAULT_CONFIG = {
  drivetrain: '6-motor tank',
  speed: 8,
  turnRate: 360,
  acceleration: 18,
  width: 18,
  depth: 18,
  intakeSeconds: 0.7,
  scoreSeconds: 1.1,
  margin: 0.2
}

const ACTION_TYPES = [
  { id: 'intake', label: 'Intake', seconds: 0.7 },
  { id: 'score', label: 'Score', seconds: 1.1 },
  { id: 'toggle', label: 'Toggle', seconds: 1.0 },
  { id: 'wait', label: 'Wait', seconds: 0.5 },
  { id: 'park', label: 'Park', seconds: 1.5 }
]

const angle = (a, b) => {
  let d = ((b - a + 540) % 360) - 180
  return Math.abs(d)
}

function duration(routine, config) {
  let drive = 0
  let turn = 0
  let prev = { x: routine.start.x, y: routine.start.y, heading: routine.start.heading }
  for (const w of routine.waypoints) {
    const dist = Math.hypot(w.x - prev.x, w.y - prev.y)
    drive += dist / Math.max(0.5, Number(config.speed) || 8)
    if (w.heading != null) turn += angle(prev.heading, w.heading) / Math.max(30, Number(config.turnRate) || 360)
    prev = { ...w }
  }
  const accelPenalty = routine.waypoints.length * (Number(config.acceleration) ? 0.15 : 0.2)
  const actionTime = routine.actions.reduce((s, a) => s + (Number(a.seconds) || 0), 0)
  const margin = routine.waypoints.length * (Number(config.margin) || 0)
  const total = drive + turn + accelPenalty + actionTime + margin
  return { drive, turn, accelPenalty, actionTime, margin, total, remaining: AUTO_SECONDS - total }
}

export default function Autonomous() {
  const { active } = useTeam()
  const { value: config, save: saveConfig, markDirty, clearDirty } = useTeamStore('robot-config', DEFAULT_CONFIG)
  const { value: store, save: saveStore } = useTeamStore('routines', { items: [] })
  const [routine, setRoutine] = useState({
    name: 'New routine',
    start: { x: -5.5, y: 2, heading: 0 },
    waypoints: [],
    actions: []
  })
  const [selected, setSelected] = useState(null)
  const [actionType, setActionType] = useState('score')
  const [error, setError] = useState(null)
  const [awp, setAwp] = useState({ pins: '', goals: '', clear: true })
  const svgRef = useRef(null)

  const timing = useMemo(() => duration(routine, config), [routine, config])

  // A path that is not in the saved list is unsaved work; switching team asks before losing it.
  const savedMatch = (store.items || []).some(
    (i) => i.name === routine.name && JSON.stringify(i.waypoints) === JSON.stringify(routine.waypoints)
  )
  useEffect(() => {
    if ((routine.waypoints.length || routine.actions.length) && !savedMatch) markDirty('an unsaved autonomous routine', active?.number)
    else clearDirty()
    return () => clearDirty()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine.waypoints.length, routine.actions.length, routine.name, savedMatch, active?.number])
  const awpMet = Number(awp.pins) >= AWP.pins && Number(awp.goals) >= AWP.goals && awp.clear
  const over = timing.total > AUTO_SECONDS

  const addPoint = (e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const sx = ((e.clientX - rect.left) / rect.width) * 600
    const sy = ((e.clientY - rect.top) / rect.height) * 600
    const x = Math.max(-5.7, Math.min(5.7, (sx - 300) / 46))
    const y = Math.max(-5.7, Math.min(5.7, (300 - sy) / 46))
    const last = routine.waypoints[routine.waypoints.length - 1] || routine.start
    const heading = (Math.atan2(y - last.y, x - last.x) * 180) / Math.PI
    setRoutine((r) => ({ ...r, waypoints: [...r.waypoints, { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), heading: Math.round(heading) }] }))
  }

  const addAction = () => {
    const preset = ACTION_TYPES.find((a) => a.id === actionType)
    setRoutine((r) => ({
      ...r,
      actions: [...r.actions, { id: `${Date.now()}`, type: actionType, label: preset.label, seconds: preset.seconds }]
    }))
  }

  const saveRoutine = () => {
    if (!routine.name.trim()) {
      setError('Give the routine a name before saving.')
      return
    }
    const entry = { ...routine, id: `${Date.now()}`, savedAt: new Date().toISOString(), timing }
    saveStore((prev) => ({ items: [entry, ...(prev.items || [])].slice(0, 20) }))
    setError(null)
  }

  const load = (item) => setRoutine({ name: item.name, start: item.start, waypoints: item.waypoints, actions: item.actions })

  if (!active) {
    return (
      <Empty>
        Choose a team first — robot configuration and routines are per team.{' '}
        <button className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.
      </Empty>
    )
  }

  return (
    <div className="auto-layout">
      <Card
        title="Autonomous planner"
        subtitle={`${active.number} · 0:00 → 0:${String(AUTO_SECONDS).padStart(2, '0')}`}
        right={<Badge tone={over ? 'warn' : 'good'}>{over ? `${fmt(timing.total - AUTO_SECONDS, 1)}s over` : `${fmt(timing.remaining, 1)}s spare`}</Badge>}
      >
        <div className="auto-field-wrap">
          <svg
            ref={svgRef}
            viewBox="0 0 600 600"
            className="field-svg auto-field"
            onClick={addPoint}
            role="img"
            aria-label="Click to add a waypoint to the routine"
          >
            <rect x="24" y="24" width="552" height="552" rx="14" className="field-surface" />
            <polygon points="24,24 576,24 300,300" className="quad blue" />
            <polygon points="576,24 576,576 300,300" className="quad blue" />
            <polygon points="24,576 576,576 300,300" className="quad red" />
            <polygon points="24,24 24,576 300,300" className="quad red" />
            <line x1="24" y1="24" x2="576" y2="576" className="autoline" />
            <rect x="252" y="252" width="96" height="96" className="midfield-box" />
            {TOGGLES.map((t) => {
              const p = toSvg(t.x, t.y)
              return <rect key={t.q} x={p.x - 6} y={p.y - 6} width="12" height="12" transform={`rotate(45 ${p.x} ${p.y})`} className="toggle-static" />
            })}
            {GOALS.map((g) => {
              const p = toSvg(g.x, g.y)
              return <circle key={g.id} cx={p.x} cy={p.y} r={g.kind === 'tall' ? 13 : 9} className={`goal-static ${g.alliance}`} />
            })}

            {(() => {
              const start = toSvg(routine.start.x, routine.start.y)
              const pts = [routine.start, ...routine.waypoints].map((w) => toSvg(w.x, w.y))
              return (
                <>
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="auto-path" />
                  <circle cx={start.x} cy={start.y} r="12" className="auto-start" />
                  <text x={start.x} y={start.y + 4} textAnchor="middle" className="auto-marker-text">S</text>
                  {routine.waypoints.map((w, i) => {
                    const p = toSvg(w.x, w.y)
                    return (
                      <g key={i} className="auto-point" onClick={(e) => { e.stopPropagation(); setSelected(i) }}>
                        <circle cx={p.x} cy={p.y} r="13" className={selected === i ? 'selected' : ''} />
                        <text x={p.x} y={p.y + 4} textAnchor="middle" className="auto-marker-text">{i + 1}</text>
                      </g>
                    )
                  })}
                </>
              )
            })()}
          </svg>
          <div className="tiny dim">Click the field to add a waypoint. Heading is set from the direction of travel; edit it in the list.</div>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Btn size="sm" onClick={() => setRoutine((r) => ({ ...r, waypoints: r.waypoints.slice(0, -1) }))} disabled={!routine.waypoints.length}>
            Remove last point
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setRoutine((r) => ({ ...r, waypoints: [], actions: [] }))}>
            Clear path
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setRoutine((r) => ({ ...r, waypoints: [], actions: [], start: { ...r.start, heading: 0 } }))}>
            Reset start
          </Btn>
        </div>

        <div className="timeline">
          <div className="timeline-bar">
            <span className="timeline-drive" style={{ width: `${Math.min(100, (timing.drive / AUTO_SECONDS) * 100)}%` }} />
            <span className="timeline-turn" style={{ width: `${Math.min(100, (timing.turn / AUTO_SECONDS) * 100)}%` }} />
            <span className="timeline-action" style={{ width: `${Math.min(100, (timing.actionTime / AUTO_SECONDS) * 100)}%` }} />
            <span className="timeline-margin" style={{ width: `${Math.min(100, ((timing.margin + timing.accelPenalty) / AUTO_SECONDS) * 100)}%` }} />
          </div>
          <div className="timeline-legend tiny dim">
            <span><i className="dot drive" /> drive {fmt(timing.drive, 2)}s</span>
            <span><i className="dot turn" /> turns {fmt(timing.turn, 2)}s</span>
            <span><i className="dot action" /> actions {fmt(timing.actionTime, 2)}s</span>
            <span><i className="dot margin" /> accel/margin {fmt(timing.margin + timing.accelPenalty, 2)}s</span>
            <span className="mono">{fmt(timing.total, 2)}s total</span>
          </div>
        </div>
        {over && <Note tone="warn">This plan runs {fmt(timing.total - AUTO_SECONDS, 1)}s past the 15-second window. Remove a waypoint, shorten a turn, or move an action earlier.</Note>}
      </Card>

      <Card title="Routine" subtitle="path, actions and AWP checklist">
        <div className="toolbar">
          <input value={routine.name} onChange={(e) => setRoutine((r) => ({ ...r, name: e.target.value }))} placeholder="Routine name" maxLength={40} />
          <Btn size="sm" variant="primary" onClick={saveRoutine}>Save routine</Btn>
        </div>
        {error && <Note tone="warn">{error}</Note>}

        <div className="form-grid">
          <label>
            <span>Start X (ft)</span>
            <input type="number" step="0.1" value={routine.start.x} onChange={(e) => setRoutine((r) => ({ ...r, start: { ...r.start, x: Number(e.target.value) } }))} />
          </label>
          <label>
            <span>Start Y (ft)</span>
            <input type="number" step="0.1" value={routine.start.y} onChange={(e) => setRoutine((r) => ({ ...r, start: { ...r.start, y: Number(e.target.value) } }))} />
          </label>
          <label>
            <span>Start heading (°)</span>
            <input type="number" value={routine.start.heading} onChange={(e) => setRoutine((r) => ({ ...r, start: { ...r.start, heading: Number(e.target.value) } }))} />
          </label>
          <label>
            <span>Alliance colour</span>
            <select
              value={routine.start.x < 0 ? 'red' : 'blue'}
              onChange={(e) => setRoutine((r) => ({ ...r, start: { ...r.start, x: e.target.value === 'red' ? -5.5 : 5.5 } }))}
            >
              <option value="red">red</option>
              <option value="blue">blue</option>
            </select>
          </label>
        </div>

        {selected != null && routine.waypoints[selected] && (
          <div className="waypoint-edit">
            <div className="row">
              <strong>Waypoint {selected + 1}</strong>
              <span className="spacer" />
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRoutine((r) => ({ ...r, waypoints: r.waypoints.filter((_, i) => i !== selected) }))
                  setSelected(null)
                }}
              >
                Remove
              </Btn>
            </div>
            <div className="form-grid">
              <label>
                <span>X</span>
                <input
                  type="number"
                  step="0.1"
                  value={routine.waypoints[selected].x}
                  onChange={(e) =>
                    setRoutine((r) => {
                      const w = [...r.waypoints]
                      w[selected] = { ...w[selected], x: Number(e.target.value) }
                      return { ...r, waypoints: w }
                    })
                  }
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  step="0.1"
                  value={routine.waypoints[selected].y}
                  onChange={(e) =>
                    setRoutine((r) => {
                      const w = [...r.waypoints]
                      w[selected] = { ...w[selected], y: Number(e.target.value) }
                      return { ...r, waypoints: w }
                    })
                  }
                />
              </label>
              <label>
                <span>Heading after (°)</span>
                <input
                  type="number"
                  value={routine.waypoints[selected].heading ?? 0}
                  onChange={(e) =>
                    setRoutine((r) => {
                      const w = [...r.waypoints]
                      w[selected] = { ...w[selected], heading: Number(e.target.value) }
                      return { ...r, waypoints: w }
                    })
                  }
                />
              </label>
            </div>
          </div>
        )}

        <div className="action-list">
          <div className="toolbar">
            <select value={actionType} onChange={(e) => setActionType(e.target.value)} aria-label="Action type">
              {ACTION_TYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <Btn size="sm" onClick={addAction}>+ Action</Btn>
          </div>
          {!routine.actions.length && <p className="tiny dim">No actions yet. Each action adds its own time to the plan.</p>}
          {routine.actions.map((a) => (
            <div className="action-row" key={a.id}>
              <span className="badge">{a.label}</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={a.seconds}
                aria-label={`${a.label} seconds`}
                onChange={(e) =>
                  setRoutine((r) => ({
                    ...r,
                    actions: r.actions.map((x) => (x.id === a.id ? { ...x, seconds: Number(e.target.value) } : x))
                  }))
                }
              />
              <span className="tiny dim">s</span>
              <span className="spacer" />
              <button className="link tiny" onClick={() => setRoutine((r) => ({ ...r, actions: r.actions.filter((x) => x.id !== a.id) }))}>
                remove
              </button>
            </div>
          ))}
        </div>

        <div className="awp-plan">
          <h3>AWP requirements</h3>
          <div className="form-grid">
            <label>
              <span>Pins scored for the alliance</span>
              <input type="number" min="0" value={awp.pins} onChange={(e) => setAwp({ ...awp, pins: e.target.value })} />
            </label>
            <label>
              <span>Goals with {AWP.perGoal}+ pins</span>
              <input type="number" min="0" value={awp.goals} onChange={(e) => setAwp({ ...awp, goals: e.target.value })} />
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={awp.clear} onChange={(e) => setAwp({ ...awp, clear: e.target.checked })} />
              <span>Both robots end clear of the perimeter</span>
            </label>
          </div>
          <ul className="awp-checks tiny">
            <li className={Number(awp.pins) >= AWP.pins ? 'met' : 'dim'}>{Number(awp.pins) >= AWP.pins ? '✓' : '○'} {AWP.pins} pins ({awp.pins || 0})</li>
            <li className={Number(awp.goals) >= AWP.goals ? 'met' : 'dim'}>{Number(awp.goals) >= AWP.goals ? '✓' : '○'} {AWP.goals} qualifying goals ({awp.goals || 0})</li>
            <li className={awp.clear ? 'met' : 'dim'}>{awp.clear ? '✓' : '○'} robots clear of the perimeter</li>
            <li className={over ? 'dim' : 'met'}>{over ? '○' : '✓'} plan fits the 15s window</li>
          </ul>
          <Badge tone={awpMet && !over ? 'good' : 'warn'}>{awpMet && !over ? 'planned checklist complete' : 'checklist incomplete'}</Badge>
          <p className="tiny dim">
            A completed checklist here means the plan targets every requirement. Whether the robot achieves it on the
            field is a question for recorded autonomous trials, not for this page.
          </p>
        </div>
      </Card>

      <Card title="Robot configuration" subtitle={`${active.number} · used for every timing estimate`}>
        <div className="form-grid">
          <label>
            <span>Drivetrain</span>
            <input value={config.drivetrain} onChange={(e) => saveConfig({ ...config, drivetrain: e.target.value })} maxLength={40} />
          </label>
          <label>
            <span>Drive speed (ft/s)</span>
            <input type="number" step="0.1" value={config.speed} onChange={(e) => saveConfig({ ...config, speed: Number(e.target.value) })} />
          </label>
          <label>
            <span>Turn rate (°/s)</span>
            <input type="number" value={config.turnRate} onChange={(e) => saveConfig({ ...config, turnRate: Number(e.target.value) })} />
          </label>
          <label>
            <span>Acceleration (ft/s²)</span>
            <input type="number" step="0.5" value={config.acceleration} onChange={(e) => saveConfig({ ...config, acceleration: Number(e.target.value) })} />
          </label>
          <label>
            <span>Width (in)</span>
            <input type="number" value={config.width} onChange={(e) => saveConfig({ ...config, width: Number(e.target.value) })} />
          </label>
          <label>
            <span>Depth (in)</span>
            <input type="number" value={config.depth} onChange={(e) => saveConfig({ ...config, depth: Number(e.target.value) })} />
          </label>
          <label>
            <span>Intake (s)</span>
            <input type="number" step="0.1" value={config.intakeSeconds} onChange={(e) => saveConfig({ ...config, intakeSeconds: Number(e.target.value) })} />
          </label>
          <label>
            <span>Scoring action (s)</span>
            <input type="number" step="0.1" value={config.scoreSeconds} onChange={(e) => saveConfig({ ...config, scoreSeconds: Number(e.target.value) })} />
          </label>
        </div>
        <p className="tiny dim">
          These are estimates from your own robot settings, not measured match data. Recorded autonomous runs belong in
          the robot testing log.
        </p>
      </Card>

      <Card title="Saved routines" subtitle={`${active.number} only`}>
        {!store.items.length ? (
          <p className="dim small">No routines saved yet. Build a path, name it and save.</p>
        ) : (
          <Table head={['Routine', 'Points', 'Actions', 'Est. time', 'Saved', '']}>
            {store.items.map((r) => {
              const t = r.timing || duration(r, config)
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="mono">{r.waypoints.length}</td>
                  <td className="mono">{r.actions.length}</td>
                  <td className="mono">{fmt(t.total, 2)}s</td>
                  <td className="mono tiny">{new Date(r.savedAt).toLocaleDateString()}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Btn size="sm" variant="ghost" onClick={() => load(r)}>Load</Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const copy = { ...r, id: `${Date.now()}`, name: `${r.name} copy`, savedAt: new Date().toISOString() }
                          saveStore((prev) => ({ items: [copy, ...prev.items].slice(0, 20) }))
                        }}
                      >
                        Clone
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => saveStore((prev) => ({ items: prev.items.filter((x) => x.id !== r.id) }))}>
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
          A path on this field is a plan, not an exported VEXcode or PROS program. Driving and turning are estimated from
          the configuration above; real runs vary with battery, traction and field conditions.
        </Note>
      </Card>
    </div>
  )
}
