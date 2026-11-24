import React, { useEffect, useMemo, useRef, useState } from 'react'
import { endpoints, fmt, pct, useApi } from '../api.js'
import { useLookupHistory } from '../team/data.js'
import { Badge, Btn, Card, Empty, Note, Stat } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'

const CHECKS = [
  'Confirm autonomous routines and starting positions',
  'Agree who takes which scoring role',
  'Set toggle priorities before the match',
  'Agree defensive and midfield responsibilities',
  'Share opponent observations from scouting',
  'Confirm robot readiness and spare battery'
]

const time = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'scheduled time not published')

function TeamLine({ number, label, profile, loading, tone }) {
  return (
    <div className="brief-team">
      <div className="row">
        <strong className="mono" style={{ color: tone }}>{number}</strong>
        <span className="tiny dim">{label}</span>
      </div>
      {loading && !profile ? (
        <span className="tiny dim">loading public record…</span>
      ) : profile ? (
        <div className="tiny">
          {profile.matches ? `${profile.matches} matches · ${fmt(profile.avgScore)} avg alliance · ${pct(profile.winRate)} adjusted win rate` : 'no scored matches this season'}
          {profile.cv != null ? ` · CV ${fmt(profile.cv, 2)}` : ''}
        </div>
      ) : (
        <span className="tiny dim">no season record available</span>
      )}
    </div>
  )
}

export default function MatchBrief({ sku, team }) {
  const { data: matchData, error: matchError, loading } = useApi(sku ? endpoints.matches(sku) : null)
  const { records, load, loading: historyLoading } = useLookupHistory()
  const loaded = useRef(new Set())
  const [checked, setChecked] = useState(() => new Set())

  const matches = matchData?.matches || []

  const next = useMemo(() => {
    if (!team) return null
    const mine = matches.filter((m) => [m.red1, m.red2, m.red3, m.blue1, m.blue2, m.blue3].includes(team))
    const pending = mine.filter((m) => !m.scored).sort((a, b) => (a.matchnum || 0) - (b.matchnum || 0))
    if (pending.length) return { ...pending[0], upcoming: true }
    // Between matches: describe the most recently played one instead of inventing a next.
    const played = mine.filter((m) => m.scored).sort((a, b) => (b.matchnum || 0) - (a.matchnum || 0))
    return played.length ? { ...played[0], upcoming: false } : null
  }, [matches, team])

  const side = next ? ([next.red1, next.red2, next.red3].includes(team) ? 'red' : 'blue') : null
  const alliance = next ? (side === 'red' ? [next.red1, next.red2, next.red3] : [next.blue1, next.blue2, next.blue3]).filter(Boolean) : []
  const opponents = next ? (side === 'red' ? [next.blue1, next.blue2, next.blue3] : [next.red1, next.red2, next.red3]).filter(Boolean) : []
  const partner = alliance.find((t) => t !== team) || null

  useEffect(() => {
    const needed = [partner, ...opponents].filter(Boolean)
    for (const number of needed) {
      if (loaded.current.has(number)) continue
      loaded.current.add(number)
      load(number)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner, opponents.join(','), load])

  if (!sku) return <Empty>Choose a tournament to build a match briefing.</Empty>
  if (!team) return <Empty>Select or unlock a team to see its pre-match intelligence.</Empty>
  if (loading && !matches.length) return <div className="skeleton-block" aria-busy="true">Reading the schedule…</div>
  if (matchError) return <Note tone="bad">{matchError}</Note>
  if (!next) return <Empty>No scheduled match for {team} at this event.</Empty>

  const own = records[team]
  const partnerProfile = partner ? records[partner] : null

  return (
    <div>
      <Card
        title={next.upcoming ? `Match ${next.matchnum} briefing` : `Match ${next.matchnum} — most recent`}
        subtitle={`${next.upcoming ? 'Scheduled' : 'Published result'} · ${time(next.scheduled)}`}
        right={<Badge tone={side === 'red' ? 'bad' : ''}>{side} alliance</Badge>}
      >
        <div className="brief-grid">
          <div className="brief-side">
            <h4>Your alliance</h4>
            {alliance.map((t) => (
              <TeamLine key={t} number={t} label={t === team ? 'your team' : 'partner'} profile={records[t]} loading={historyLoading[t]} tone={side === 'red' ? 'var(--red)' : 'var(--blue)'} />
            ))}
          </div>
          <div className="brief-side">
            <h4>Opposing alliance</h4>
            {opponents.map((t) => (
              <TeamLine key={t} number={t} label="opponent" profile={records[t]} loading={historyLoading[t]} tone={side === 'red' ? 'var(--blue)' : 'var(--red)'} />
            ))}
          </div>
        </div>

        <div className="stat-row" style={{ marginTop: 10 }}>
          <Stat label="Your alliance average" value={own && partnerProfile && own.avgScore != null && partnerProfile.avgScore != null ? fmt(own.avgScore + partnerProfile.avgScore) : '—'} sub="sum of season averages, not a prediction" />
          <Stat label="Opponent average" value={opponents.every((t) => records[t]?.avgScore != null) && opponents.length >= 2 ? fmt(opponents.slice(0, 2).reduce((s, t) => s + records[t].avgScore, 0)) : '—'} sub="two strongest listed opponents" />
          <Stat label="Your sample" value={own?.matches ?? '—'} sub="scored matches behind the numbers" />
          <Stat label="Goal ownership" value="—" sub="needs scouting or testing evidence" />
        </div>
      </Card>

      <Card title="Evidence available" subtitle="what this briefing is and is not based on">
        <ul className="plain-list">
          <li><Badge tone="good">Official</Badge> Match number, alliance composition, scheduled time and published scores come from RobotEvents.</li>
          <li><Badge>Measured</Badge> Season averages and spreads are computed from published alliance scores — an alliance score is not one robot&apos;s score.</li>
          <li><Badge tone="warn">Scouting</Badge> Weaknesses, toggle habits and reliability only appear when your team recorded observations. This view does not invent them.</li>
          <li><Badge>Estimate</Badge> Win probabilities are produced by the shared model on the Simulation tab, with its sample size and assumptions shown there.</li>
        </ul>
        <div className="row wrap" style={{ gap: 6 }}>
          <Btn size="sm" onClick={() => navigate(`intelligence?tab=teams&opp=${opponents[0] || ''}`)}>
            <Icon name="clipboard" size={14} /> Scout {opponents[0] || 'opponent'}
          </Btn>
          <Btn size="sm" onClick={() => navigate(`intelligence?tab=strategy&opp=${opponents[0] || ''}`)}>
            <Icon name="users" size={14} /> Counters
          </Btn>
          <Btn size="sm" onClick={() => navigate(`simulation?tab=match&red=${alliance.join(',')}&blue=${opponents.join(',')}`)}>
            <Icon name="grid" size={14} /> Simulate this match
          </Btn>
        </div>
      </Card>

      <Card title="Pre-match coordination" subtitle="agree these with your partner before queueing">
        <ul className="check-items">
          {CHECKS.map((c) => (
            <li key={c}>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={checked.has(c)}
                  onChange={() =>
                    setChecked((prev) => {
                      const nextSet = new Set(prev)
                      if (nextSet.has(c)) nextSet.delete(c)
                      else nextSet.add(c)
                      return nextSet
                    })
                  }
                />
                <span className={checked.has(c) ? 'done' : ''}>{c}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="tiny dim">
          This checklist is for this visit. Match Day → Operations keeps the persistent readiness record, and its
          pre-match checklist can be reset for each new match.
        </p>
      </Card>
    </div>
  )
}
