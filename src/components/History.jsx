import React from 'react'
import { fmt, pct, dateTime } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, Note, Empty } from './ui.jsx'

const short = (v) => {
  const d = new Date(v || '')
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * A team's season before this event. Used wherever a future event would otherwise show
 * ratings and probabilities that do not exist yet: the roster is real, the numbers here are
 * real, but they come from tournaments that have already been played.
 */
export default function TeamHistory({ team, history, loading, error, onRetry, subtitle }) {
  if (loading && !history) return <Loading label={`Reading ${team}'s season…`} />
  if (error) return <ErrorBox error={error} onRetry={onRetry} />
  if (!history) return null

  const h = history
  return (
    <Card
      title={`${team} · season so far`}
      subtitle={subtitle || `${h.season || 'current season'} · built from tournaments already played`}
      right={h.stale ? <Badge tone="warn">cached</Badge> : null}
    >
      {!h.matches ? (
        <Empty>{h.notes?.[0] || `No scored matches for ${team} this season yet.`}</Empty>
      ) : (
        <>
          <div className="grid g4">
            <Stat label="Record" value={`${h.wins}–${h.losses}${h.ties ? `–${h.ties}` : ''}`} sub={`${h.matches} matches · ${pct(h.winRate)} win rate`} />
            <Stat label="Avg alliance score" value={fmt(h.avgScore)} sub={`floor ${fmt(h.floor)} · ceiling ${fmt(h.ceiling)}`} />
            <Stat label="Avg margin" value={h.avgMargin > 0 ? `+${fmt(h.avgMargin)}` : fmt(h.avgMargin)} sub={`opponents average ${fmt(h.avgOpp)}`} />
            <Stat label="Events played" value={h.events?.length ?? 0} sub={h.lastPlayed ? `last match ${short(h.lastPlayed)}` : '—'} />
          </div>

          {h.form?.length > 0 && (
            <div className="row" style={{ gap: 6, marginTop: 12 }}>
              <span className="tiny dim">last {h.form.length}</span>
              {h.form.map((g, i) => (
                <Badge key={i} tone={g.tied ? 'amber' : g.won ? 'green' : 'red'} title={g.eventName || ''}>
                  {g.tied ? 'T' : g.won ? 'W' : 'L'} {g.own}–{g.opp}
                </Badge>
              ))}
              <span className="spacer" />
              {h.cv != null && <span className="tiny dim">consistency CV {fmt(h.cv, 3)}</span>}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div className="tiny dim" style={{ marginBottom: 6, letterSpacing: '0.08em' }}>
              PREVIOUS TOURNAMENTS
            </div>
            <Table head={['Event', 'Date', 'Record', { label: 'Avg', cls: 'num' }, { label: 'Allowed', cls: 'num' }]} wrap={false} maxHeight={340}>
              {(h.events || []).map((e) => (
                <tr key={e.sku || e.name || e.start}>
                  <td>
                    {e.name || '—'}
                    {e.sku ? <div className="tiny dim mono">{e.sku}</div> : null}
                  </td>
                  <td className="small dim">{short(e.start)}</td>
                  <td className="small">
                    {e.wins}–{e.losses}
                    {e.ties ? `–${e.ties}` : ''}
                  </td>
                  <td className="num mono">{fmt(e.avgScore)}</td>
                  <td className="num mono dim">{fmt(e.avgOpp)}</td>
                </tr>
              ))}
            </Table>
          </div>

          <div style={{ marginTop: 10 }}>
            <Note>
              Aggregated from {h.matches} scored matches at {h.events?.length ?? 0} events
              {h.source?.fetchedAt ? ` · refreshed ${dateTime(h.source.fetchedAt)}` : ''}. Opponent strength is not modelled across
              events, so treat this as form rather than a rating.
            </Note>
          </div>
        </>
      )}
    </Card>
  )
}
