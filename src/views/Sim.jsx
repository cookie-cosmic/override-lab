import React, { useMemo, useState } from 'react'
import { endpoints, useApi, fmt, pct } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, TeamTag, Note, Empty, Btn, Field } from '../components/ui.jsx'

const TIERS = [
  { id: 'threat', label: 'threat', tone: 'red', blurb: 'under 30% to win' },
  { id: 'tough', label: 'tough', tone: 'amber', blurb: '30–42%' },
  { id: 'even', label: 'even', tone: '', blurb: '42–58%' },
  { id: 'favorable', label: 'favorable', tone: 'green', blurb: '58–70%' },
  { id: 'easy', label: 'easy', tone: 'green', blurb: 'over 70%' }
]
const TONE = Object.fromEntries(TIERS.map((t) => [t.id, t.tone]))
const SORTS = [
  { id: 'hardest', label: 'hardest first' },
  { id: 'easiest', label: 'easiest first' },
  { id: 'scoring', label: 'highest scoring first' },
  { id: 'name', label: 'team number' }
]

const scoreOf = (row) => (row.projected ? `${row.projected.a}–${row.projected.b}` : '—')
const planOf = (row) => (row.plan?.top?.length ? row.plan.top[0].title : row.plan ? 'no rule fires' : '—')
const h2hOf = (row) => (row.h2h?.played ? `${row.h2h.wins}–${row.h2h.losses}` : '—')
const recordOf = (row) => {
  const r = row.record || {}
  const base = `${r.wins ?? 0}–${r.losses ?? 0}`
  return r.ties ? `${base}–${r.ties}` : base
}
const severityTone = (s) => (s === 'high' ? 'red' : s === 'medium' ? 'amber' : '')

function WeaknessChips({ row, max = 2 }) {
  const list = row.weaknesses || []
  if (!list.length) return <span className="tiny dim">no clear hole</span>
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {list.slice(0, max).map((w) => (
        <Badge key={w.id} tone={severityTone(w.severity)}>
          {w.label}
        </Badge>
      ))}
      {list.length > max && <span className="tiny dim">+{list.length - max}</span>}
    </span>
  )
}

/**
 * Simulation tab.
 *
 * One team, every opponent at the event: the onsite matchup model run across the whole field so
 * the question "who is actually a problem, and who is a free win" gets a ranked answer with the
 * numbers behind it, rather than a coach's memory of one bad match.
 *
 * It runs before the event does. With no results to rate, the server describes each team by its
 * current season instead and says so in `mode`; the tables are identical either way.
 */
