import React from 'react'
import { endpoints, fmt, pct, useApi } from '../api.js'
import { Badge, Btn, Card, Empty, Stat, Table } from '../components/ui.jsx'
import { navigate } from '../router.js'

/**
 * Public team statistics. Official results and descriptive statistics only: no counters, no
 * predictions, no private workspace data. The restricted tools are refused by the server, not
 * merely hidden here.
 */
export default function PublicTeam({ team }) {
  const { data, error, loading } = useApi(team ? endpoints.history(team) : null)

  if (!team) return <Empty>Enter a team number to see its public record.</Empty>
  if (loading) return <div className="skeleton-block" aria-busy="true">Reading {team}&apos;s public record…</div>
  if (error) {
    return (
      <Card title={`${team} · public statistics`}>
        <p className="small bad">{error}</p>
        <p className="tiny dim">
          Public statistics come from RobotEvents and need the server&apos;s data connection. A team that has not played
          this season has an empty record, which is different from an unknown team.
        </p>
        <Btn size="sm" variant="ghost" onClick={() => navigate('home')}>Back to search</Btn>
      </Card>
    )
  }

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">Public statistics</div>
          <h2 className="mono">{team}</h2>
          <p className="small dim">{data.season || '2026–27 Override'} · official RobotEvents results</p>
        </div>
        <Badge>public</Badge>
      </header>

      <div className="stat-grid">
        <Stat label="Record" value={`${data.wins ?? 0}–${data.losses ?? 0}–${data.ties ?? 0}`} sub={`${data.matches ?? 0} scored matches`} />
        <Stat label="Adjusted win rate" value={data.winRate != null ? pct(data.winRate) : '—'} sub="ties count half" />
        <Stat label="Average alliance score" value={fmt(data.avgScore)} sub="alliance score, not one robot" />
        <Stat label="Average margin" value={fmt(data.avgMargin)} sub={`opponents ${fmt(data.avgOpp)}`} />
      </div>

      <Note>
        These are descriptive statistics computed from published match results. They are not predictions, ratings or
        recommendations. Ties are counted as half a win so the rate matches the published record.
      </Note>

      <Card title="Tournaments played" flush>
        <Table head={['Event', 'Date', 'Matches', 'Record', 'Avg alliance']}>
          {(data.events || []).map((e) => (
            <tr key={`${e.sku}-${e.division}-${e.start}`}>
              <td>{e.name || e.sku}</td>
              <td className="tiny dim">{e.start ? new Date(e.start).toLocaleDateString() : '—'}</td>
              <td>{e.matches}</td>
              <td>{e.wins}–{e.losses}–{e.ties}</td>
              <td>{fmt(e.avgScore)}</td>
            </tr>
          ))}
        </Table>
        {!(data.events || []).length && <Empty>No scored tournaments this season yet.</Empty>}
      </Card>

      <Card title="Recent form" subtitle="most recent scored matches">
        <div className="form-row">
          {(data.form || []).map((g, i) => (
            <div className={`form-cell ${g.won ? 'win' : g.tied ? 'tie' : 'loss'}`} key={i} title={`${g.own}–${g.opp} · ${g.eventName || ''}`}>
              <strong>{g.won ? 'W' : g.tied ? 'T' : 'L'}</strong>
              <span>{g.own}–{g.opp}</span>
            </div>
          ))}
          {!(data.form || []).length && <span className="dim small">No matches yet.</span>}
        </div>
      </Card>

      <Card title="Want the strategy tools?">
        <p className="small">
          Opponent counters, match intelligence, alliance strategy and simulation are available to approved team
          workspaces. Ask your chapter coordinator or the platform owner to enable your team.
        </p>
        <Btn size="sm" variant="ghost" onClick={() => navigate('home')}>Back to Override Lab</Btn>
      </Card>
    </div>
  )
}
