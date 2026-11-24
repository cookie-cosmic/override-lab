import React, { useEffect, useMemo, useState } from 'react'
import { jpost, endpoints, useApi, fmt, pct, sign, dateTime } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, TeamTag, Note, Empty, Btn, Field, Prose, Claims, KV } from '../components/ui.jsx'
import { ProbMeter, WinGauge } from '../components/charts.jsx'

const SCOUT_FIELDS = [
  { key: 'archetype', label: 'Robot archetype', type: 'text', hint: 'fast cycler / hoarder / wall bot / support' },
  { key: 'autonRoutine', label: 'Autonomous routine', type: 'text', hint: 'start tile + first three actions' },
  { key: 'autonReliability', label: 'Auton reliability (0–1)', type: 'text', hint: 'fraction of matches it completes' },
  { key: 'startPosition', label: 'Start position', type: 'text', hint: 'red near / red far / …' },
  { key: 'targetPriority', label: 'Target priority', type: 'text', hint: 'what they score first, always' },
  { key: 'cycleStyle', label: 'Cycle style', type: 'text', hint: 'single object / stack / multi-dump' },
  { key: 'endgame', label: 'Endgame mechanism', type: 'text', hint: 'climb, park, elevate, none' },
  { key: 'endgameRate', label: 'Endgame success (0–1)', type: 'text' },
  { key: 'defense', label: 'Defensive willingness (0–1)', type: 'text' },
  { key: 'notes', label: 'Pit notes', type: 'text' }
]

const CONF_TONE = { high: 'green', medium: 'amber', low: '' }
const SEV_TONE = { high: 'red', medium: 'amber', low: '' }
const PCT_LABEL = {
  avgPoints: 'Average points',
  floor: 'Floor',
  ceiling: 'Ceiling',
  autonPerMatch: 'Autonomous',
  penaltyPerMatch: 'Penalty discipline',
  cv: 'Consistency',
  elo: 'Elo'
}
const COMPARE = [
  ['avgPoints', 'Average points'],
  ['floor', 'Floor'],
  ['ceiling', 'Ceiling'],
  ['autonPerMatch', 'Autonomous'],
  ['driverPerMatch', 'Driver phase'],
  ['penaltyPerMatch', 'Penalties'],
  ['cv', 'CV (lower is steadier)'],
  ['winRate', 'Adjusted win rate']
]

const formString = (form) =>
  (form || [])
    .filter((g) => g.won != null)
    .map((g) => (g.won ? 'W' : g.tied ? 'T' : 'L'))
    .join('') || '—'

