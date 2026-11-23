import React, { useMemo } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useTeamHistory, useTeamSeasonEvents } from '../team/data.js'
import { peekTeam } from '../team/store.js'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Stat, Table } from '../components/ui.jsx'
import { navigate } from '../router.js'
import { fmt } from '../api.js'

const d = (v) => {
  const x = new Date(v || '')
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const place = (t) => [t.city, t.region, t.country].filter(Boolean).join(', ')

const ACTIONS = [
  ['tournaments', '⌖', 'Analyze a tournament', 'Open the active team’s season schedule'],
  ['scouting', '◎', 'Scout opponents', 'Record what you see, per event'],
  ['alliance', '⇄', 'Compare alliances', 'Compatibility and 2v2 estimates'],
  ['field', '▩', 'Open field simulator', 'Score an Override field end state'],
  ['autonomous', '⟜', 'Plan autonomous', 'Waypoints, actions and the 15s clock'],
  ['testing', '◍', 'Log a robot test', 'Trials, cycle time and reliability'],
  ['rules', '¶', 'Search rules', 'Scoring definitions and official sources']
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
  const routines = peekTeam(team, 'routines', { items: [] })
  for (const r of routines.items || []) {
    out.push({ when: r.savedAt, kind: 'Autonomous routine', label: r.name, to: 'autonomous' })
  }
  const alliances = peekTeam(team, 'alliance-scenarios', { items: [] })
  for (const a of alliances.items || []) {
    out.push({ when: a.savedAt, kind: 'Alliance scenario', label: a.name, to: 'alliance' })
  }
  const scouting = peekTeam(team, 'scouting', { notes: [] })
  for (const s of scouting.notes || []) {
    out.push({ when: s.updatedAt, kind: 'Scouting note', label: `${s.opponent}${s.eventName ? ` · ${s.eventName}` : ''}`, to: 'scouting' })
  }
  return out.filter((x) => x.when).sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).slice(0, 6)
}

/** One calculated observation, only when the sample supports it. */
function insights(profile) {
  if (!profile || !profile.matches) return []
  const out = []
  if (profile.matches >= 4 && profile.avgMargin != null) {
    out.push({
      tone: profile.avgMargin >= 0 ? 'good' : 'warn',
      text: `${profile.team} averages ${fmt(profile.avgScore)} points per scored match, a margin of ${fmt(profile.avgMargin)} over ${profile.matches} matches.`
    })
  }
  if (profile.cv != null && profile.matches >= 5) {
    out.push({
      tone: profile.cv > 0.28 ? 'warn' : 'good',
      text:
        profile.cv > 0.28
          ? `Match-to-match spread is high (CV ${fmt(profile.cv, 2)}): the same robot has produced both ${fmt(profile.floor)} and ${fmt(profile.ceiling)}. Treat single-match numbers with care.`
          : `Scores are consistent for this sample (CV ${fmt(profile.cv, 2)}, 10th–90th percentile ${fmt(profile.floor)}–${fmt(profile.ceiling)}).`
    })
  }
  if (profile.form?.length >= 4) {
    const recent = profile.form.slice(0, 3)
    const older = profile.form.slice(3)
    const avg = (rows) => rows.reduce((s, r) => s + r.own, 0) / rows.length
    const diff = avg(recent) - avg(older)
    out.push({
      tone: diff >= 0 ? 'good' : 'warn',
      text: `Last three matches average ${fmt(avg(recent))}; the matches before them average ${fmt(avg(older))} (${diff >= 0 ? '+' : ''}${fmt(diff)}).`
    })
  }
  return out
}

