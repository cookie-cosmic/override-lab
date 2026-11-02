import React, { useMemo, useState } from 'react'
import { endpoints, useApi, fmt, pct, sign, dateTime } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, TeamTag, Note, Prose, Claims, Empty, Btn, Field, KV } from '../components/ui.jsx'
import { Radar, ProbMeter } from '../components/charts.jsx'
import TeamHistory from '../components/History.jsx'

const Z_LABELS = {
  scoring: 'Scoring',
  ceiling: 'Ceiling',
  floor: 'Floor',
  consistency: 'Consist.',
  auton: 'Auton',
  skills: 'Skills',
  clutch: 'Clutch',
  discipline: 'Discipline'
}

export default function TeamPage({ sku, team, vs, navigate }) {
  const { data: summary } = useApi(sku ? endpoints.summary(sku) : null)
  const { data, loading, error, reload } = useApi(team ? endpoints.team(sku, team, vs) : null)
  // A future event has a roster and no matches, so this team's season comes from history.
  const historyUrl = sku && team && data?.rosterOnly ? endpoints.history(team) : null
  const { data: history, loading: historyLoading, error: historyError, reload: reloadHistory } = useApi(historyUrl)
  const [filter, setFilter] = useState('')

  const roster = summary?.roster || null
  const teams = useMemo(
    () => (roster ? roster.map((r) => r.team) : (summary?.archetypes?.teams || []).map((t) => t.team)).sort(),
    [summary]
  )

  if (!sku) return <Empty>No event selected.</Empty>

  // The picker doubles as the recovery path when a team number is not registered here.
  const pickerCard = (
      <Card title="Team lab" subtitle="pick a team to open its profile, prescription and matchup tools">
        {!summary ? (
          <Loading />
        ) : (
          <div>
            <div className="row" style={{ marginBottom: 10 }}>
              <input className="input" style={{ maxWidth: 220 }} placeholder="filter teams…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <span className="tiny dim">{teams.length} teams</span>
            </div>
            {summary.rosterOnly && (
              <div style={{ marginBottom: 10 }}>
                <Note>
                  This event has not run yet, so there are no ratings — every team opens with its season from previous
                  tournaments.
                </Note>
              </div>
            )}
            {summary.rosterOnly ? (
              <Table head={['Team', 'Name', 'Location']} wrap={false} maxHeight={520}>
                {(summary.roster || [])
                  .filter((r) => !filter || r.team.toLowerCase().includes(filter.toLowerCase()))
                  .map((r) => (
                    <tr key={r.team} className="clickable" onClick={() => navigate(`team/${sku}/${r.team}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <TeamTag team={r.team} />
                      </td>
                      <td className="small">{r.name || '—'}</td>
                      <td className="small dim">{[r.city, r.region].filter(Boolean).join(', ') || '—'}</td>
                    </tr>
                  ))}
              </Table>
            ) : (
              <Table head={['Team', 'Archetype', { label: 'Avg pts', cls: 'num' }, { label: 'Elo', cls: 'num' }, { label: 'Seed', cls: 'num' }]} wrap={false} maxHeight={520}>
                {summary.archetypes.teams
                  .filter((t) => !filter || t.team.toLowerCase().includes(filter.toLowerCase()))
                  .map((t) => {
                    const s = (summary.leaderboards.power || []).find((p) => p.team === t.team)
                    return (
                      <tr key={t.team} className="clickable" onClick={() => navigate(`team/${sku}/${t.team}`)} style={{ cursor: 'pointer' }}>
                        <td>
                          <TeamTag team={t.team} />
                        </td>
                        <td className="small dim">{t.archetype}</td>
                        <td className="num">{fmt(s?.avgPoints)}</td>
                        <td className="num">{fmt(s?.elo)}</td>
                        <td className="num dim">{fmt(s?.rank)}</td>
                      </tr>
                    )
                  })}
              </Table>
            )}
          </div>
        )}
      </Card>
  )
  if (!team) return pickerCard

  if (loading && !data) return <Loading label={`Profiling ${team}…`} />
  if (error) {
    if (!data) {
      return (
        <div>
          <Note tone="warn">{team} is not registered at this event, so there is nothing to profile yet. Pick a team below.</Note>
          {pickerCard}
        </div>
      )
    }
    return <ErrorBox error={error} onRetry={reload} />
  }
  if (!data) return null

  // Registered, nothing played: history instead of invented ratings.
  if (data.rosterOnly) {
    return (
      <div>
        <Note tone="warn">{data.notes?.[0]}</Note>
        <TeamHistory
          team={team}
          history={history}
          loading={historyLoading}
          error={historyError}
          onRetry={reloadHistory}
          subtitle={`${data.team?.name ? `${data.team.name} · ` : ''}everything before this event`}
        />
        <Card title="Registered teams" subtitle={`${summary?.count?.teams ?? summary?.roster?.length ?? 0} teams entered — open any of them`}>
          <Table head={['Team', 'Name', 'Location']} wrap={false} maxHeight={420}>
            {(summary?.roster || []).map((r) => (
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

  const t = data.team
  const rx = data.prescription
  const style = data.style
  const radarAxes = Object.entries(style?.z || {}).map(([k, v]) => ({ label: Z_LABELS[k] || k, value: v }))

  return (
    <div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Record" value={`${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`} sub={`${t.matches} matches · seed ${t.rank ?? '—'}`} />
        <Stat label="Elo" value={t.elo} sub={`80% band ${t.eloBand?.[0]}–${t.eloBand?.[1]}`} />
        <Stat label="Average points" value={fmt(t.avgPoints)} sub={`floor ${fmt(t.floor)} · ceiling ${fmt(t.ceiling)}`} />
        <Stat
          label="Wins above expectation"
          value={sign(t.winsAboveExpectation, 2)}
          tone={t.winsAboveExpectation > 0 ? 'var(--green)' : 'var(--red)'}
          sub={`SOS ${t.sos} · elo adj.`}
        />
      </div>

      <div className="split">
        <Card title={`${t.team}${t.name ? ` — ${t.name}` : ''}`} subtitle={style?.archetype || 'archetype unavailable'}>
          <div className="grid g2">
            <div>
              <KV
                items={[
                  { k: 'OPR', v: `${fmt(t.opr)} (#${t.oprRank ?? '—'})` },
                  { k: 'Points σ', v: fmt(t.sdPoints) },
                  { k: 'CV', v: fmt(t.cv, 3) },
                  { k: 'Auton / match', v: fmt(t.autonPerMatch) },
                  { k: 'Driver / match', v: fmt(t.driverPerMatch) },
                  { k: 'Penalties / match', v: fmt(t.penaltyPerMatch, 2) }
                ]}
              />
            </div>
            <div>
              <KV
                items={[
                  { k: 'Qual avg', v: fmt(t.qualPoints) },
                  { k: 'Elim avg', v: fmt(t.elimPoints) },
                  { k: 'Clutch', v: sign(t.clutch) },
                  { k: 'Skills driver', v: fmt(t.skills?.driver) },
                  { k: 'Skills prog', v: fmt(t.skills?.prog) },
                  { k: 'Skills attempts', v: fmt(t.skills?.attempts) }
                ]}
              />
            </div>
          </div>
          {radarAxes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Radar axes={radarAxes} />
              <div className="center tiny dim">z-score vs this field (0 = field average, ring = 1σ)</div>
            </div>
          )}
          {style?.scouting && Object.keys(style.scouting).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Note tone="good">
                Scouted: {style.scouting.archetype || 'notes on file'}
                {style.scouting.targetPriority ? ` · priority: ${style.scouting.targetPriority}` : ''}
                {style.scouting.endgame ? ` · endgame: ${style.scouting.endgame}` : ''}
              </Note>
            </div>
          )}
        </Card>

        <div>
          <Card title="Matchup tool" subtitle="compare against another team">
            <Field label="Opponent">
              <select value={vs || ''} onChange={(e) => navigate(`team/${sku}/${t.team}${e.target.value ? `?vs=${encodeURIComponent(e.target.value)}` : ''}`)}>
                <option value="">— select —</option>
                {teams.filter((x) => x !== t.team).map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            {data.vs?.sim ? (
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="mono">{t.team}</span>
                  <span className="tiny dim">typical partner each</span>
                  <span className="mono">{data.vs.team}</span>
                </div>
                <ProbMeter value={data.vs.sim.pA} label={`P(${t.team} wins)`} width="100%" />
                <div className="tiny dim" style={{ marginTop: 6 }}>
                  Projected {data.vs.sim.mostLikely.a}–{data.vs.sim.mostLikely.b} · 80% band {data.vs.sim.scoreA.p10}–{data.vs.sim.scoreA.p90} vs{' '}
                  {data.vs.sim.scoreB.p10}–{data.vs.sim.scoreB.p90}
                </div>
                {data.vs.h2h?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="tiny dim" style={{ marginBottom: 4 }}>
                      Head to head ({data.vs.h2h.length})
                    </div>
                    {data.vs.h2h.map((h) => (
                      <div className="row tiny" key={h.key} style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
                        <span style={{ color: 'var(--red)' }}>{h.red.join('+')} {h.redScore}</span>
                        <span className="dim">v</span>
                        <span style={{ color: 'var(--blue)' }}>{h.blue.join('+')} {h.blueScore}</span>
                      </div>
                    ))}
                  </div>
                )}
                {data.attack?.top?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="tiny dim" style={{ marginBottom: 4 }}>
                      Best counters vs {data.vs.team}
                    </div>
                    {data.attack.top.slice(0, 3).map((v) => (
                      <div key={v.id} className="small" style={{ marginBottom: 5 }}>
                        <Badge tone={v.confidence === 'high' ? 'green' : v.confidence === 'medium' ? 'amber' : ''}>{v.confidence}</Badge>{' '}
                        {v.title} <span className="dim tiny">+{v.expectedPoints} pts</span>
                      </div>
                    ))}
                    <div className="tiny dim">
                      With the plan: {pct(data.attack.winProbWithPlan)} vs {pct(data.attack.winProb)} ({sign(data.attack.deltaP * 100, 1)}pp)
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Note>Pick an opponent to simulate the matchup, surface head-to-head history and rank counters.</Note>
            )}
          </Card>

          <Card title="Percentile in field">
            <KV
              items={Object.entries(data.percentiles)
                .filter(([, v]) => v != null)
                .map(([k, v]) => ({ k, v: pct(v) }))}
            />
          </Card>
        </div>
      </div>

      {data.briefing && (
        <Card title="Analysis" subtitle="generated, every claim bound to a number">
          <Prose paragraphs={data.briefing.paragraphs} />
          <div style={{ marginTop: 10 }}>
            <Claims claims={data.briefing.claims} />
          </div>
          {data.briefing.caveat && (
            <div style={{ marginTop: 8 }}>
              <Note>{data.briefing.caveat}</Note>
            </div>
          )}
        </Card>
      )}

      {rx?.dims?.length > 0 && (
        <Card
          title="Practice priorities"
          subtitle={`baseline ${pct(rx.baselineWinProb)} win probability over ${rx.matches} matches`}
          right={<Badge tone="amber">marginal analysis</Badge>}
        >
          <Table
            head={['#', 'Lever', 'Improvement', { label: 'Δ P(win)', cls: 'num' }, { label: 'Hours', cls: 'num' }, { label: 'per 10h', cls: 'num' }, 'Assumption']}
            wrap={false}
          >
            {rx.dims.map((d, i) => (
              <tr key={d.key}>
                <td className="num">{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{d.label}</td>
                <td className="small">
                  +{d.gainPoints} {d.unit}
                </td>
                <td className="num" style={{ color: 'var(--green)' }}>
                  +{(d.deltaP * 100).toFixed(1)}pp
                </td>
                <td className="num dim">{d.hours}</td>
                <td className="num">{d.roiPer10h}pp</td>
                <td className="tiny dim">{d.note}</td>
              </tr>
            ))}
          </Table>
          {rx.caveat && (
            <div style={{ marginTop: 10 }}>
              <Note>{rx.caveat}</Note>
            </div>
          )}
        </Card>
      )}

      {rx?.gaps?.length > 0 && (
        <Card title="Gap to the top decile" subtitle="what separates this team from the strongest in the field">
          <Table head={['Metric', { label: 'Value', cls: 'num' }, { label: 'Top decile', cls: 'num' }, { label: 'Gap', cls: 'num' }, { label: 'Percentile', cls: 'num' }]} wrap={false}>
            {rx.gaps.map((g) => (
              <tr key={g.key}>
                <td>{g.label}</td>
                <td className="num">{fmt(g.value)}</td>
                <td className="num dim">{fmt(g.topDecile)}</td>
                <td className="num" style={{ color: g.gap > 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {fmt(g.gap)}
                </td>
                <td className="num">{pct(g.percentile)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Match log" subtitle="click to open the match">
        <Table head={['Round', { label: '#', cls: 'num' }, 'Side', 'Alliance', { label: 'Score', cls: 'num' }, 'Opponent', { label: 'P(win)', cls: 'num' }]} wrap={false} maxHeight={420}>
          {data.matches.map((m) => (
            <tr key={m.key} className="clickable" style={{ cursor: 'pointer' }} onClick={() => navigate(`matches/${sku}?m=${encodeURIComponent(m.key)}`)}>
              <td className="tiny dim">{m.roundLabel}</td>
              <td className="num">{m.matchnum}</td>
              <td>
                <Badge tone={m.side === 'red' ? 'red' : 'blue'}>{m.side}</Badge>
              </td>
              <td>{m.own.join(' + ')}</td>
              <td className="num">
                {m.ownScore == null ? '—' : `${m.ownScore}–${m.oppScore}`}
                {m.won === true ? <span style={{ color: 'var(--green)' }}> W</span> : m.won === false ? <span style={{ color: 'var(--red)' }}> L</span> : null}
              </td>
              <td className="dim small">{m.opp.join(' + ')}</td>
              <td className="num">{pct(m.pWin)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
