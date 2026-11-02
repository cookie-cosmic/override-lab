import React, { useMemo, useState } from 'react'
import { jdel, jpost, endpoints, useApi, fmt, pct, sign, clock, dateTime } from '../api.js'
import { Card, Badge, Table, Loading, ErrorBox, TeamTag, Note, Empty, Btn, Claims, Prose, Field } from '../components/ui.jsx'
import { Line, ProbMeter } from '../components/charts.jsx'

export default function Matches({ sku, navigate, matchKey }) {
  const { data, loading, error, reload } = useApi(sku ? endpoints.matches(sku) : null)
  const [round, setRound] = useState('all')
  const [q, setQ] = useState('')
  const [onlyScored, setOnlyScored] = useState(true)

  const matches = data?.matches || []
  const rounds = useMemo(() => {
    const seen = new Map()
    for (const m of matches) seen.set(m.round, m.roundLabel)
    return [...seen.entries()].sort((a, b) => a[0] - b[0])
  }, [matches])

  const filtered = useMemo(
    () =>
      matches.filter((m) => {
        if (onlyScored && !m.scored) return false
        if (round !== 'all' && String(m.round) !== String(round)) return false
        if (q) {
          const needle = q.toLowerCase()
          const hay = [...m.red, ...m.blue].join(' ').toLowerCase()
          if (!hay.includes(needle)) return false
        }
        return true
      }),
    [matches, round, q, onlyScored]
  )

  if (!sku) return <Empty>No event selected.</Empty>
  if (loading && !data) return <Loading label="Loading matches…" />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const openTeam = (t) => navigate(`team/${sku}/${t}`)
  const openMatch = (k) => navigate(`matches/${sku}?m=${encodeURIComponent(k)}`)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: matchKey ? 'minmax(0, 0.9fr) minmax(0, 1.35fr)' : '1fr', gap: 16 }}>
      <div>
        <Card
          title="Match index"
          subtitle={`${filtered.length} shown`}
          right={
            <div className="row" style={{ gap: 6 }}>
              <select value={round} onChange={(e) => setRound(e.target.value)} style={{ width: 130 }}>
                <option value="all">All rounds</option>
                {rounds.map(([r, label]) => (
                  <option key={r} value={r}>
                    {label}
                  </option>
                ))}
              </select>
              <input className="input" style={{ width: 110 }} placeholder="team…" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="tiny muted row" style={{ gap: 4 }}>
                <input type="checkbox" checked={onlyScored} onChange={(e) => setOnlyScored(e.target.checked)} /> scored
              </label>
            </div>
          }
          flush
        >
          <div className="table-wrap" style={{ maxHeight: '72vh' }}>
            <table className="table clickable">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Alliances</th>
                  <th className="num">Score</th>
                  <th className="num">P(red)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 400).map((m) => {
                  const active = m.key === matchKey
                  return (
                    <tr key={m.key} onClick={() => openMatch(m.key)} style={active ? { background: 'rgba(75,141,255,0.08)' } : undefined}>
                      <td className="nowrap">
                        <div className="mono" style={{ fontWeight: 600 }}>
                          {m.roundLabel === 'Qualification' ? 'Q' : m.roundLabel === 'Practice' ? 'P' : 'E'}
                          {m.matchnum}
                        </div>
                        <div className="tiny dim">{m.field || '—'}</div>
                      </td>
                      <td>
                        <div style={{ color: 'var(--red)' }}>
                          {m.red.map((t) => (
                            <span key={t} style={{ marginRight: 6 }} onClick={(e) => { e.stopPropagation(); openTeam(t) }}>
                              <TeamTag team={t} />
                            </span>
                          ))}
                        </div>
                        <div style={{ color: 'var(--blue)' }}>
                          {m.blue.map((t) => (
                            <span key={t} style={{ marginRight: 6 }}>
                              <TeamTag team={t} onClick={openTeam} />
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="num">
                        {m.scored ? (
                          <span>
                            <span style={{ color: 'var(--red)' }}>{m.redScore}</span>
                            <span className="dim">–</span>
                            <span style={{ color: 'var(--blue)' }}>{m.blueScore}</span>
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="num" style={{ color: m.pRed > 0.5 ? 'var(--blue)' : 'var(--red)' }}>
                        {pct(m.pRed)}
                      </td>
                      <td className="tiny dim nowrap">
                        {m.media ? <Badge tone="green">▶</Badge> : null}
                        {m.tagged ? <Badge tone="amber">{m.tagged}</Badge> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div>
        {matchKey ? (
          <MatchPanel sku={sku} matchKey={matchKey} navigate={navigate} />
        ) : (
          <Card title="Select a match">
            <Note>
              Pick a match to see phase attribution, who actually produced the margin, why the losing side lost, win-probability
              counterfactuals, and the video-aligned score tagger.
            </Note>
          </Card>
        )}
      </div>
    </div>
  )
}

function MatchPanel({ sku, matchKey, navigate }) {
  const { data: d, loading, error, reload } = useApi(endpoints.match(sku, matchKey))
  if (loading && !d) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!d) return null
  const m = d.match
  const a = d.attribution
  const openTeam = (t) => navigate(`team/${sku}/${t}`)

  const phaseMax = a.phases?.available
    ? Math.max(1, ...a.phases.phases.flatMap((p) => [p.red, p.blue]))
    : 1

  return (
    <div>
      <Card
        title={`${m.roundLabel || 'Match'} ${m.matchnum}`}
        subtitle={`${m.division} · field ${m.field || '—'} · ${dateTime(m.scheduled)}`}
        right={m.winner ? <Badge tone={m.winner === 'red' ? 'red' : 'blue'}>{m.winner === 'red' ? 'Red' : 'Blue'} won</Badge> : null}
      >
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="scoreline">
            <span className="r">{m.red_score ?? '—'}</span>
            <span className="vs">vs</span>
            <span className="b">{m.blue_score ?? '—'}</span>
          </div>
          <span className="spacer" />
          <div className="tiny dim">
            projected {fmt(m.muRed)}–{fmt(m.muBlue)} · P(red) {pct(m.pRed)}
          </div>
        </div>

        <div className="grid g2">
          {['red', 'blue'].map((side) => (
            <div key={side}>
              <div className="tiny" style={{ color: side === 'red' ? 'var(--red)' : 'var(--blue)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {side} alliance
              </div>
              {d.teams[side].map((t) => (
                <div key={t.team} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                  <TeamTag team={t.team} onClick={openTeam} />
                  <span className="tiny dim mono">{fmt(t.avgPoints)} pts avg · Elo {t.elo ?? '—'}</span>
                </div>
              ))}
              {d.attribution.contributions?.[side]?.length ? (
                <div className="tiny dim" style={{ marginTop: 4 }}>
                  attributed: {d.attribution.contributions[side].map((c) => `${c.team} ${fmt(c.points)}`).join(' • ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {d.video && (
        <Card
          title="Stream"
          subtitle={d.video.label || d.video.youtube_id}
          right={
            <Btn size="sm" onClick={() => navigate(`stream/${sku}?m=${encodeURIComponent(d.key)}`)}>
              Open stream analysis
            </Btn>
          }
        >
          {d.media ? (
            <div className="small muted">
              This match starts at <span className="mono">{clock(d.media.seek_s)}</span> in the stream · offset {d.media.offset_s}s ·
              confidence {Math.round((d.media.confidence || 0) * 100)}%
            </div>
          ) : (
            <div className="small muted">The stream is not aligned to this match yet.</div>
          )}
          <div className="tiny dim" style={{ marginTop: 6 }}>
            Playback, offsets and alignment confidence live in Stream analysis so this page stays focused on the match itself.
          </div>
        </Card>
      )}

      {a.phases?.available && (
        <Card title="Phase breakdown" subtitle={`covers ${pct(a.phases.coverage)} of the recorded score`}>
          {a.phases.phases.map((p) => (
            <div key={p.key} style={{ marginBottom: 10 }}>
              <div className="row tiny" style={{ marginBottom: 2 }}>
                <span className="muted">{p.label}</span>
                <span className="spacer" />
                <span className="mono">
                  {p.red} – {p.blue} ({sign(p.delta)})
                </span>
              </div>
              <div style={{ display: 'flex', gap: 2, height: 10 }}>
                <div style={{ flex: Math.max(0.001, p.red), background: 'var(--red)', borderRadius: 2 }} title={`red ${p.red}`} />
                <div style={{ flex: Math.max(0.001, p.blue), background: 'var(--blue)', borderRadius: 2 }} title={`blue ${p.blue}`} />
              </div>
            </div>
          ))}
        </Card>
      )}

      {(a.redLoss?.length > 0 || a.blueLoss?.length > 0) && (
        <Card title="Why the losing side lost" subtitle="normalised factor weights, not verdicts">
          <div className="grid g2">
            {['red', 'blue'].map((side) => {
              const causes = side === 'red' ? a.redLoss : a.blueLoss
              if (!causes?.length) return null
              return (
                <div key={side}>
                  <div className="tiny" style={{ color: side === 'red' ? 'var(--red)' : 'var(--blue)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {side} lost
                  </div>
                  {causes.map((c) => (
                    <div key={c.key} style={{ marginBottom: 8 }}>
                      <div className="row tiny">
                        <span style={{ fontWeight: 600 }}>{c.label}</span>
                        <span className="spacer" />
                        <span className="mono">{Math.round(c.share * 100)}%</span>
                      </div>
                      <div className="prob" style={{ height: 4 }}>
                        <span style={{ width: `${c.share * 100}%`, background: 'var(--amber)' }} />
                      </div>
                      <div className="tiny dim">{c.evidence}</div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card title="Win-probability timeline"        subtitle={
          d.wpa?.available
            ? `${d.wpa.partial ? 'partial' : d.wpa.estimated ? 'estimated' : 'tagged'} timeline · ${Math.round((d.wpa.coverage || 0) * 100)}% of score · leverage ${(d.wpa.leverage * 100).toFixed(1)}pp`
            : 'requires score events'
        }>
        {d.wpa?.available ? (
          <Line
            series={[{ label: 'P(red wins)', color: 'var(--blue)', points: d.wpa.series.map((p) => ({ x: p.t, y: p.p })) }]}
            yDomain={[0, 1]}
            height={170}
            area
            zero={0.5}
            yFormat={(v) => `${Math.round(v * 100)}%`}
            xFormat={(v) => `${Math.round(v)}s`}
            playhead={d.wpa.series.length ? d.wpa.series[d.wpa.series.length - 1].t : null}
          />
        ) : (
          <Note>{d.wpa?.reason || 'No score events tagged for this match.'}</Note>
        )}
        {d.wpa?.available && d.wpa.biggestSwing && (
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Biggest single swing: {d.wpa.biggestSwing.alliance} +{d.wpa.biggestSwing.points} at {clock(d.wpa.biggestSwing.t_s)} →{' '}
            {(d.wpa.biggestSwing.wpa * 100).toFixed(1)}pp
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Tagger detail={d} onChanged={reload} />
        </div>
      </Card>

      {a.counterfactuals?.red?.projections?.length > 0 && (
        <Card title="Counterfactuals" subtitle="model-conditional, not observed">
          <div className="grid g2">
            {['red', 'blue'].map((side) => {
              const cf = a.counterfactuals[side]
              if (!cf) return null
              return (
                <div key={side}>
                  <div className="tiny dim" style={{ marginBottom: 4 }}>
                    {side} baseline {pct(cf.baseP)}
                  </div>
                  {cf.projections.map((p, i) => (
                    <div className="row tiny" key={i} style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
                      <span>{p.label}</span>
                      <span className="spacer" />
                      <span className="mono">{pct(p.winProb)}</span>
                      <span className="mono" style={{ color: p.deltaP > 0 ? 'var(--green)' : 'var(--dim)', width: 58, textAlign: 'right' }}>
                        {sign(p.deltaP * 100, 1)}pp
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {d.postMortem && (
        <Card title="Post-mortem" subtitle="generated, evidence-linked">
          <Prose paragraphs={d.postMortem.paragraphs} />
          <div style={{ marginTop: 10 }}>
            <Claims claims={d.postMortem.claims} />
          </div>
          {d.postMortem.caveat && (
            <div style={{ marginTop: 8 }}>
              <Note>{d.postMortem.caveat}</Note>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function Tagger({ detail, onChanged }) {
  const [t, setT] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const add = async (alliance, points) => {
    setBusy(true)
    setMsg(null)
    try {
      await jpost('/api/score-events', {
        key: detail.key,
        t_s: Number(t || 0),
        alliance,
        points,
        note: 'manual tag'
      })
      onChanged()
    } catch (e) {
      setMsg(e.message)
    }
    setBusy(false)
  }

  const remove = async (id) => {
    try {
      await jdel(`/api/score-events/${id}`)
      onChanged()
    } catch (e) {
      setMsg(e.message)
    }
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ width: 90 }}>
          <Field label="Match second">
            <input className="input mono" value={t} onChange={(e) => setT(e.target.value)} placeholder="45" />
          </Field>
        </div>
        <div className="row" style={{ gap: 4, paddingBottom: 10 }}>
          <span className="tiny dim">red</span>
          {[1, 2, 3, 6, 12].map((p) => (
            <Btn key={`r${p}`} size="sm" disabled={busy} onClick={() => add('red', p)}>
              +{p}
            </Btn>
          ))}
          <span className="tiny dim" style={{ marginLeft: 8 }}>
            blue
          </span>
          {[1, 2, 3, 6, 12].map((p) => (
            <Btn key={`b${p}`} size="sm" disabled={busy} onClick={() => add('blue', p)}>
              +{p}
            </Btn>
          ))}
        </div>
      </div>
      {msg && <div className="tiny" style={{ color: 'var(--red)' }}>{msg}</div>}
      {detail.scoreEvents?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Table head={['t', 'Alliance', { label: 'Pts', cls: 'num' }, { label: '', cls: 'num' }]} wrap={false} maxHeight={180}>
            {detail.scoreEvents.map((e) => (
              <tr key={e.id}>
                <td className="mono">{clock(e.t_s)}</td>
                <td style={{ color: e.alliance === 'red' ? 'var(--red)' : 'var(--blue)' }}>{e.alliance}</td>
                <td className="num">{e.points}</td>
                <td className="num">
                  <Btn size="sm" variant="ghost" onClick={() => remove(e.id)}>
                    ✕
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <div className="tiny dim" style={{ marginTop: 6 }}>
        Tag scoring as you watch: scrub the video to the moment, type the match second, click the alliance button. Events build the
        win-probability curve and per-event WPA. If the tagged total misses the official score, the curve is rescaled and flagged as
        estimated.
      </div>
    </div>
  )
}