export default function CounterPage({ sku, opp, own, navigate }) {
  const { data: summary } = useApi(sku ? endpoints.summary(sku) : null)
  const { data, loading, error, reload } = useApi(opp ? endpoints.opponent(sku, opp, own) : null)
  const [draft, setDraft] = useState({})
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data?.style?.scouting) setDraft(data.style.scouting)
    else setDraft({})
  }, [opp, data?.style])

  const teams = useMemo(
    () => (summary?.roster ? summary.roster.map((r) => r.team) : (summary?.archetypes?.teams || []).map((t) => t.team)).sort(),
    [summary]
  )

  if (!sku) return <Empty>No event selected.</Empty>

  const go = (nextOpp, nextOwn = own) =>
    navigate(`counter/${sku}${nextOpp ? `/${nextOpp}` : ''}${nextOwn ? `?own=${encodeURIComponent(nextOwn)}` : ''}`)

  const saveScout = async () => {
    setBusy(true)
    try {
      await jpost('/api/scouting', { sku, team: opp, data: draft })
      setSaved(new Date().toLocaleTimeString())
      reload()
    } catch (e) {
      setSaved(`error: ${e.message}`)
    }
    setBusy(false)
  }

  const picker = (
    <Card
      title="Opponent card"
      subtitle="deep sheet: what they do well, where they break, every counter that fires, and the plan"
      right={
        <div className="row no-print" style={{ gap: 6 }}>
          <select value={own || ''} onChange={(e) => go(opp, e.target.value)} style={{ width: 150 }}>
            <option value="">my team (optional)</option>
            {teams.filter((t) => t !== opp).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={opp || ''} onChange={(e) => go(e.target.value, own)} style={{ width: 150 }}>
            <option value="">select opponent</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Btn onClick={() => window.print()}>Print</Btn>
        </div>
      }
    >
      {!opp && <Note>Choose an opponent to build its sheet: strengths, weaknesses, the counters that fire and the plan that follows.</Note>}
      {opp && loading && !data && <Loading />}
      {opp && error && <ErrorBox error={error} onRetry={reload} />}
    </Card>
  )

  if (!opp) {
    return (
      <div>
        {picker}
        <Card title="Registered teams" subtitle={`${teams.length} teams at this event`}>
          {(summary?.roster || []).length ? (
            <Table head={['Team', 'Name', 'Location']} wrap={false} maxHeight={460}>
              {summary.roster.map((r) => (
                <tr key={r.team} className="clickable" onClick={() => go(r.team, own)} style={{ cursor: 'pointer' }}>
                  <td>
                    <TeamTag team={r.team} />
                  </td>
                  <td className="small">{r.name || '—'}</td>
                  <td className="small dim">{[r.city, r.region].filter(Boolean).join(', ') || '—'}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No roster loaded for this event.</Empty>
          )}
        </Card>
      </div>
    )
  }

  if (!data) return <div>{picker}</div>

  const t = data.team || {}
  const record = t.record || { wins: 0, losses: 0, ties: 0 }
  const strengths = data.strengths || []
  const weaknesses = data.weaknesses || []
  const vectors = data.attack?.vectors || []
  const plan = data.plan
  const sim = data.sim
  const conceptual = data.mode === 'conceptual'

  if (data.noHistory) {
    return (
      <div>
        {picker}
        <Card title={`${opp} — nothing to read yet`}>
          <Note tone="warn">{data.notes?.[0]}</Note>
          <div className="small dim" style={{ marginTop: 10 }}>
            Add a RobotEvents key from the sidebar (the ⌘ button at the bottom) and its previous tournaments become readable — the
            counter sheet then works without a single match at this event.
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      {picker}

      {conceptual && (
        <Note tone="warn">
          <strong>Season-based counter sheet.</strong> {data.notes?.[0]}
        </Note>
      )}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Opponent" value={t.team} sub={t.name || data.style?.archetype || (conceptual ? 'season basis' : 'unscouted')} />
        <Stat
          label="Record"
          value={`${record.wins}–${record.losses}${record.ties ? `–${record.ties}` : ''}`}
          sub={`${t.matches ?? 0} matches ${conceptual ? 'this season' : 'here'}`}
        />
        <Stat label="Average" value={fmt(t.avgPoints)} sub={`floor ${fmt(t.floor)} · ceiling ${fmt(t.ceiling)}`} />
        <Stat
          label="Win prob vs them"
          value={plan?.winProbWithPlan != null ? pct(plan.winProbWithPlan) : '—'}
          tone={plan?.winProbWithPlan != null && plan.winProbWithPlan > plan.winProb ? 'var(--green)' : undefined}
          sub={plan?.winProb != null ? `baseline ${pct(plan.winProb)} · ${sign(plan.deltaP * 100, 1)}pp with plan` : 'pick my team for a number'}
        />
      </div>

      <div className="split">
        <Card title="Attack vectors" subtitle={`${vectors.length} of ${data.attack?.coverage?.rulesEvaluated ?? 0} rules fired · rules v${data.attack?.rulesVersion ?? '—'}`}>
          {!vectors.length && <Empty>No rule fired on the metrics that exist for this team.</Empty>}
          {vectors.map((v, i) => (
            <div key={v.id} style={{ borderBottom: i === vectors.length - 1 ? 'none' : '1px solid var(--line)', padding: '10px 0' }}>
              <div className="row" style={{ marginBottom: 4 }}>
                <Badge tone={CONF_TONE[v.confidence] || ''}>{v.confidence}</Badge>
                <strong style={{ fontSize: 13 }}>{v.title}</strong>
                <span className="spacer" />
                <span className="mono tiny">+{v.expectedPoints} pts</span>
                <span className="tiny dim">cap {Math.round(v.capability * 100)}%</span>
              </div>
              <div className="small" style={{ color: 'var(--muted)' }}>
                {v.action}
              </div>
              <div className="tiny dim" style={{ marginTop: 4 }}>
                fires because {v.metric} = {v.observed} (threshold {v.threshold}) · trigger: {v.trigger}
              </div>
            </div>
          ))}
        </Card>

        <div>
          <Card title="Match card" subtitle="printable one-pager">
            <KV
              items={[
                { k: 'Opponent', v: t.team },
                { k: 'Record', v: `${record.wins}–${record.losses}${record.ties ? `–${record.ties}` : ''}` },
                { k: 'Archetype', v: data.style?.archetype || '—' },
                { k: 'Average', v: fmt(t.avgPoints) },
                { k: 'Floor / ceiling', v: `${fmt(t.floor)} / ${fmt(t.ceiling)}` },
                { k: 'Auton / match', v: fmt(data.metrics?.autonPerMatch) },
                { k: 'Driver / match', v: fmt(data.metrics?.driverPerMatch) },
                { k: 'Penalties / match', v: fmt(data.metrics?.penaltyPerMatch, 2) },
                { k: 'CV (instability)', v: fmt(t.cv, 3) },
                { k: 'Clutch', v: sign(t.clutch) }
              ]}
            />
            <div style={{ marginTop: 10 }}>
              <div className="tiny dim" style={{ marginBottom: 4 }}>
                TRIGGER SHEET
              </div>
              {(plan?.triggers || []).map((tr, i) => (
                <div key={i} className="small" style={{ borderLeft: '2px solid var(--amber)', paddingLeft: 8, marginBottom: 6 }}>
                  {tr.trigger}
                  <div className="tiny dim">{tr.from}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="tiny dim" style={{ marginBottom: 4 }}>
                ROLES
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {(plan?.roles || []).map((r) => (
                  <Badge key={r} tone="blue">
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Win probability">
            {plan?.winProb != null ? (
              <>
                <WinGauge
                  value={plan.winProb}
                  label="Baseline"
                  note={`${pct(plan.winProb)} baseline · ${pct(plan.winProbWithPlan)} with the plan (${sign(plan.deltaP * 100, 1)}pp)`}
                />
                <div style={{ height: 12 }} />
                <ProbMeter value={plan.winProb} label="Baseline" width="100%" />
                <div style={{ height: 8 }} />
                <ProbMeter value={plan.winProbWithPlan} label="With the plan executed" width="100%" />
                <div className="tiny dim" style={{ marginTop: 8 }}>
                  The plan is worth {plan.swingPoints} expected points; estimates assume about half of the counters convert.
                </div>
              </>
            ) : (
              <Note>Pick your team above and this becomes a win probability, with and without the plan.</Note>
            )}
          </Card>
        </div>
      </div>

      {plan?.steps?.length > 0 && (
        <Card title="The plan" subtitle={`worth ${plan.swingPoints ?? 0} expected points — in the order you play it`}>
          {plan.steps.map((s, i) => (
            <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
              <Badge tone="blue">{s.phase}</Badge>
              <span className="small" style={{ flex: 1 }}>
                {s.text}
              </span>
              {s.points != null && <span className="mono tiny dim">+{s.points}</span>}
            </div>
          ))}
        </Card>
      )}

      <div className="split">
        <Card title="What they do well" subtitle="do not try to win the match here">
          {!strengths.length && <Empty>Not enough evidence for strengths yet.</Empty>}
          {strengths.map((s) => (
            <div key={s.id} style={{ marginBottom: 8 }}>
              <strong className="small">{s.label}</strong>
              <div className="tiny dim">{s.detail}</div>
            </div>
          ))}
        </Card>

        <Card title="Where they break" subtitle="ranked by how much it is worth">
          {!weaknesses.length && <Empty>Nothing crosses a weakness threshold.</Empty>}
          {weaknesses.map((w) => (
            <div key={w.id} style={{ marginBottom: 8 }}>
              <div className="row" style={{ gap: 6 }}>
                <Badge tone={SEV_TONE[w.severity] || ''}>{w.severity}</Badge>
                <strong className="small">{w.label}</strong>
              </div>
              <div className="tiny dim">{w.detail}</div>
            </div>
          ))}
        </Card>
      </div>

      <Card
        title="Matchup simulation"
        subtitle={sim ? `${sim.samples.toLocaleString()} runs · two median allies on each side · ${sim.basis} basis` : 'pick my team above to simulate this matchup'}
      >
        {sim ? (
          <div className="split">
            <div>
              <ProbMeter value={sim.ownWinProb} label="You win" width="100%" />
              <div style={{ height: 8 }} />
              <ProbMeter value={sim.oppWinProb} label="They win" width="100%" />
              <div className="tiny dim" style={{ marginTop: 8 }}>
                Ties are half-credited; the bands are the 10th–90th percentile of simulated scores.
              </div>
            </div>
            <KV
              items={[
                { k: 'Most likely score', v: `${sim.mostLikely.own}–${sim.mostLikely.opp}` },
                { k: 'Your range', v: `${sim.bands.own.p10}–${sim.bands.own.p90}` },
                { k: 'Their range', v: `${sim.bands.opp.p10}–${sim.bands.opp.p90}` },
                { k: 'Median margin', v: `${sim.margin.p50 > 0 ? '+' : ''}${sim.margin.p50} for you` },
                { k: 'Basis', v: sim.basis === 'event' ? 'this event' : 'season results' }
              ]}
            />
          </div>
        ) : (
          <Note>No simulation without your side: choose your team in the picker and the model runs your alliance against theirs.</Note>
        )}
      </Card>

      {data.ownMetrics && (
        <Card title="You vs them" subtitle="the same metric, both sides — the gaps are the plan">
          <Table head={['Metric', { label: 'You', cls: 'num' }, { label: 'Them', cls: 'num' }, { label: 'Gap', cls: 'num' }]} wrap={false}>
            {COMPARE.filter(([k]) => data.ownMetrics[k] != null || data.metrics?.[k] != null).map(([k, label]) => {
              const mine = data.ownMetrics[k]
              const theirs = data.metrics?.[k]
              const gap = mine != null && theirs != null ? mine - theirs : null
              return (
                <tr key={k}>
                  <td className="small">{label}</td>
                  <td className="num">{fmt(mine, 2)}</td>
                  <td className="num">{fmt(theirs, 2)}</td>
                  <td className="num" style={{ color: gap == null ? undefined : gap > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {gap == null ? '—' : `${gap > 0 ? '+' : ''}${fmt(gap, 2)}`}
                  </td>
                </tr>
              )
            })}
          </Table>
        </Card>
      )}

      {data.percentiles && (
        <Card title="Where they rank" subtitle="percentile inside this event's field, higher is better">
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            {Object.entries(data.percentiles)
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <span key={k} className="small">
                  {PCT_LABEL[k] || k} <span className="mono">{Math.round(v * 100)}th</span>
                </span>
              ))}
          </div>
        </Card>
      )}

      {data.h2h?.played > 0 && (
        <Card title="Head to head" subtitle={`${data.h2h.wins}–${data.h2h.losses} against them at this event`}>
          <Table head={['Round', { label: '#', cls: 'num' }, { label: 'You', cls: 'num' }, { label: 'Them', cls: 'num' }, 'Result']} wrap={false}>
            {data.h2h.matches.map((m) => (
              <tr key={m.key}>
                <td className="tiny dim">{m.roundLabel}</td>
                <td className="num">{m.matchnum}</td>
                <td className="num">{m.teamScore ?? '—'}</td>
                <td className="num">{m.otherScore ?? '—'}</td>
                <td>{m.won == null ? '—' : <Badge tone={m.won ? 'green' : 'red'}>{m.won ? 'W' : 'L'}</Badge>}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {data.results?.length > 0 && (
        <Card
          title={conceptual ? 'Recent season results' : 'Matches here'}
          subtitle={conceptual ? `last ${data.results.length} games before this event · form ${formString(data.season?.form)}` : 'most recent first'}
        >
          <Table head={['When', 'Round', { label: 'Score', cls: 'num' }, 'Result', conceptual ? 'Tournament' : 'Opponents']} wrap={false} maxHeight={340}>
            {data.results.map((r) => (
              <tr key={r.key}>
                <td className="tiny dim">{r.scheduled ? dateTime(r.scheduled) : '—'}</td>
                <td className="small">
                  {r.roundLabel}
                  {r.matchnum ? ` ${r.matchnum}` : ''}
                </td>
                <td className="num">
                  {r.ownScore ?? '—'}–{r.oppScore ?? '—'}
                </td>
                <td>{r.won == null ? '—' : <Badge tone={r.won ? 'green' : 'red'}>{r.won ? 'W' : 'L'}</Badge>}</td>
                <td className="small dim">{conceptual ? r.eventName || '—' : (r.opponents || []).join(' + ')}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {conceptual && data.events?.length > 0 && (
        <Card title="Season tournaments" subtitle="where this sheet's evidence comes from">
          <Table head={['Event', 'Start', { label: 'Record', cls: 'num' }, { label: 'Avg', cls: 'num' }, { label: 'Avg opp', cls: 'num' }]} wrap={false} maxHeight={340}>
            {data.events.map((e) => (
              <tr key={`${e.sku || ''}-${e.name || ''}`}>
                <td className="small">{e.name || e.sku}</td>
                <td className="tiny dim">{String(e.start || '').slice(0, 10) || '—'}</td>
                <td className="num">
                  {e.wins}–{e.losses}
                  {e.ties ? `–${e.ties}` : ''}
                </td>
                <td className="num">{fmt(e.avgScore)}</td>
                <td className="num dim">{fmt(e.avgOpp)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Scouting" subtitle="ten fields per team beats a terabyte of computer vision" right={<span className="tiny dim">{saved ? `saved ${saved}` : ''}</span>}>
        <div className="grid g2">
          {SCOUT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                className="input"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                placeholder={f.hint}
              />
            </Field>
          ))}
        </div>
        <div className="row">
          <Btn variant="primary" onClick={saveScout} disabled={busy}>
            {busy ? 'Saving…' : 'Save scouting'}
          </Btn>
          <span className="tiny dim">Saved notes feed the archetype label and the counter engine once this event has results.</span>
        </div>
      </Card>

      {data.briefing && (
        <Card title="Their profile">
          <Prose paragraphs={data.briefing.paragraphs} />
          <div style={{ marginTop: 10 }}>
            <Claims claims={data.briefing.claims} />
          </div>
        </Card>
      )}

      {data.attack?.coverage?.metricsMissing?.length > 0 && (
        <Note tone="warn">
          Rules that cannot be evaluated because the metric is missing: {data.attack.coverage.metricsMissing.join(', ')}.
          {conceptual ? ' They need autonomous, driver, penalty or clutch data from this event.' : ''}
        </Note>
      )}
    </div>
  )
}