export default function Dashboard() {
  const { active } = useTeam()
  const history = useTeamHistory(active?.number)
  const season = useTeamSeasonEvents(active?.number)
  const profile = history.profile
  const recent = useMemo(() => activity(active?.number), [active?.number])

  if (!active) {
    return (
      <Empty>
        No team selected. <button className="link" onClick={() => navigate('welcome')}>Enter a team number</button> to personalise
        the tools.
      </Empty>
    )
  }

  const events = season.data
  const next = events?.upcoming?.[0] || null
  const latest = profile?.events?.[0] || events?.completed?.[0] || null

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">Welcome to Override Lab</div>
          <h2 className="dash-title">
            Team {active.number} {active.name ? <span className="dim">· {active.name}</span> : null}
          </h2>
          <p className="muted">Your tournament performance, strategies, and scouting intelligence in one place.</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {active.verified ? <Badge tone="good">official record</Badge> : <Badge tone="warn">number only · not verified</Badge>}
            <Badge>{active.seasonLabel}</Badge>
            {active.seasonStatus === 'none' && <Badge tone="warn">no events this season</Badge>}
            {active.program && <Badge>{active.program}</Badge>}
          </div>
        </div>
        <div className="dash-identity">
          <div>
            <span className="tiny dim">Organization</span>
            <div>{active.org || 'not listed'}</div>
          </div>
          <div>
            <span className="tiny dim">Location</span>
            <div>{place(active) || 'not listed'}</div>
          </div>
          <div>
            <span className="tiny dim">Latest official activity</span>
            <div>{latest ? `${latest.name} · ${d(latest.start)}` : 'none recorded'}</div>
          </div>
          <div>
            <span className="tiny dim">Next registered event</span>
            <div>{next ? `${next.name} · ${d(next.start)}` : 'none published'}</div>
          </div>
        </div>
      </section>

      <div className="quick-grid">
        {ACTIONS.map(([to, icon, title, sub]) => (
          <button key={to} type="button" className="quick" onClick={() => navigate(to)}>
            <span className="quick-icon" aria-hidden="true">{icon}</span>
            <span>
              <strong>{title}</strong>
              <span className="tiny dim">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="dash-grid">
        <Card title="Season at a glance" subtitle={profile?.season || active.seasonLabel}>
          {history.loading && <Loading label="Reading this season’s recorded matches…" />}
          {history.error && <ErrorBox error={history.error} onRetry={history.reload} />}
          {profile && !profile.matches && (
            <div className="empty-inline">
              <strong>No scored matches yet this season.</strong>
              <p className="dim small">
                Statistics appear after the first official match is published. Until then the field simulator, autonomous
                planner and testing log all work without results.
              </p>
            </div>
          )}
          {profile && profile.matches > 0 && (
            <>
              <div className="stat-row">
                <Stat label="Record" value={`${profile.wins}–${profile.losses}–${profile.ties}`} sub={`${profile.matches} scored matches`} />
                <Stat label="Avg alliance score" value={fmt(profile.avgScore)} sub={`10th–90th ${fmt(profile.floor)}–${fmt(profile.ceiling)}`} />
                <Stat label="Avg margin" value={`${profile.avgMargin > 0 ? '+' : ''}${fmt(profile.avgMargin)}`} sub={`opponents ${fmt(profile.avgOpp)}`} />
                <Stat label="Win rate" value={`${Math.round((profile.winRate || 0) * 100)}%`} sub="ties count half" />
              </div>
              <div className="form-strip">
                <span className="tiny dim">Recent form</span>
                {profile.form?.map((g, i) => (
                  <span key={i} className={`form-pill ${g.tied ? 'tie' : g.won ? 'win' : 'loss'}`} title={`${g.own}–${g.opp} ${g.eventName || ''}`}>
                    {g.won ? 'W' : g.tied ? 'T' : 'L'} {g.own}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="Performance insights" subtitle="calculated only from recorded matches">
          {!profile || !profile.matches ? (
            <p className="dim small">Nothing to calculate yet. Insights are never invented to fill this space.</p>
          ) : (
            <ul className="insight-list">
              {insights(profile).map((x, i) => (
                <li key={i} className={x.tone}>
                  <span aria-hidden="true">{x.tone === 'good' ? '▲' : '▼'}</span>
                  <span>{x.text}</span>
                </li>
              ))}
            </ul>
          )}
          {profile?.notes?.length ? <p className="tiny dim">{profile.notes[0]}</p> : null}
        </Card>

        <Card title="Events" subtitle="this season, for the active team" right={<Btn size="sm" variant="ghost" onClick={() => navigate('tournaments')}>All tournaments</Btn>}>
          {season.loading && <Loading label="Reading the team schedule…" />}
          {season.error && <ErrorBox error={season.error} onRetry={season.reload} />}
          {events && !events.counts?.total && (
            <p className="dim small">{events.notes?.[0] || 'No events are published for this team in the current season.'}</p>
          )}
          {events?.counts?.total > 0 && (
            <Table head={['Event', 'Date', 'Status']}>
              {[...(events.upcoming || []), ...(events.completed || [])].slice(0, 5).map((e) => (
                <tr key={e.sku}>
                  <td>{e.name}</td>
                  <td className="mono">{d(e.start)}</td>
                  <td><Badge tone={e.status === 'upcoming' ? 'warn' : ''}>{e.status}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Recent activity" subtitle="saved in this browser for this team">
          {!recent.length ? (
            <p className="dim small">
              Field scenarios, autonomous routines, testing sessions and scouting notes you save for {active.number} appear here.
              Nothing is shared between teams.
            </p>
          ) : (
            <ul className="activity-list">
              {recent.map((a, i) => (
                <li key={i}>
                  <span className="badge">{a.kind}</span>
                  <span>{a.label}</span>
                  <span className="spacer" />
                  <button className="link tiny" onClick={() => navigate(a.to)}>{d(a.when)}</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recommended next step" subtitle="based on what exists for this team">
        <div className="next-steps">
          {!profile?.matches ? (
            <p>
              No official matches yet — start where results are not required:{' '}
              <button className="link" onClick={() => navigate('field')}>score a planned end state</button> or{' '}
              <button className="link" onClick={() => navigate('autonomous')}>time an autonomous routine</button>.
            </p>
          ) : !recent.length ? (
            <p>
              You have results but no saved work for {active.number}.{' '}
              <button className="link" onClick={() => navigate('alliance')}>Compare an alliance partner</button> to turn the
              record into a plan.
            </p>
          ) : (
            <p>
              Keep the loop closed: <button className="link" onClick={() => navigate('testing')}>log this week’s trials</button> so
              changes can be compared against the last configuration.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
