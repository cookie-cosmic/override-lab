import React, { useMemo, useState } from 'react'
import { Card, Stat, Table, Note, Btn, Field, Badge, Prose, KV } from '../components/ui.jsx'
import { DEFAULT_SCENARIO, POINTS, RULES, SCENARIO_FIELDS, STRATEGIES, makeSpec, runMatchup } from '../sim/override.js'

const REPO = 'https://github.com/Joboyoyo/vex-override-sim'

const SETUP = `git clone https://github.com/Joboyoyo/vex-override-sim.git
cd vex-override-sim

# (optional but recommended) make a virtual environment so deps don't
# clash with your system Python:
python -m venv .venv
# Windows:
.venv\\Scripts\\activate
# macOS / Linux:
source .venv/bin/activate

# install everything we need
pip install -r requirements.txt

# verify the install, then run the windowed simulator or a Monte Carlo
pytest tests/
python -m render.pygame_view
python -m strategy.analyze --trials 5000`

const pctFmt = (x) => `${(x * 100).toFixed(1)}%`

function Slider({ label, hint, value, onChange }) {
  return (
    <Field label={`${label} · ${Math.round(value * 100)}%`} hint={hint}>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ width: '100%' }}
      />
    </Field>
  )
}

function Distribution({ result }) {
  const rows = result.bins.filter((b) => b.red || b.blue)
  const max = Math.max(1, ...rows.map((b) => Math.max(b.red, b.blue)))
  if (!rows.length) return <Note>No matches landed in any bin — check the scenario.</Note>
  return (
    <div>
      <div className="row tiny muted" style={{ gap: 12, marginBottom: 6 }}>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--red)', marginRight: 5 }} />
          red score
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--blue)', marginRight: 5 }} />
          blue score
        </span>
        <span className="spacer" />
        <span className="mono">{result.trials.toLocaleString()} matches</span>
      </div>
      {rows.map((b) => (
        <div key={b.from} className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span className="mono tiny dim" style={{ width: 52, textAlign: 'right' }}>
            {b.from}–{b.from + 9}
          </span>
          <div style={{ flex: 1, display: 'grid', gap: 2 }}>
            <div style={{ height: 5, background: 'var(--red)', opacity: 0.75, width: `${(b.red / max) * 100}%`, minWidth: b.red ? 2 : 0 }} title={`red ${b.red}`} />
            <div style={{ height: 5, background: 'var(--blue)', opacity: 0.75, width: `${(b.blue / max) * 100}%`, minWidth: b.blue ? 2 : 0 }} title={`blue ${b.blue}`} />
          </div>
          <span className="mono tiny dim" style={{ width: 86 }}>
            {b.red}/{b.blue}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Override Sim tab.
 *
 * The reference Override simulator is Python + pygame, so it cannot be run by a browser tab or
 * by the Node API. This page runs a line-for-line port of its Monte Carlo (src/sim/override.js)
 * with the manual's point values, and documents how to run the original locally.
 */
export default function Simulator() {
  const [red, setRed] = useState('safe')
  const [blue, setBlue] = useState('yellow_gamble')
  const [trials, setTrials] = useState(2000)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6))
  const [scenario, setScenario] = useState(DEFAULT_SCENARIO)

  const result = useMemo(() => runMatchup(red, blue, scenario, trials, seed), [red, blue, scenario, trials, seed])

  const redSpec = makeSpec(red, 'red')
  const blueSpec = makeSpec(blue, 'blue')
  const favourite = result.red.winRate >= result.blue.winRate ? 'red' : 'blue'

  const set = (key) => (value) => setScenario((s) => ({ ...s, [key]: value }))

  return (
    <div className="stack" style={{ display: 'grid', gap: 16 }}>
      <Card
        title="Override sim"
        subtitle="the reference Python simulator's match model, running in this tab"
        right={<Badge tone="">rule-level Monte Carlo</Badge>}
      >
        <Prose
          paragraphs={[
            'This is the scoring model from vex-override-sim, the 2026-27 Override simulator: nine goals, sixty-three pins with two coloured halves, four wall toggles, midfield parking and the autonomous bonus, scored with the manual v0.1 point values. It is not an estimate of what a team scores — it builds the field, places pins one at a time and adds the points up.',
            'Each pin can only show one half once it is stacked, which is what makes the game a gamble: a safe pin is 5 locked points, while a yellow half is 10 to whoever owns that quadrant at the buzzer — and 10 to the opponent when they own it. The two strategies below differ only in which half they commit.',
            'The Python original lives in the repository linked at the bottom; this tab runs an exact port of its Monte Carlo (same strategies, same scenario probabilities, same scoring) so it works with no install. Point totals match the reference: a safe alliance that places all seven auto pins and ten match loads lands around 100 before the auto bonus and park.'
          ]}
        />
      </Card>

      <Card title="Matchup" subtitle="pick a plan for each alliance, then move the scenario sliders">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <Field label="Red alliance" hint={STRATEGIES.find((s) => s.id === red)?.blurb}>
            <select value={red} onChange={(e) => setRed(e.target.value)}>
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Blue alliance" hint={STRATEGIES.find((s) => s.id === blue)?.blurb}>
            <select value={blue} onChange={(e) => setBlue(e.target.value)}>
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <Field label="Matches">
            <select value={trials} onChange={(e) => setTrials(Number(e.target.value))} style={{ width: 130 }}>
              {[1000, 2000, 5000, 10000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seed" hint="same seed, same matches">
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input mono"
                style={{ width: 110 }}
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
              />
              <Btn size="sm" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
                re-roll
              </Btn>
            </div>
          </Field>
          <Field label="Scenario">
            <Btn size="sm" variant="ghost" onClick={() => setScenario(DEFAULT_SCENARIO)}>
              reset defaults
            </Btn>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 18px', marginTop: 12 }}>
          {SCENARIO_FIELDS.map((f) => (
            <Slider key={f.key} label={f.label} hint={f.hint} value={scenario[f.key]} onChange={set(f.key)} />
          ))}
        </div>

        <div className="row tiny dim" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="mono">red: {redSpec.autoPins} auto pins · {redSpec.matchLoads} match loads · {redSpec.matchLoadOrient}</span>
          <span className="mono">blue: {blueSpec.autoPins} auto pins · {blueSpec.matchLoads} match loads · {blueSpec.matchLoadOrient}</span>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Stat label="Red win" value={pctFmt(result.red.winRate)} sub={`mean ${result.red.mean} ± ${result.red.sd}`} tone={favourite === 'red' ? 'var(--good, #46a758)' : undefined} />
        <Stat label="Blue win" value={pctFmt(result.blue.winRate)} sub={`mean ${result.blue.mean} ± ${result.blue.sd}`} tone={favourite === 'blue' ? 'var(--good, #46a758)' : undefined} />
        <Stat label="Ties" value={pctFmt(result.tieRate)} sub={`mean margin ${result.margin > 0 ? '+' : ''}${result.margin} to red`} />
      </div>

      <Card title="Score distribution" subtitle="how often each side lands in each ten-point band">
        <Distribution result={result} />
      </Card>

      <Card title="Where the points come from" subtitle="average per match, over the same runs">
        <Table head={['Source', { label: 'Red', cls: 'num' }, { label: 'Blue', cls: 'num' }, 'Rule']}>
          <tr>
            <td>Alliance half (5 each)</td>
            <td className="num mono">{result.red.breakdown.alliancePin}</td>
            <td className="num mono">{result.blue.breakdown.alliancePin}</td>
            <td className="dim">visible alliance-colour half, permanent once placed</td>
          </tr>
          <tr>
            <td>Yellow half (10 each)</td>
            <td className="num mono">{result.red.breakdown.yellowPin}</td>
            <td className="num mono">{result.blue.breakdown.yellowPin}</td>
            <td className="dim">paid to the quadrant/midfield owner at the buzzer</td>
          </tr>
          <tr>
            <td>Yellow conceded</td>
            <td className="num mono bad">{result.red.breakdown.yellowConceded}</td>
            <td className="num mono bad">{result.blue.breakdown.yellowConceded}</td>
            <td className="dim">yellow halves the opponent's toggle turned into their points</td>
          </tr>
          <tr>
            <td>Midfield park (8 per robot)</td>
            <td className="num mono">{result.red.breakdown.park}</td>
            <td className="num mono">{result.blue.breakdown.park}</td>
            <td className="dim">SC6 — in the midfield projection at 0:00</td>
          </tr>
          <tr>
            <td>Auto bonus (12 / 6 tie)</td>
            <td className="num mono">{result.red.breakdown.autoBonus}</td>
            <td className="num mono">{result.blue.breakdown.autoBonus}</td>
            <td className="dim">SC7 — higher auto score, or 6 each</td>
          </tr>
        </Table>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
          <KV
            items={[
              { k: 'Red range', v: `${result.red.p10} – ${result.red.p90} (10th–90th)` },
              { k: 'Red AWP', v: pctFmt(result.red.awpRate) },
              { k: 'Blue range', v: `${result.blue.p10} – ${result.blue.p90} (10th–90th)` },
              { k: 'Blue AWP', v: pctFmt(result.blue.awpRate) }
            ]}
          />
          <Note tone={result.red.breakdown.yellowConceded + result.blue.breakdown.yellowConceded > 0 ? 'warn' : ''}>
            Yellow conceded is the cost of the gamble: every average point above is a half the other alliance's toggle
            collected. Denial (hybrid) is what turns that number around — it clears the toggle at the buzzer instead of
            racing for the same pins.
          </Note>
        </div>
      </Card>

      <Card title="What the model scores" subtitle="core/rules.yaml, game manual v0.1">
        <Table head={['Rule', 'Value', 'Reference']}>
          <tr>
            <td>Alliance pin</td>
            <td className="mono">{POINTS.alliancePin} per visible alliance half</td>
            <td className="dim">SC3</td>
          </tr>
          <tr>
            <td>Yellow pin</td>
            <td className="mono">{POINTS.yellowPin} per visible yellow half, to the owner</td>
            <td className="dim">SC3, SC5</td>
          </tr>
          <tr>
            <td>Unset / yellow toggle</td>
            <td className="mono">0 to both alliances</td>
            <td className="dim">SC4</td>
          </tr>
          <tr>
            <td>Midfield park</td>
            <td className="mono">{POINTS.park} per robot in the midfield projection</td>
            <td className="dim">SC6</td>
          </tr>
          <tr>
            <td>Auto bonus</td>
            <td className="mono">{POINTS.autoBonus} to the leader, {POINTS.autoTie} each on a tie</td>
            <td className="dim">SC7</td>
          </tr>
          <tr>
            <td>Autonomous Win Point</td>
            <td className="mono">{RULES.awp.pins}+ pins over {RULES.awp.goals}+ goals, {RULES.awp.perGoal}+ per goal, bots clear of the wall</td>
            <td className="dim">SC8</td>
          </tr>
          <tr>
            <td>Field</td>
            <td className="mono">
              {RULES.field.goals} goals · {RULES.field.pins} pins · {RULES.field.cups} cups · {RULES.field.toggles} toggles
            </td>
            <td className="dim">v0.1 setup</td>
          </tr>
          <tr>
            <td>Match</td>
            <td className="mono">
              auto {RULES.match.autoSeconds}s · driver {RULES.match.driverSeconds}s · endgame {RULES.match.endgameSeconds}s
            </td>
            <td className="dim">match timing</td>
          </tr>
        </Table>
      </Card>

      <Card title="Run the original" subtitle="Python 3.11+, pygame window and the full strategy tournament">
        <pre
          className="mono"
          style={{
            background: 'var(--bg-2, rgba(127,127,127,0.08))',
            border: '1px solid var(--line, rgba(127,127,127,0.25))',
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            lineHeight: 1.55,
            overflowX: 'auto',
            margin: 0
          }}
        >
          {SETUP}
        </pre>
        <Prose
          paragraphs={[
            'The Python build adds what a browser cannot: a pygame top-down field with pymunk physics, driver mode with a gamepad, and the neural-network toggle-duel bot. The scoring engine (core/scoring.py) is the single source of truth there, and this tab mirrors it so the numbers stay comparable.',
            'Point values change when the manual revises. Edit core/rules.yaml in the original, and POINTS / RULES in src/sim/override.js here, never the scoring logic itself.'
          ]}
        />
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">
            Open the repository
          </a>
          <span className="tiny dim">
            Model estimates, not an official VEX product. Not affiliated with the REC Foundation.
          </span>
        </div>
      </Card>
    </div>
  )
}
