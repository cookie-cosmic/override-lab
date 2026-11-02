import React, { useEffect, useMemo, useState } from 'react'
import { jpost, endpoints, useApi, fmt, pct, sign } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, TeamTag, Note, Empty, Btn, Field, Prose, Claims, KV } from '../components/ui.jsx'
import { ProbMeter } from '../components/charts.jsx'

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

  // A future event has names but no results: counters are built from tendencies, so there is
  // nothing to rank yet. Point at the team lab instead of showing an empty rule list.
  if (summary?.rosterOnly) {
    return (
      <div>
        <Card title="Opponent card" subtitle="counters need completed matches">
          <Note tone="warn">
            Nothing has been played at this event yet, so no opponent has tendencies to attack. Each team's previous tournaments
            are in the team lab, and the simulation tab fills in once results start landing.
          </Note>
        </Card>
        <Card title="Registered teams" subtitle={`${summary.roster?.length || 0} teams entered`}>
          <Table head={['Team', 'Name', 'Location']} wrap={false} maxHeight={420}>
            {(summary.roster || []).map((r) => (
              <tr key={r.team} className="clickable" onClick={() => navigate(`team/${sku}/${r.team}`)} style={{ cursor: 'pointer' }}>
                <td>
                  <TeamTag team={r.team} />
                </td>
                <td className="small">{r.name || '—'}</td>
                <td className="small dim">{[r.city, r.region].filter(Boolean).join(', ') || '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    )
  }

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

  return (
    <div>
      <Card
        title="Opponent card"
        subtitle="scouting-derived counters, ranked by expected point swing"
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
        {!opp && <Note>Choose an opponent to generate a match card: their tendencies, ranked attack vectors, role assignments and a trigger sheet.</Note>}
        {opp && loading && !data && <Loading />}
        {opp && error && <ErrorBox error={error} onRetry={reload} />}
      </Card>

      {data && (
        <div>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <Stat label="Opponent" value={data.team.team} sub={data.style?.archetype || 'unscouted'} />
            <Stat label="Avg points" value={fmt(data.team.avgPoints)} sub={`floor ${fmt(data.team.floor)} · ceiling ${fmt(data.team.ceiling)}`} />
            <Stat label="Elo" value={data.team.elo} sub={`#${data.team.rank ?? '—'} seed`} />
            <Stat
              label="Win prob vs them"
              value={pct(data.attack.winProbWithPlan)}
              tone={data.attack.winProbWithPlan > data.attack.winProb ? 'var(--green)' : undefined}
              sub={`baseline ${pct(data.attack.winProb)} · ${sign(data.attack.deltaP * 100, 1)}pp with plan`}
            />
          </div>

          <div className="split">
            <Card title="Attack vectors" subtitle={`${data.attack.top.length} of ${data.attack.vectors.length} rules fired · rules v${data.attack.rulesVersion}`}>
              {data.attack.vectors.length === 0 && <Empty>No rules fired: this opponent has no exploitable threshold in the current metrics.</Empty>}
              {data.attack.vectors.map((v, i) => (
                <div key={v.id} style={{ borderBottom: i === data.attack.vectors.length - 1 ? 'none' : '1px solid var(--line)', padding: '10px 0' }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <Badge tone={CONF_TONE[v.confidence] || ''}>{v.confidence}</Badge>
                    <strong style={{ fontSize: 13 }}>{v.title}</strong>
                    <span className="spacer" />
                    <span className="mono tiny">+{v.expectedPoints} pts</span>
                    <span className="tiny dim">cap {Math.round(v.capability * 100)}%</span>
                  </div>
                  <div className="small" style={{ color: '#c8d4e4' }}>
                    {v.action}
                  </div>
                  <div className="tiny dim" style={{ marginTop: 4 }}>
                    trigger: {v.trigger} · metric {v.metric} = {v.observed} (threshold {v.when?.value ?? v.threshold})
                  </div>
                </div>
              ))}
            </Card>

            <div>
              <Card title="Match card" subtitle="printable one-pager">
                <KV
                  items={[
                    { k: 'Opponent', v: data.team.team },
                    { k: 'Archetype', v: data.style?.archetype || '—' },
                    { k: 'Avg points', v: fmt(data.team.avgPoints) },
                    { k: 'Floor / ceiling', v: `${fmt(data.team.floor)} / ${fmt(data.team.ceiling)}` },
                    { k: 'Auton / match', v: fmt(data.metrics.autonPerMatch) },
                    { k: 'Driver / match', v: fmt(data.metrics.driverPerMatch) },
                    { k: 'Penalties / match', v: fmt(data.metrics.penaltyPerMatch, 2) },
                    { k: 'CV (instability)', v: fmt(data.team.cv, 3) },
                    { k: 'Clutch', v: sign(data.team.clutch) }
                  ]}
                />
                <div style={{ marginTop: 10 }}>
                  <div className="tiny dim" style={{ marginBottom: 4 }}>
                    TRIGGER SHEET
                  </div>
                  {data.attack.triggers.map((t, i) => (
                    <div key={i} className="small" style={{ borderLeft: '2px solid var(--amber)', paddingLeft: 8, marginBottom: 6 }}>
                      {t.trigger}
                      <div className="tiny dim">{t.from}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <div className="tiny dim" style={{ marginBottom: 4 }}>
                    ROLES
                  </div>
                  <div className="row">
                    {data.attack.roles.map((r) => (
                      <Badge key={r} tone="blue">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              </Card>

              <Card title="Win probability">
                <ProbMeter value={data.attack.winProb} label="Baseline" width="100%" />
                <div style={{ height: 8 }} />
                <ProbMeter value={data.attack.winProbWithPlan} label="With the plan executed" width="100%" />
                <div className="tiny dim" style={{ marginTop: 8 }}>
                  Plan is worth {data.attack.swingPoints} expected points. Estimates assume about half of the counter converts.
                </div>
              </Card>
            </div>
          </div>

          <Card title="Scouting" subtitle="10 fields per team beats a terabyte of computer vision" right={<span className="tiny dim">{saved ? `saved ${saved}` : ''}</span>}>
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
              <span className="tiny dim">Saved notes feed the archetype label and the counter engine.</span>
            </div>
          </Card>

          <Card title="Recent matches">
            <Table head={['Round', { label: '#', cls: 'num' }, 'Alliance', { label: 'Score', cls: 'num' }, 'Opponent']} wrap={false}>
              {data.matches.map((m) => (
                <tr key={m.key}>
                  <td className="tiny dim">{m.roundLabel}</td>
                  <td className="num">{m.matchnum}</td>
                  <td>{m.own.join(' + ')}</td>
                  <td className="num">
                    {m.ownScore ?? '—'}–{m.oppScore ?? '—'}
                  </td>
                  <td className="dim small">{m.opp.join(' + ')}</td>
                </tr>
              ))}
            </Table>
          </Card>

          {data.briefing && (
            <Card title="Their profile">
              <Prose paragraphs={data.briefing.paragraphs} />
              <div style={{ marginTop: 10 }}>
                <Claims claims={data.briefing.claims} />
              </div>
            </Card>
          )}

          {data.attack.coverage?.metricsMissing?.length > 0 && (
            <Note tone="warn">
              Metrics missing for this opponent, so some rules could not be evaluated: {data.attack.coverage.metricsMissing.join(', ')}.
            </Note>
          )}
        </div>
      )}
    </div>
  )
}
