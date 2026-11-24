import React, { useMemo } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useTeamHistory, useTeamSeasonEvents } from '../team/data.js'
import { peekTeam } from '../team/store.js'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Stat, Table } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import { fmt } from '../api.js'

const d = (v) => {
  const x = new Date(v || '')
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const place = (t) => [t.city, t.region, t.country].filter(Boolean).join(', ')

const QUICK = [
  ['tournaments', 'trophy', 'Next tournament', 'Schedule and results'],
  ['scouting', 'clipboard', 'Scout a team', 'Record an observation'],
  ['alliance', 'users', 'Compare partners', 'Alliance fit and 2v2'],
  ['testing', 'wrench', 'Log a robot test', 'Trials and cycle time']
]

function activity(team) {
  if (!team) return []
  const out = []
  const testing = peekTeam(team, 'testing', { sessions: [] })
  for (const s of testing.sessions || []) {
    out.push({ when: s.date || s.createdAt, kind: 'Robot test', label: `${s.category || 'session'}${s.driver ? ` · ${s.driver}` : ''}`, to: 'testing' })
  }
  const scenarios = peekTeam(team, 'field-scenarios', { items: [] })
  for (const s of scenarios.items || []) {
    out.push({ when: s.savedAt, kind: 'Field scenario', label: s.name, to: 'field' })
  }
  const alliances = peekTeam(team, 'alliance-scenarios', { items: [] })
  for (const a of alliances.items || []) {
    out.push({ when: a.savedAt, kind: 'Alliance scenario', label: a.name, to: 'alliance' })
  }
  const scouting = peekTeam(team, 'scouting', { notes: [] })
  for (const s of scouting.notes || []) {
    out.push({ when: s.updatedAt, kind: 'Scouting note', label: `${s.opponent}${s.eventName ? ` · ${s.eventName}` : ''}`, to: 'scouting' })
  }
  return out.filter((x) => x.when).sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).slice(0, 5)
}

/** Evidence-first observations; each one names its sample and avoids claiming robot-level output. */
function insights(profile) {
  if (!profile || !profile.matches) return { strengths: [], improvements: [], trends: [], limits: [] }
  const strengths = []
  const improvements = []
  const trends = []
  const outright = profile.wins / profile.matches
  if (outright >= 0.5) {
    strengths.push(`${profile.wins} outright wins in ${profile.matches} completed matches (${Math.round(outright * 100)}%).`)
  }
  if (profile.ceiling != null && profile.avgScore != null && profile.ceiling > profile.avgScore * 1.3) {
    strengths.push(`The alliance has reached ${fmt(profile.ceiling)} points at the 90th percentile, well above its ${fmt(profile.avgScore)} average.`)
  }
  if (profile.avgMargin != null && profile.avgMargin < 0) {
    improvements.push(`Average margin is ${fmt(profile.avgMargin)} points across ${profile.matches} matches; the alliance is being out-scored more often than not.`)
  }
  if (profile.cv != null && profile.cv > 0.28) {
    improvements.push(`Match-to-match spread is high (CV ${fmt(profile.cv, 2)}): alliance scores have ranged from about ${fmt(profile.floor)} to ${fmt(profile.ceiling)}.`)
  }
  if (profile.avgMargin != null && profile.avgMargin >= 0) {
    strengths.push(`The alliance outscores opponents by ${fmt(profile.avgMargin)} points per match on average.`)
  }
  if (profile.form?.length >= 4) {
    const avg = (rows) => rows.reduce((s, r) => s + r.own, 0) / rows.length
    const recent = profile.form.slice(0, 3)
    const older = profile.form.slice(3)
    const diff = avg(recent) - avg(older)
    trends.push(`Last three alliances averaged ${fmt(avg(recent))} points; the earlier ${older.length} averaged ${fmt(avg(older))} (${diff >= 0 ? '+' : ''}${fmt(diff)}).`)
  }
  const limits = []
  limits.push(`Based on ${profile.matches} completed matches with published scores${profile.season ? ` in ${profile.season}` : ''}.`)
  if (profile.matches < 8) limits.push('Small sample: treat single-match swings and percentiles as noisy.')
  limits.push('Every scoring figure is an alliance total, not an individual robot’s output.')
  return { strengths, improvements, trends, limits }
}

