import React from 'react'
import { endpoints, useApi, fmt, pct, sign } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, TeamTag, Note, Empty, KV } from '../components/ui.jsx'
import { Bars, Heat } from '../components/charts.jsx'

export default function MetaPage({ sku, navigate }) {
  const { data, loading, error, reload } = useApi(sku ? endpoints.meta(sku) : null)
  if (!sku) return <Empty>No event selected.</Empty>
  if (loading && !data) return <Loading label="Clustering the field…" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  const cal = data.calibration || {}
  const openTeam = (t) => navigate(`team/${sku}/${t}`)
  const openVs = (a, b) => navigate(`team/${sku}/${a}?vs=${encodeURIComponent(b)}`)

  return (
    <div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Teams" value={data.counts.teams} sub={`${data.counts.matches} scored matches`} />
        <Stat label="Brier (LOO)" value={cal.brier ?? '—'} sub={cal.baselineBrier != null ? `baseline ${cal.baselineBrier}` : ''} />
        <Stat label="Log loss" value={cal.logLoss ?? '—'} sub={`n=${cal.n ?? 0} · ${cal.method || ''}`} />
        <Stat label="Margin σ" value={fmt(data.matrix.sigma)} sub="used for every projection" />
      </div>

      <div className="split">
        <Card title="What actually predicts winning here" subtitle="team-level Pearson correlation with win rate">
          <Table head={['Relationship', { label: 'r', cls: 'num' }, { label: 'n', cls: 'num' }, 'Strength']} wrap={false}>
            {data.correlations.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td className="num" style={{ color: c.r > 0.3 ? 'var(--green)' : c.r < -0.3 ? 'var(--red)' : 'var(--muted)' }}>
                  {c.r}
                </td>
                <td className="num dim">{c.n}</td>
                <td className="tiny dim">{Math.abs(c.r) > 0.5 ? 'strong' : Math.abs(c.r) > 0.3 ? 'moderate' : 'weak / noise'}</td>
              </tr>
            ))}
          </Table>
          <div style={{ marginTop: 10 }}>
            <Note>
              These are correlations across teams at a single event. With n of this size, |r| under ~0.3 is indistinguishable from
              noise, and none of it is causal.
            </Note>
          </div>
        </Card>

        <Card title="Model calibration" subtitle="leave-one-out, refit per match">
          {cal.reliability?.length ? (
            <Table head={['Predicted', 'Observed', { label: 'n', cls: 'num' }]} wrap={false}>
              {cal.reliability.map((b, i) => (
                <tr key={i}>
                  <td className="mono">{pct(b.predicted)}</td>
                  <td className="mono">{pct(b.observed)}</td>
                  <td className="num dim">{b.n}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>Not enough completed matches to calibrate.</Empty>
          )}
          <div className="tiny dim" style={{ marginTop: 8 }}>
            A well-calibrated model has observed ≈ predicted in every row. If the top row is far apart, the model is overconfident
            in favourites and the win-probability numbers deserve a wider verbal hedge.
          </div>
        </Card>
      </div>

      <Card title="Archetypes" subtitle="k-means over event-normalised style features">
        <Table head={['Archetype', { label: 'Teams', cls: 'num' }, 'Signature', { label: 'Avg pts', cls: 'num' }, { label: 'Win rate', cls: 'num' }, { label: 'Avg Elo', cls: 'num' }, 'Members']} wrap={false}>
          {data.archetypePerformance.map((a) => (
            <tr key={a.label}>
              <td>
                <Badge tone="purple">{a.label}</Badge>
              </td>
              <td className="num">{a.size}</td>
              <td className="tiny dim">{data.clusters.find((c) => c.label === a.label)?.signature?.join(' · ')}</td>
              <td className="num">{fmt(a.avgPoints)}</td>
              <td className="num">{pct(a.winRate)}</td>
              <td className="num">{a.avgElo}</td>
              <td className="small">
                {a.members.slice(0, 5).map((m) => (
                  <span key={m} style={{ marginRight: 8 }}>
                    <TeamTag team={m} onClick={openTeam} />
                  </span>
                ))}
                {a.members.length > 5 && <span className="dim">+{a.members.length - 5}</span>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Matchup matrix" subtitle="P(row beats column) using the score model — click a cell for the full matchup">
        <Heat teams={data.matrix.teams} rows={data.matrix.rows} onCell={openVs} />
      </Card>

      {data.distributions && (
        <div className="grid g2">
          <Card title="Alliance scores">
            <Bars bins={data.distributions.allianceScores || []} color="var(--blue)" labelEvery={Math.max(1, Math.round((data.distributions.allianceScores || []).length / 8))} />
          </Card>
          <Card title="Margins">
            <Bars bins={data.distributions.margins || []} color="var(--purple)" labelEvery={Math.max(1, Math.round((data.distributions.margins || []).length / 8))} />
          </Card>
        </div>
      )}
    </div>
  )
}
