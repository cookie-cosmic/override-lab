import React, { useEffect, useMemo, useState } from 'react'
import { endpoints, useApi, fmt, pct, dateTime } from '../api.js'
import { Card, Badge, Table, Loading, ErrorBox, TeamTag, Note, Empty, Btn, Field, Prose, Claims } from '../components/ui.jsx'
import { ProbMeter } from '../components/charts.jsx'
import TeamHistory from '../components/History.jsx'

const CONF_TONE = { high: 'green', medium: 'amber', low: '' }

const savedTeam = () => {
  try {
    return localStorage.getItem('onsite-team') || ''
  } catch {
    return ''
  }
}
const rememberTeam = (team) => {
  try {
    localStorage.setItem('onsite-team', team)
  } catch {
    /* private mode: the field just stays empty next time */
  }
}

/**
 * Onsite view: the same model as the post-tournament screens, read standing in the pit.
 *
 * One card per match, in scheduled order, and inside each card the two alliances stay apart:
 * your side on the left, theirs on the right, with every counter attached to the opponent it
 * is about. Nothing is pooled across matches, because at an event you only ever need the
 * match you are walking into.
 */
export default function Onsite({ sku, team, navigate }) {
  const [draft, setDraft] = useState(team || savedTeam())
  const [open, setOpen] = useState({})
  const { data: summary } = useApi(sku ? endpoints.summary(sku) : null)
  const { data, loading, error, reload } = useApi(sku && team ? endpoints.onsite(sku, team) : null)
  // Future event: no schedule exists, so the tab shows the team's previous tournaments instead.
  const historyUrl = sku && team && data?.rosterOnly ? endpoints.history(team) : null
  const { data: history, loading: historyLoading, error: historyError, reload: reloadHistory } = useApi(historyUrl)

  useEffect(() => {
    if (!data) return
    const first = data.nextKey || data.matches[0]?.key
    setOpen(first ? { [first]: true } : {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.team?.team, data?.nextKey, data?.counts?.played])

  const roster = useMemo(() => {
    const power = summary?.leaderboards?.power || []
    return [...new Set(power.map((t) => t.team))].sort()
  }, [summary])

  if (!sku) return <Empty>Load a competition first — onsite planning needs an event in the archive or an unsaved session.</Empty>

  const load = () => {
    const next = draft.trim().toUpperCase()
    if (!next) return
    rememberTeam(next)
    setOpen({})
    navigate(`onsite/${sku}/${encodeURIComponent(next)}`)
  }

  const matches = data?.matches || []
  const toggle = (key) => setOpen((cur) => ({ ...cur, [key]: !cur[key] }))
  const nextIndex = matches.findIndex((m) => m.key === data?.nextKey)

  return (
    <div>
      <Card
        title="Your team"
        subtitle="set it once — this browser remembers it for the next event too"
        right={
          data ? (
            <div className="row" style={{ gap: 6 }}>
              <Badge tone="good">{data.team.team}</Badge>
              <Btn size="sm" variant="ghost" onClick={reload} disabled={loading}>
                refresh
              </Btn>
            </div>
          ) : null
        }
      >
        <div className="row" style={{ alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 220 }}>
            <Field label="Team ID" hint="the number on your robot, e.g. 321A">
              <input
                className="input mono"
                list="onsite-roster"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder="321A"
              />
              <datalist id="onsite-roster">
                {roster.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
          </div>
          <div style={{ paddingBottom: 18 }}>
            <Btn variant="primary" onClick={load} disabled={!draft.trim() || draft.trim().toUpperCase() === (team || '')}>
              Load my run
            </Btn>
          </div>
        </div>
        {!team && <Note>Enter your team number to see one card per match, with your alliance and theirs kept apart.</Note>}
      </Card>

      {team && loading && !data && <Loading label={`Building ${team}'s schedule…`} />}
      {team && error && <ErrorBox error={error} onRetry={reload} />}

      {data?.rosterOnly && (
        <>
          <Note tone="warn">{data.notes?.[0]}</Note>
          <TeamHistory
            team={team}
            history={history}
            loading={historyLoading}
            error={historyError}
            onRetry={reloadHistory}
            subtitle="previous tournaments — nothing is scheduled at this event yet"
          />
        </>
      )}

      {data && !data.rosterOnly && !matches.length && <Note>{data.notes?.[0] || `No matches for ${team} in this event yet.`}</Note>}

      {data &&
        matches.map((m, i) => {
          const isOpen = Boolean(open[m.key])
          const isNext = m.key === data.nextKey
          return (
            <Card
              key={m.key}
              title={`${m.roundLabel} ${m.matchnum}`}
              subtitle={`${dateTime(m.scheduled)} · field ${m.field || '—'}${m.division ? ` · ${m.division}` : ''}`}
              right={
                <div className="row" style={{ gap: 6 }}>
                  {isNext && <Badge tone="blue">next up</Badge>}
                  <Badge tone={m.side === 'red' ? 'red' : 'blue'}>you are {m.side}</Badge>
                  {m.scored ? (
                    <Badge tone={m.won ? 'green' : 'red'}>
                      {m.ownScore}–{m.oppScore}
                    </Badge>
                  ) : (
                    <span className="mono tiny">{pct(m.sim?.pA ?? m.pOwn)}</span>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => toggle(m.key)}>
                    {isOpen ? 'hide' : 'plan'}
                  </Btn>
                </div>
              }
            >
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="tiny dim">you</span>
                <Badge tone="good">{data.team.team}</Badge>
                {m.partners.length ? (
                  m.partners.map((p) => (
                    <span key={p.team} className="row" style={{ gap: 4 }}>
                      <span className="tiny dim">+</span>
                      <TeamTag team={p.team} onClick={(t) => navigate(`team/${sku}/${t}`)} />
                    </span>
                  ))
                ) : (
                  <span className="tiny dim">solo</span>
                )}
                <span className="tiny dim">vs</span>
                {m.opponents.map((o) => (
                  <TeamTag key={o.team} team={o.team} onClick={(t) => navigate(`counter/${sku}/${t}?own=${encodeURIComponent(team)}`)} />
                ))}
                <span className="spacer" />
                {!m.scored && <span className="tiny dim">projected {fmt(m.muOwn)}–{fmt(m.muOpp)}</span>}
              </div>

              {isOpen && (
                <div style={{ marginTop: 12 }}>
                  <div className="grid g2">
                    <div>
                      <div className="tiny" style={{ color: m.side === 'red' ? 'var(--red)' : 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        your alliance · {fmt(m.muOwn)} projected
                      </div>
                      <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone="good">{data.team.team}</Badge>
                          <span className="tiny dim">{data.team.archetype || 'unclassified'}</span>
                        </div>
                        <span className="tiny dim mono">
                          {fmt(data.team.avgPoints)} avg · {fmt(data.team.floor)}–{fmt(data.team.ceiling)}
                        </span>
                      </div>
                      {m.partners.map((p) => (
                        <div key={p.team} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            <div className="row" style={{ gap: 6 }}>
                              <TeamTag team={p.team} onClick={(t) => navigate(`team/${sku}/${t}`)} />
                              <span className="tiny dim">{p.archetype || 'unclassified'}</span>
                              <Badge>{p.role}</Badge>
                            </div>
                            <span className="tiny dim mono">
                              {fmt(p.avgPoints)} avg · {fmt(p.floor)}–{fmt(p.ceiling)}
                            </span>
                          </div>
                          <div className="tiny dim" style={{ marginTop: 2 }}>{p.note}</div>
                        </div>
                      ))}
                      {!m.partners.length && <div className="tiny dim" style={{ padding: '6px 0' }}>No partner: the projection is your score alone.</div>}
                    </div>

                    <div>
                      <div className="tiny" style={{ color: m.side === 'red' ? 'var(--blue)' : 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        their alliance · {fmt(m.muOpp)} projected
                      </div>
                      {m.counters.map((c) => (
                        <div key={c.team} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            <div className="row" style={{ gap: 6 }}>
                              <TeamTag team={c.team} onClick={(t) => navigate(`counter/${sku}/${t}?own=${encodeURIComponent(team)}`)} />
                              <span className="tiny dim">{c.archetype || 'unclassified'}</span>
                            </div>
                            <span className="tiny dim mono">
                              {fmt(c.avgPoints)} avg · floor {fmt(c.floor)}
                            </span>
                          </div>
                          {!c.top.length && <div className="tiny dim" style={{ marginTop: 4 }}>No counter rule fires on their metrics — play your own game.</div>}
                          {c.top.map((v) => (
                            <div key={v.id} style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid var(--amber)' }}>
                              <div className="row tiny" style={{ gap: 6 }}>
                                <Badge tone={CONF_TONE[v.confidence] || ''}>{v.confidence}</Badge>
                                <strong style={{ fontSize: 12.5 }}>{v.title}</strong>
                                <span className="spacer" />
                                <span className="mono tiny">+{v.expectedPoints}</span>
                              </div>
                              <div className="small" style={{ marginTop: 2 }}>{v.action}</div>
                              <div className="tiny dim">trigger: {v.trigger}</div>
                            </div>
                          ))}
                          {c.swingPoints > 0 && <div className="tiny dim" style={{ marginTop: 4 }}>worth about {fmt(c.swingPoints)} pts of swing</div>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <ProbMeter value={m.sim?.pA ?? m.pOwn} label="Alliance win probability" width="100%" />
                    <div className="tiny dim" style={{ marginTop: 6 }}>
                      model {fmt(m.muOwn)} – {fmt(m.muOpp)} · most likely {m.sim?.mostLikely?.a ?? '—'}–{m.sim?.mostLikely?.b ?? '—'} · 10–90%:
                      you {fmt(m.sim?.scoreA?.p10)}–{fmt(m.sim?.scoreA?.p90)}, them {fmt(m.sim?.scoreB?.p10)}–{fmt(m.sim?.scoreB?.p90)}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="tiny dim" style={{ marginBottom: 6, letterSpacing: '0.08em' }}>
                      GAME PLAN FOR THIS MATCH
                    </div>
                    {m.plan.map((p, k) => (
                      <div key={k} className="row" style={{ alignItems: 'flex-start', gap: 8, borderBottom: '1px solid var(--line)', padding: '7px 0' }}>
                        <Badge tone={p.kind === 'model' ? 'blue' : p.kind === 'role' ? 'amber' : p.kind === 'partner' ? 'green' : ''}>{p.kind}</Badge>
                        <div className="small" style={{ flex: 1 }}>
                          {p.team ? <span className="mono tiny dim" style={{ marginRight: 6 }}>{p.team}</span> : null}
                          {p.text}
                        </div>
                        {p.confidence ? <span className="tiny dim">{p.confidence}</span> : null}
                      </div>
                    ))}
                    {m.roles?.length > 0 && (
                      <div className="row" style={{ gap: 6, marginTop: 8 }}>
                        <span className="tiny dim">roles</span>
                        {m.roles.map((r) => (
                          <Badge key={r} tone="blue">{r}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })}

      {data && matches.length > 0 && (
        <Note>
          {nextIndex >= 0
            ? `${nextIndex} of ${matches.length} matches played. Cards above are in scheduled order; unplayed ones are projections, played ones keep their plan next to the result.`
            : `All ${matches.length} matches are scored — nothing left to plan at this event.`}
        </Note>
      )}

      {data && matches.length > 0 && (
        <div className="split">
          <Card title="Your profile" subtitle="team-level, not this match">
            {data.briefing ? (
              <>
                <Prose paragraphs={data.briefing.paragraphs} />
                <div style={{ marginTop: 10 }}>
                  <Claims claims={data.briefing.claims} />
                </div>
              </>
            ) : (
              <Empty>No completed matches for this team yet.</Empty>
            )}
          </Card>

          <Card title="Highest-leverage practice" subtitle="between matches, not during one">
            {data.prescription?.dims?.length ? (
              <>
                <div className="tiny dim" style={{ marginBottom: 8 }}>
                  baseline win probability {pct(data.prescription.baselineWinProb)} across the matches already played
                </div>
                <Table head={['Focus', { label: 'Gain', cls: 'num' }, { label: 'ΔP / 10h', cls: 'num' }]} wrap={false}>
                  {data.prescription.dims.map((d) => (
                    <tr key={d.key}>
                      <td>
                        {d.label}
                        <div className="tiny dim">{d.note}</div>
                      </td>
                      <td className="num mono">+{d.gainPoints}</td>
                      <td className="num mono">+{d.roiPer10h}pp</td>
                    </tr>
                  ))}
                </Table>
                <div className="tiny dim" style={{ marginTop: 8 }}>{data.prescription.caveat}</div>
              </>
            ) : (
              <Empty>{data.prescription?.note || 'Not enough completed matches to rank practice.'}</Empty>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
