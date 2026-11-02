import React, { useState } from 'react'
import { endpoints, useApi, fmt, pct, sign, dateTime } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, TeamTag, Note, Prose, Claims, Tabs, Empty } from '../components/ui.jsx'
import { Bars, HBars } from '../components/charts.jsx'

const LB_TABS = [
  { id: 'scoring', label: 'Scoring' },
  { id: 'floor', label: 'Floor' },
  { id: 'ceiling', label: 'Ceiling' },
  { id: 'auton', label: 'Autonomous' },
  { id: 'skills', label: 'Skills' },
  { id: 'penalties', label: 'Penalties' },
  { id: 'clutch', label: 'Clutch' },
  { id: 'luck', label: 'Schedule luck' }
]

export default function Overview({ sku, navigate }) {
  const { data: s, loading, error, reload } = useApi(sku ? endpoints.summary(sku) : null)
  const [lb, setLb] = useState('scoring')

  if (!sku) return <Empty>No events yet.</Empty>
  if (loading && !s) return <Loading label="Building ratings, archetypes and calibration…" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!s) return null

  const openTeam = (t) => navigate(`team/${sku}/${t}`)
  const openMatch = (k) => navigate(`matches/${sku}?m=${encodeURIComponent(k)}`)
  const cal = s.model?.calibration || {}
  const dist = s.distributions || {}

  const lbRows =
    lb === 'skills'
      ? (s.leaderboards.skills || []).map((t, i) => (
          <tr key={t.team}>
            <td className="num">{i + 1}</td>
            <td>
              <TeamTag team={t.team} onClick={openTeam} />
            </td>
            <td className="num">{fmt(t.value)}</td>
            <td className="num">{fmt(t.driver)}</td>
            <td className="num">{fmt(t.prog)}</td>
          </tr>
        ))
      : (s.leaderboards[lb] || []).map((t, i) => (
          <tr key={`${t.team}-${i}`}>
            <td className="num">{i + 1}</td>
            <td>
              <TeamTag team={t.team} onClick={openTeam} />
            </td>
            <td className="num">{fmt(t.value, 2)}</td>
            <td className="num dim">{t.elo ? `Elo ${t.elo}` : ''}</td>
          </tr>
        ))

  return (
    <div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Teams analysed" value={s.count.teams} sub={`${s.count.matches} matches · ${s.count.scored} scored`} />
        <Stat label="Median win margin" value={fmt(dist.medianMargin)} sub={`${dist.close} inside 5 pts · ${dist.blowouts} by 25+`} />
        <Stat
          label="Brier (LOO)"
          value={cal.brier != null ? cal.brier : '—'}
          sub={cal.baselineBrier != null ? `vs ${cal.baselineBrier} baseline · n=${cal.n}` : 'not enough results'}
        />
        <Stat label="Field spread σ" value={fmt(s.model?.sigmaMargin)} sub={`expected alliance score ${fmt(s.model?.eventMean)}`} />
      </div>

      {s.digest && (
        <Card title="What happened" subtitle="auto-generated from the archive" right={<Badge tone="purple">{s.digest.claims?.length || 0} claims</Badge>}>
          <Prose paragraphs={s.digest.paragraphs} />
          <div style={{ marginTop: 12 }}>
            <Claims claims={s.digest.claims} />
          </div>
          {s.digest.caveat && <div style={{ marginTop: 10 }}><Note>{s.digest.caveat}</Note></div>}
        </Card>
      )}

      <div className="split">
        <Card title="Power ranking" subtitle="Elo with bootstrap 80% band">
          <Table head={['#', 'Team', { label: 'Elo', cls: 'num' }, { label: '80% band', cls: 'num' }, { label: 'OPR', cls: 'num' }, { label: 'Avg', cls: 'num' }, { label: 'WAE', cls: 'num' }, { label: 'Seed', cls: 'num' }]} wrap={false}>
            {s.leaderboards.power.map((t, i) => (
              <tr key={t.team}>
                <td className="num">{i + 1}</td>
                <td>
                  <TeamTag team={t.team} onClick={openTeam} />
                </td>
                <td className="num">{t.elo}</td>
                <td className="num dim">
                  {t.band?.[0]}–{t.band?.[1]}
                </td>
                <td className="num">{fmt(t.opr)}</td>
                <td className="num">{fmt(t.avgPoints)}</td>
                <td className="num" style={{ color: t.winsAboveExpectation > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {sign(t.winsAboveExpectation, 1)}
                </td>
                <td className="num dim">{t.rank ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <div>
          <Card title="Biggest upsets" subtitle="winner had under 40% pre-match probability">
            {!s.upsets.length ? (
              <Empty>No upsets below the 40% threshold.</Empty>
            ) : (
              <Table head={['Round', 'Winner', { label: 'Score', cls: 'num' }, { label: 'P(win)', cls: 'num' }]} wrap={false}>
                {s.upsets.map((u) => (
                  <tr key={u.key} className="" onClick={() => openMatch(u.key)} style={{ cursor: 'pointer' }}>
                    <td className="dim tiny">{u.roundLabel}</td>
                    <td>
                      {(u.winner === 'red' ? u.red : u.blue).map((t) => (
                        <div key={t}>
                          <TeamTag team={t} onClick={openTeam} />
                        </div>
                      ))}
                    </td>
                    <td className="num">
                      {u.redScore}–{u.blueScore}
                    </td>
                    <td className="num" style={{ color: 'var(--amber)' }}>
                      {pct(u.winnerP)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Bracket" subtitle={s.bracket.champion ? `Champion: ${s.bracket.champion.join(' + ')}` : 'no elimination data'}>
            {!s.bracket.rounds.length ? (
              <Empty>No elimination rounds found.</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {s.bracket.rounds.map((r) => (
                  <div key={r.round}>
                    <div className="tiny dim" style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {r.label}
                    </div>
                    {r.matches.map((m) => (
                      <div
                        key={m.key}
                        className="row"
                        style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                        onClick={() => openMatch(m.key)}
                      >
                        <span style={{ color: m.winner === 'red' ? 'var(--red)' : 'var(--muted)', fontWeight: m.winner === 'red' ? 700 : 400 }}>
                          {m.red.join(' + ')} {m.redScore}
                        </span>
                        <span className="dim">vs</span>
                        <span style={{ color: m.winner === 'blue' ? 'var(--blue)' : 'var(--muted)', fontWeight: m.winner === 'blue' ? 700 : 400 }}>
                          {m.blue.join(' + ')} {m.blueScore}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="grid g2">
        <Card title="Alliance score distribution">
          <Bars bins={dist.allianceScores || []} color="var(--blue)" labelEvery={Math.max(1, Math.round((dist.allianceScores || []).length / 8))} />
        </Card>
        <Card title="Margin distribution" subtitle="red minus blue">
          <Bars bins={dist.margins || []} color="var(--purple)" labelEvery={Math.max(1, Math.round((dist.margins || []).length / 8))} />
        </Card>
      </div>

      <Card
        title="Leaderboards"
        right={<Tabs tabs={LB_TABS} active={lb} onChange={setLb} />}
        subtitle={lb === 'luck' ? 'wins above schedule expectation' : null}
      >
        <Table
          head={lb === 'skills' ? ['#', 'Team', { label: 'Combined', cls: 'num' }, { label: 'Driver', cls: 'num' }, { label: 'Prog', cls: 'num' }] : ['#', 'Team', { label: 'Value', cls: 'num' }, { label: '', cls: 'num' }]}
          wrap={false}
        >
          {lbRows && lbRows.length > 0 ? (
            lbRows
          ) : (
            <tr>
              <td colSpan={5} className="dim small">
                No data for this leaderboard: this archive does not carry that metric (no autonomous or penalty split in this source).
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Card title="Archetypes" subtitle="k-means over event-normalised style features">
        <Table head={['Archetype', { label: 'Teams', cls: 'num' }, 'Signature', 'Members']} wrap={false}>
          {s.archetypes.clusters.map((c) => (
            <tr key={c.label}>
              <td>
                <Badge tone="purple">{c.label}</Badge>
              </td>
              <td className="num">{c.size}</td>
              <td className="small dim">{c.signature.join(' · ')}</td>
              <td className="small">
                {c.members.slice(0, 6).map((m) => (
                  <span key={m} style={{ marginRight: 8 }}>
                    <TeamTag team={m} onClick={openTeam} />
                  </span>
                ))}
                {c.members.length > 6 && <span className="dim">+{c.members.length - 6}</span>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Data quality" subtitle="what this analysis could and could not use">
        <div className="grid g3">
          <div className="kv">
            <span className="k">Scored matches</span>
            <span className="v">{s.quality.scored}</span>
            <span className="k">Phase breakdown available</span>
            <span className="v">{s.quality.breakdownAvailable}</span>
            <span className="k">Missing scheduled times</span>
            <span className="v">{s.quality.missingSchedule}</span>
          </div>
          <div className="kv">
            <span className="k">Videos linked</span>
            <span className="v">{s.quality.videos}</span>
            <span className="k">Matches aligned to video</span>
            <span className="v">{s.quality.aligned}</span>
            <span className="k">Tagged score timelines</span>
            <span className="v">{s.quality.tagged}</span>
          </div>
          <div className="kv">
            <span className="k">Teams with scouting</span>
            <span className="v">{s.quality.scouting}</span>
            <span className="k">Calibration samples</span>
            <span className="v">{s.quality.calibrationN}</span>
            <span className="k">Awards recorded</span>
            <span className="v">{s.awards.length}</span>
          </div>
        </div>
        {s.quality.breakdownAvailable === 0 && (
          <div style={{ marginTop: 12 }}>
            <Note tone="warn">
              This archive has no autonomous / driver-control split. Phase attribution and the in-game win-probability curve stay
              unavailable until you either ingest the same event through RobotEvents with a token, or tag a score timeline against
              video footage in the Matches tab.
            </Note>
          </div>
        )}
      </Card>
    </div>
  )
}
