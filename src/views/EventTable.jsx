import React, { useMemo, useState } from 'react'
import { endpoints, useApi, fmt, sign } from '../api.js'
import { Card, Empty, ErrorBox, Loading, Table, TeamTag, Note } from '../components/ui.jsx'

/**
 * Rankings, Skills and Eliminations read the same tournament summary as Overview but present
 * one table each, so the information stays reachable as a tab instead of its own page.
 */
export default function EventTable({ sku, mode, navigate }) {
  const { data, loading, error, reload } = useApi(sku ? endpoints.summary(sku) : null)
  const [dir, setDir] = useState('asc')

  const rows = useMemo(() => {
    if (!data) return []
    if (mode === 'rankings') {
      const list = [...(data.leaderboards?.power || [])]
      list.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
      if (dir === 'desc') list.reverse()
      return list
    }
    if (mode === 'skills') {
      const list = [...(data.leaderboards?.skills || [])]
      list.sort((a, b) => b.value - a.value)
      return list
    }
    return []
  }, [data, mode, dir])

  if (!sku) return <Empty>No tournament selected.</Empty>
  if (loading && !data) return <Loading label="Reading the official tables…" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  if (mode === 'eliminations') {
    const rounds = data.bracket?.rounds || []
    return (
      <Card title="Elimination bracket" subtitle={data.bracket?.champion ? `Champion: ${data.bracket.champion.join(' + ')}` : 'no elimination data published'}>
        {!rounds.length ? (
          <Empty>No elimination rounds are published for this event yet.</Empty>
        ) : (
          <div className="bracket-scroll">
            {rounds.map((r) => (
              <div className="bracket-round" key={r.round}>
                <div className="bracket-title">{r.label}</div>
                {r.matches.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className="bracket-match"
                    onClick={() => navigate(`matches/${sku}?m=${encodeURIComponent(m.key)}`)}
                  >
                    <span className={m.winner === 'red' ? 'winner red' : ''}>{m.red.join(' + ')}</span>
                    <strong className="mono">{m.redScore}–{m.blueScore}</strong>
                    <span className={m.winner === 'blue' ? 'winner blue' : ''}>{m.blue.join(' + ')}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }

  if (mode === 'skills') {
    return (
      <Card title="Skills standings" subtitle={`${rows.length} teams with a recorded skills run`}>
        {!rows.length ? (
          <Empty>No skills scores are published for this event.</Empty>
        ) : (
          <Table head={['#', 'Team', { label: 'Combined', cls: 'num' }, { label: 'Driver', cls: 'num' }, { label: 'Programming', cls: 'num' }]}>
            {rows.map((t, i) => (
              <tr key={t.team}>
                <td className="num">{i + 1}</td>
                <td><TeamTag team={t.team} onClick={() => navigate(`team/${sku}/${t.team}`)} /></td>
                <td className="num">{fmt(t.value)}</td>
                <td className="num">{fmt(t.driver)}</td>
                <td className="num">{fmt(t.prog)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    )
  }

  return (
    <Card
      title="Rankings"
      subtitle="Official rank where published; Elo and OPR are model estimates"
      right={
        <button type="button" className="btn ghost sm" onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
          Rank {dir === 'asc' ? '↑' : '↓'}
        </button>
      }
    >
      {!rows.length ? (
        <Empty>No ranking data is published for this event.</Empty>
      ) : (
        <Table head={['Rank', 'Team', { label: 'Elo', cls: 'num' }, { label: '80% band', cls: 'num' }, { label: 'OPR', cls: 'num' }, { label: 'Avg score', cls: 'num' }, { label: 'WAE', cls: 'num' }]}>
          {rows.map((t) => (
            <tr key={t.team}>
              <td className="mono">{t.rank ?? '—'}</td>
              <td><TeamTag team={t.team} onClick={() => navigate(`team/${sku}/${t.team}`)} /></td>
              <td className="num">{t.elo}</td>
              <td className="num dim">{t.band ? `${t.band[0]}–${t.band[1]}` : '—'}</td>
              <td className="num">{fmt(t.opr)}</td>
              <td className="num">{fmt(t.avgPoints)}</td>
              <td className="num">{sign(t.winsAboveExpectation, 1)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note>
        Elo, OPR and wins above expectation come from recorded match scores at this event. They are estimates, not
        official rankings; the Rank column is the official seed when the event publishes one.
      </Note>
    </Card>
  )
}