export default function Sim({ sku, team, navigate }) {
  const { data: summary } = useApi(sku ? endpoints.summary(sku) : null)
  const { data, loading, error, reload } = useApi(sku && team ? endpoints.sim(sku, team) : null)
  const [pick, setPick] = useState('')
  const [sort, setSort] = useState('hardest')

  const teams = useMemo(
    () => (summary?.roster ? summary.roster.map((r) => r.team) : (summary?.archetypes?.teams || []).map((t) => t.team)).sort(),
    [summary]
  )

  if (!sku) return <Empty>No event selected.</Empty>

  const run = (value) => {
    const next = String(value || pick || '').trim().toUpperCase()
    if (next) navigate(`sim/${sku}/${encodeURIComponent(next)}`)
  }

  const conceptual = data?.mode === 'conceptual'

  const picker = (
    <Card
      title="Simulation"
      subtitle={
        conceptual
          ? 'one team against every team at this event — built from each team’s season until the event produces matches'
          : 'one team against every team at this event — who to prepare for, and who should be a comfortable win'
      }
      right={
        <div className="row" style={{ gap: 6 }}>
          <select value={team || ''} onChange={(e) => run(e.target.value)} style={{ width: 170 }}>
            <option value="">— pick a team —</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Btn size="sm" onClick={() => run()} disabled={!pick.trim() && !team}>
            Run
          </Btn>
        </div>
      }
    >
      <Field label="Your team" hint="registered at this event; type it and press Enter">
        <input
          className="input mono"
          list="sim-teams"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="321A"
          style={{ maxWidth: 220 }}
        />
        <datalist id="sim-teams">
          {teams.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <span className="tiny dim">
        {teams.length ? `${teams.length} teams at this event` : 'this event has no roster yet'} · every opponent is simulated 2,000 times
        with a median ally on both sides
      </span>
    </Card>
  )

  if (!team) {
    return (
      <div>
        {picker}
        <Note>
          Enter a team number to run the field: the tab ranks every opponent, shows the projected score, lists the counters that fire
          against each of them and names the weakness each counter exploits.
        </Note>
      </div>
    )
  }

  if (loading && !data) return <Loading label={`Simulating ${team} against every team…`} />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  if (data.rosterOnly) {
    return (
      <div>
        {picker}
        <Card title="Nothing to simulate yet" subtitle={`${team} is on the roster`}>
          <Note tone="warn">{data.notes?.[0]}</Note>
          {data.needsHistory && (
            <div className="small dim" style={{ marginTop: 10 }}>
              Add a RobotEvents key from the sidebar (the ⌘ button at the bottom) and every team’s previous tournaments become
              readable — the simulation then runs from those results, no matches at this event required.
            </div>
          )}
          {data.roster?.length > 0 && (
            <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
              {data.roster.slice(0, 12).map((r) => (
                <Btn key={r.team} size="sm" onClick={() => navigate(`sim/${sku}/${encodeURIComponent(r.team)}`)}>
                  {r.team}
                </Btn>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <Btn size="sm" onClick={() => navigate(`team/${sku}/${encodeURIComponent(team)}`)}>
              Open the team lab
            </Btn>
            <Btn size="sm" onClick={() => navigate(`onsite/${sku}/${encodeURIComponent(team)}`)}>
              Open onsite
            </Btn>
          </div>
        </Card>
      </div>
    )
  }

  const rows = [...(data.opponents || [])]
  if (sort === 'easiest') rows.sort((a, b) => b.p - a.p)
  else if (sort === 'scoring') rows.sort((a, b) => (b.avgPoints ?? 0) - (a.avgPoints ?? 0))
  else if (sort === 'name') rows.sort((a, b) => a.team.localeCompare(b.team, undefined, { numeric: true }))

  const open = (other) => navigate(`team/${sku}/${encodeURIComponent(other)}?vs=${encodeURIComponent(team)}`)
  const t = data.team
  const form = (t.season?.form || []).filter((g) => g.won != null)
  const formString = form.length ? form.map((g) => (g.won ? 'W' : g.tied ? 'T' : 'L')).join('') : '—'

  return (
    <div>
      {picker}

      {conceptual && (
        <Note tone="warn">
          <strong>Conceptual simulation — this event has not produced results yet.</strong> {data.basis}. Each opponent is described by
          its season to date: record, average, floor, ceiling and recent form. Nothing below is a match played at {data.event?.name}.
        </Note>
      )}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat
          label="Your team"
          value={t.team}
          sub={`${recordOf(t)}${t.season ? ` · ${t.season.events} event${t.season.events === 1 ? '' : 's'} this season` : ''}${
            t.rank ? ` · seed ${t.rank}` : ''
          }`}
        />
        {conceptual ? (
          <Stat
            label="Recent form"
            value={formString}
            sub={t.season ? `${t.season.avgMargin > 0 ? '+' : ''}${fmt(t.season.avgMargin)} average margin` : 'no season on record'}
          />
        ) : (
          <Stat label="Elo" value={fmt(t.elo, 0)} sub={t.archetype || 'archetype n/a'} />
        )}
        <Stat
          label={conceptual ? 'Average alliance points' : 'Average points'}
          value={fmt(t.avgPoints)}
          sub={`floor ${fmt(t.floor)} · ceiling ${fmt(t.ceiling)}`}
        />
        <Stat
          label="Win rate vs the field"
          value={pct(data.edge?.meanP)}
          sub={`≈${fmt(data.edge?.expectedWins, 1)} wins if you played all ${data.counts.opponents}`}
        />
      </div>

      <Card
        title="Field breakdown"
        subtitle={`${data.counts.opponents} opponents simulated · ${data.model.simulations.toLocaleString()} runs each · ${
          conceptual ? 'season basis' : 'event basis'
        }`}
      >
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {TIERS.map((tier) => (
            <span key={tier.id} className="row" style={{ gap: 6 }}>
              <Badge tone={tier.tone}>{tier.label}</Badge>
              <span className="mono">{data.counts[tier.id]}</span>
              <span className="tiny dim">{tier.blurb}</span>
            </span>
          ))}
        </div>
        <div className="tiny dim" style={{ marginTop: 10 }}>
          Hardest: <span className="mono">{data.edge?.hardest || '—'}</span> · most comfortable:{' '}
          <span className="mono">{data.edge?.easiest || '—'}</span> · model σ {data.model.sigmaMargin} · example ally{' '}
          {fmt(data.model.partnerMu)} pts
        </div>
      </Card>

      {data.watchlist.length > 0 && (
        <Card
          title="Where to hurt them"
          subtitle="the weaknesses that fired against the teams you have to beat — each one is an attack, not a scouting note"
          right={<Badge tone="red">{data.watchlist.length} study list</Badge>}
        >
          <div className="grid g2">
            {data.watchlist.slice(0, 6).map((o) => (
              <div key={o.team} className="weak-card">
                <div className="row" style={{ gap: 8 }}>
                  <TeamTag team={o.team} onClick={() => open(o.team)} />
                  <span className="tiny dim">{o.name || ''}</span>
                  <span className="spacer" />
                  <Badge tone={TONE[o.tier]}>{o.tier}</Badge>
                  <span className="mono small">{pct(o.p)}</span>
                </div>
                <div className="tiny dim" style={{ marginTop: 4 }}>
                  {recordOf(o)} record · projected {scoreOf(o)} · {o.archetype || (o.source === 'season' ? 'season basis' : 'no archetype')}
                </div>
                {o.weaknesses?.length ? (
                  <ul className="weak-list">
                    {o.weaknesses.slice(0, 4).map((w) => (
                      <li key={w.id}>
                        <strong>{w.label}</strong> — {w.detail}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="tiny dim" style={{ marginTop: 6 }}>
                    No metric crosses a weakness threshold — treat them as an even, well-rounded team.
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.softSpots?.length > 0 && (
        <Card title="Soft spots across the field" subtitle="weaknesses that turn up on more than one opponent">
          {data.softSpots.map((s) => (
            <div key={s.id} className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <Badge tone="amber">{s.count}</Badge>
              <span className="small">{s.label}</span>
              <span className="tiny dim mono">{s.teams.join(' · ')}</span>
            </div>
          ))}
        </Card>
      )}

      <Card
        title="Teams to prepare for"
        subtitle="under 58% to win — this is the study list, hardest first"
        right={<Badge tone="red">{data.watchlist.length} teams</Badge>}
      >
        {!data.watchlist.length ? (
          <Empty>Nobody on this roster projects below 58% — the field is yours unless it plays above itself.</Empty>
        ) : (
          <Table
            head={['Team', 'P(win)', 'Record', 'Projected', 'Their ceiling', 'Elo', 'Weakness', 'Best counter', 'H2H']}
            wrap={false}
            maxHeight={360}
          >
            {data.watchlist.map((o) => (
              <tr key={o.team} className="clickable" style={{ cursor: 'pointer' }} onClick={() => open(o.team)}>
                <td>
                  <TeamTag team={o.team} />
                  <div className="tiny dim">
                    <Badge tone={TONE[o.tier]}>{o.tier}</Badge> {o.archetype || ''}
                  </div>
                </td>
                <td className="num" style={{ color: o.p < 0.42 ? 'var(--red)' : 'var(--amber)' }}>
                  {pct(o.p)}
                </td>
                <td className="num dim">{recordOf(o)}</td>
                <td className="num">{scoreOf(o)}</td>
                <td className="num">{fmt(o.ceiling)}</td>
                <td className="num dim">{o.elo ?? '—'}</td>
                <td>
                  <WeaknessChips row={o} />
                </td>
                <td className="small">{planOf(o)}</td>
                <td className="num dim">{h2hOf(o)}</td>
              </tr>
            ))}
          </Table>
        )}
        <span className="tiny dim">Click a row to open that matchup in the team lab, with the full counter sheet.</span>
      </Card>

      <Card title="Comfortable matchups" subtitle="over 58% to win — the teams to want in your bracket" right={<Badge tone="green">{data.gifts.length} teams</Badge>}>
        {!data.gifts.length ? (
          <Empty>No opponent projects above 58%: this is an even field.</Empty>
        ) : (
          <Table
            head={['Team', 'P(win)', 'Record', 'Projected', 'Their average', 'Their floor', 'Weakness', 'Best counter', 'H2H']}
            wrap={false}
            maxHeight={360}
          >
            {data.gifts.map((o) => (
              <tr key={o.team} className="clickable" style={{ cursor: 'pointer' }} onClick={() => open(o.team)}>
                <td>
                  <TeamTag team={o.team} />
                  <div className="tiny dim">
                    <Badge tone={TONE[o.tier]}>{o.tier}</Badge> {o.archetype || ''}
                  </div>
                </td>
                <td className="num" style={{ color: 'var(--green)' }}>
                  {pct(o.p)}
                </td>
                <td className="num dim">{recordOf(o)}</td>
                <td className="num">{scoreOf(o)}</td>
                <td className="num">{fmt(o.avgPoints)}</td>
                <td className="num dim">{fmt(o.floor)}</td>
                <td>
                  <WeaknessChips row={o} />
                </td>
                <td className="small">{planOf(o)}</td>
                <td className="num dim">{h2hOf(o)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Every team, tested"
        subtitle="win probability, record, projected score, margin and the hole to aim at for each opponent"
        right={
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 190 }}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        }
      >
        <Table
          head={[
            'Team',
            'Tier',
            { label: 'P(win)', cls: 'num' },
            { label: 'Record', cls: 'num' },
            { label: 'Projected', cls: 'num' },
            { label: 'Margin', cls: 'num' },
            { label: 'With plan', cls: 'num' },
            { label: 'Elo', cls: 'num' },
            { label: 'Avg', cls: 'num' },
            { label: 'Floor', cls: 'num' },
            { label: 'Ceiling', cls: 'num' },
            { label: 'Matches', cls: 'num' },
            'Weakness',
            'H2H'
          ]}
          wrap={false}
          maxHeight={520}
        >
          {rows.map((o) => (
            <tr key={o.team} className="clickable" style={{ cursor: 'pointer' }} onClick={() => open(o.team)}>
              <td>
                <TeamTag team={o.team} />
                {o.name ? <div className="tiny dim">{o.name}</div> : null}
              </td>
              <td>
                <Badge tone={TONE[o.tier]}>{o.tier}</Badge>
              </td>
              <td className="num">{pct(o.p)}</td>
              <td className="num dim">{recordOf(o)}</td>
              <td className="num">{scoreOf(o)}</td>
              <td className="num" style={{ color: o.margin > 0 ? 'var(--green)' : 'var(--red)' }}>
                {o.margin > 0 ? '+' : ''}
                {fmt(o.margin)}
              </td>
              <td className="num dim">{o.plan ? `${pct(o.plan.winProbWithPlan)} (${(o.plan.deltaP * 100).toFixed(1)}pp)` : '—'}</td>
              <td className="num">{o.elo ?? '—'}</td>
              <td className="num">{fmt(o.avgPoints)}</td>
              <td className="num dim">{fmt(o.floor)}</td>
              <td className="num dim">{fmt(o.ceiling)}</td>
              <td className="num dim">{o.matches}</td>
              <td>
                <WeaknessChips row={o} max={1} />
              </td>
              <td className="num">{h2hOf(o)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="How this was computed" subtitle="assumptions you can argue with">
        {data.notes.map((n) => (
          <div key={n} className="small dim" style={{ marginBottom: 6 }}>
            {n}
          </div>
        ))}
        {data.model.calibration?.brier != null && (
          <div className="tiny dim">
            Model calibration on this event: Brier {data.model.calibration.brier} vs {data.model.calibration.baselineBrier} baseline over{' '}
            {data.model.calibration.n} matches.
          </div>
        )}
      </Card>
    </div>
  )
}