function MatchChart({ form = [] }) {
  const rows = [...form].reverse()
  if (!rows.length) return null
  const max = Math.max(...rows.flatMap((g) => [g.own, g.opp]), 1)
  return (
    <div className="match-chart" role="img" aria-label="Alliance score compared with opponent score for recent matches">
      <div className="mc-legend">
        <span><i className="dot own" /> Alliance score</span>
        <span><i className="dot opp" /> Opponent</span>
        <span className="spacer" />
        <span className="tiny dim">oldest → newest</span>
      </div>
      <div className="mc-bars">
        {rows.map((g, i) => (
          <div className="mc-match" key={i} title={`${g.won ? 'Win' : g.tied ? 'Tie' : 'Loss'} ${g.own}–${g.opp}${g.eventName ? ` · ${g.eventName}` : ''}`}>
            <div className="mc-pair">
              <span className="mc-bar own" style={{ height: `${Math.max(6, (g.own / max) * 100)}%` }} />
              <span className="mc-bar opp" style={{ height: `${Math.max(6, (g.opp / max) * 100)}%` }} />
            </div>
            <span className={`mc-label ${g.won ? 'win' : g.tied ? 'tie' : 'loss'}`}>{g.won ? 'W' : g.tied ? 'T' : 'L'}</span>
            <span className="mc-score mono">{g.own}–{g.opp}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { active } = useTeam()
  const history = useTeamHistory(active?.number)
  const season = useTeamSeasonEvents(active?.number, { enabled: Boolean(active) })
  const profile = history.profile
  const recent = useMemo(() => activity(active?.number), [active?.number])
  const observed = useMemo(() => {
    if (!active) return { teams: 0, notes: 0 }
    const store = peekTeam(active.number, 'scouting', { notes: [] })
    return { teams: new Set((store.notes || []).map((n) => n.opponent)).size, notes: (store.notes || []).length }
  }, [active])

  if (!active) {
    return (
      <Empty>
        No team selected. <button type="button" className="link" onClick={() => navigate('welcome')}>Enter a team number</button> to personalise the tools.
      </Empty>
    )
  }

  const events = season.data
  const next = events?.upcoming?.[0] || null
  const latest = profile?.events?.[0] || events?.completed?.[0] || null
  const insightsAll = insights(profile)
  const adjusted = profile?.matches ? (profile.wins + 0.5 * profile.ties) / profile.matches : null

  return (
    <div className="dash">
      <section className="team-head">
        <div className="team-id">
          <span className="team-mark" aria-hidden="true">{active.number.slice(-1)}</span>
          <div>
            <h2>
              {active.number}
              {active.name ? <span className="dim"> · {active.name}</span> : null}
            </h2>
            <p className="muted small">
              {[active.org, place(active)].filter(Boolean).join(' · ') || 'Organisation not published'}
            </p>
          </div>
        </div>
        <div className="team-tags">
          <Badge>{active.seasonLabel}</Badge>
          {active.verified ? <Badge tone="good">official record</Badge> : <Badge tone="warn">number only</Badge>}
          {active.seasonStatus === 'none' && <Badge tone="warn">no events this season</Badge>}
        </div>
      </section>

      <div className="dash-top">
        <section className={`next-event ${next ? '' : 'is-empty'}`}>
          <div className="eyebrow">Next registered tournament</div>
          {next ? (
            <>
              <h3>{next.name}</h3>
              <div className="next-meta">
                <span>{d(next.start)}</span>
                <span>{[next.city, next.region].filter(Boolean).join(', ') || 'location not listed'}</span>
                {next.divisions?.length ? <span>{next.divisions.join(', ')}</span> : null}
                <Badge tone="warn">{next.status || 'upcoming'}</Badge>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <Btn size="sm" variant="primary" onClick={() => navigate('tournaments')}>Event details</Btn>
                <Btn size="sm" variant="ghost" onClick={() => navigate(`competition/${next.sku || ''}`)} disabled={!next.sku}>
                  Competition Day
                </Btn>
              </div>
            </>
          ) : (
            <>
              <h3>No upcoming tournament published</h3>
              <p className="small dim">
                {events?.notes?.[0] || 'When this team registers for an event it appears here with dates and results.'}
              </p>
              <Btn size="sm" variant="ghost" onClick={() => navigate('tournaments')}>Browse the season</Btn>
            </>
          )}
        </section>

        <section className="quick-strip" aria-label="Quick actions">
          {QUICK.map(([to, icon, label, sub]) => (
            <button key={to} type="button" className="quick-compact" onClick={() => navigate(to)}>
              <Icon name={icon} size={17} />
              <span>
                <strong>{label}</strong>
                <small>{sub}</small>
              </span>
            </button>
          ))}
        </section>
      </div>

      <section className="kpi-grid" aria-label="Season metrics">
        {history.loading && !profile ? (
          <div className="skeleton-block" aria-busy="true">Loading official season results…</div>
        ) : history.error ? (
          <ErrorBox error={history.error} onRetry={history.reload} />
        ) : profile && profile.matches > 0 ? (
          <>
            <Stat label="Record" value={`${profile.wins}–${profile.losses}–${profile.ties}`} sub={`${profile.matches} completed matches`} title="Wins–losses–ties across completed matches with published scores." />
            <Stat label="Adjusted win rate" value={adjusted == null ? '—' : `${Math.round(adjusted * 100)}%`} sub={`outright ${Math.round((profile.wins / profile.matches) * 100)}% · ties count half`} title="Adjusted win rate = (wins + half of ties) ÷ completed matches." />
            <Stat label="Avg alliance score" value={fmt(profile.avgScore)} sub={`10th–90th ${fmt(profile.floor)}–${fmt(profile.ceiling)}`} title="Average combined score of the team's alliance, not the individual robot." />
            <Stat label="Avg margin" value={`${profile.avgMargin > 0 ? '+' : ''}${fmt(profile.avgMargin)}`} sub={`opponents ${fmt(profile.avgOpp)}`} title="Alliance score minus opponent alliance score, averaged over completed matches." />
            <Stat label="Events played" value={profile.events?.length ?? 0} sub={latest?.name ? (latest.name.length > 26 ? latest.name.slice(0, 26) + '…' : latest.name) : 'no completed events'} />
            <Stat label="Best alliance score" value={fmt(profile.best)} sub={`${profile.form?.[0] ? 'recent form below' : 'season high'}`} />
          </>
        ) : (
          <div className="empty-inline">
            <strong>No scored matches yet this season.</strong>
            <p className="dim small">Statistics appear after the first official match is published. Field simulation, testing and scouting all work without results.</p>
          </div>
        )}
      </section>

      <div className="dash-grid">
        <Card
          title="Match performance"
          subtitle={profile?.matches ? `last ${profile.form?.length || 0} completed matches · alliance vs opponent` : 'no completed matches'}
        >
          {profile?.form?.length ? (
            <MatchChart form={profile.form} />
          ) : (
            <p className="dim small">A chart appears once this team has completed matches with published scores.</p>
          )}
        </Card>

        <Card title="Recent form" subtitle="newest first · hover for the score">
          {profile?.form?.length ? (
            <div className="form-list">
              {profile.form.map((g, i) => (
                <div className="form-row" key={i} title={`${g.own}–${g.opp}${g.eventName ? ` · ${g.eventName}` : ''}`}>
                  <span className={`form-badge ${g.won ? 'win' : g.tied ? 'tie' : 'loss'}`}>{g.won ? 'W' : g.tied ? 'T' : 'L'}</span>
                  <span className="form-score mono">{g.own}–{g.opp}</span>
                  <span className="tiny dim">{g.eventName || 'event not recorded'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="dim small">No match results yet.</p>
          )}
        </Card>

        <Card title="Performance insights" subtitle="evidence first, limitations stated">
          {!profile?.matches ? (
            <p className="dim small">Nothing to calculate yet. Insights are never invented to fill this space.</p>
          ) : (
            <div className="insight-groups">
              {insightsAll.strengths.length > 0 && (
                <div>
                  <div className="insight-label good">Strengths</div>
                  <ul>{insightsAll.strengths.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
              {insightsAll.improvements.length > 0 && (
                <div>
                  <div className="insight-label warn">Improvement opportunities</div>
                  <ul>{insightsAll.improvements.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
              {insightsAll.trends.length > 0 && (
                <div>
                  <div className="insight-label">Trend</div>
                  <ul>{insightsAll.trends.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
              <div>
                <div className="insight-label dim">Data used</div>
                <ul className="limits">{insightsAll.limits.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            </div>
          )}
          <button type="button" className="link tiny" onClick={() => navigate('tournaments')}>See the matches behind these numbers →</button>
        </Card>

        <Card title="Recent activity" subtitle="saved in this browser, for this team only">
          {!recent.length ? (
            <p className="dim small">
              Field scenarios, robot tests, alliance comparisons and scouting notes you save for {active.number} appear here.
              Nothing is shared between teams and nothing syncs to another device.
            </p>
          ) : (
            <ul className="activity-list">
              {recent.map((a, i) => (
                <li key={i}>
                  <span className="badge">{a.kind}</span>
                  <span>{a.label}</span>
                  <span className="spacer" />
                  <button type="button" className="link tiny" onClick={() => navigate(a.to)}>{d(a.when)}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="tiny dim" style={{ marginTop: 8 }}>
            Scouting coverage: {observed.teams} opponents · {observed.notes} observations
          </div>
        </Card>
      </div>
    </div>
  )
}
