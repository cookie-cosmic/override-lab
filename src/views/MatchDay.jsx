import React from 'react'
import { endpoints, useApi } from '../api.js'
import { Badge, Btn, Empty, Note } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import Tournaments from './Tournaments.jsx'
import Overview from './Overview.jsx'
import Matches from './Matches.jsx'
import EventTable from './EventTable.jsx'
import Stream from './Stream.jsx'
import MatchBrief from './MatchBrief.jsx'
import SchedulePanel from './SchedulePanel.jsx'
import Operations from './Operations.jsx'
import { Gate } from './AccessPanel.jsx'
import { useAccess } from '../access/AccessContext.jsx'
import Countdown from '../components/Countdown.jsx'

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'skills', label: 'Skills' },
  { id: 'eliminations', label: 'Eliminations' },
  { id: 'brief', label: 'Briefing', feature: 'matchIntelligence' },
  { id: 'video', label: 'Video Review', feature: 'streamAnalysis' }
]

const TABS = [
  { id: 'matches', label: 'Matches' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'operations', label: 'Operations' }
]

const dateLabel = (v) => {
  const d = new Date(v || '')
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Match Day: tournament discovery, event review, match briefing, tournament planning and team
 * operations in one workspace with three tabs. The selected tournament is shared by every tab
 * and by Intelligence and Simulation, so the same event never has to be picked twice.
 */
export default function MatchDay({ query, sku, activeTeam, go, eventName }) {
  const { isTeam, isOwner, can } = useAccess()
  const tab = TABS.some((t) => t.id === query?.get('tab')) ? query.get('tab') : 'matches'
  const view = VIEWS.some((v) => v.id === query?.get('view')) ? query.get('view') : 'overview'
  const { data: eventsData } = useApi(endpoints.events())
  const event = (eventsData?.events || []).find((e) => e.sku === sku) || null
  const label = event?.name || eventName || sku || null
  const matchKey = query?.get('m') || null

  const setTab = (id, nextView = view) => {
    const q = new URLSearchParams(query?.toString() || '')
    q.set('tab', id)
    if (id === 'matches') q.set('view', nextView)
    else q.delete('view')
    if (sku) q.set('event', sku)
    go(`match-day?${q.toString()}`)
  }

  const setView = (id) => setTab('matches', id)

  const workspaceReady = isTeam || isOwner
  // The server already projects the next match from the published schedule and posted results;
  // the card shows that projection instead of inventing a start time.
  const { data: insight } = useApi(
    sku && activeTeam && workspaceReady ? `/api/workspace/schedule/insight?sku=${encodeURIComponent(sku)}` : null
  )
  const upcoming = !sku && workspaceReady
    ? (eventsData?.events || [])
        .filter((e) => e.start_date && Date.parse(e.start_date) >= Date.now() - 86400000)
        .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date))[0] || null
    : null

  return (
    <div>
      <nav className="tabs" aria-label="Match Day sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id !== 'matches' && !workspaceReady && <span className="lock-dot" aria-label="requires a team workspace"> ·</span>}
          </button>
        ))}
      </nav>

      {tab === 'matches' && (
        <>
          <NextUp insight={insight} upcoming={upcoming} workspaceReady={workspaceReady} sku={sku} can={can} go={go} team={activeTeam} />
          {!sku ? (
            <>
              <Note>Open a tournament to review its official results and plan its schedule. Briefing and video review need a team workspace.</Note>
              <Tournaments />
            </>
          ) : (
            <>
              <section className="event-head">
                <div>
                  <div className="eyebrow">Tournament</div>
                  <h2>{label || 'Selected tournament'}</h2>
                  <div className="event-head-meta">
                    {event?.start_date ? <span className="mono">{dateLabel(event.start_date)}</span> : null}
                    <span className="mono dim">{sku}</span>
                    {event?.season ? <span className="dim">{event.season}</span> : null}
                    {event?.transient ? <Badge tone="warn">unsaved session</Badge> : null}
                    {event?.match_count != null ? <span className="dim">{event.match_count} matches</span> : null}
                    <a className="link tiny" href={`https://www.robotevents.com/robot-competitions/vex-robotics-competition/${sku}.html`} target="_blank" rel="noreferrer">
                      Official event ↗
                    </a>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Btn size="sm" variant="ghost" onClick={() => go('match-day')}>All tournaments</Btn>
                </div>
              </section>

              <nav className="tabs sub-tabs" aria-label="Tournament sections">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`tab ${view === v.id ? 'active' : ''}`}
                    onClick={() => setView(v.id)}
                    title={!can(v.feature) && v.feature ? 'Requires an approved team workspace' : undefined}
                  >
                    {v.label}
                    {v.feature && !can(v.feature) && <Icon name="lock" size={11} />}
                  </button>
                ))}
              </nav>

              <div className="content-body">
                {view === 'overview' && <Overview sku={sku} navigate={go} />}
                {view === 'matches' && <Matches sku={sku} navigate={go} matchKey={matchKey} />}
                {view === 'rankings' && <EventTable sku={sku} mode="rankings" navigate={go} />}
                {view === 'skills' && <EventTable sku={sku} mode="skills" navigate={go} />}
                {view === 'eliminations' && <EventTable sku={sku} mode="eliminations" navigate={go} />}
                {view === 'video' && (
                  <Gate feature="streamAnalysis" title="Video review">
                    <Stream sku={sku} matchKey={matchKey} navigate={go} />
                  </Gate>
                )}
                {view === 'brief' && (
                  <Gate feature="matchIntelligence" title="Pre-match intelligence">
                    <MatchBrief sku={sku} team={activeTeam} />
                  </Gate>
                )}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'schedule' && (
        workspaceReady ? <SchedulePanel sku={sku} /> : (
          <Empty>A team workspace is required for the tournament planner. Enter your team PIN from Home → access.</Empty>
        )
      )}

      {tab === 'operations' && (
        workspaceReady ? <Operations sku={sku} /> : (
          <Empty>Team operations — tasks, batteries, skills, readiness and judging — live in your team&apos;s private workspace.</Empty>
        )
      )}
    </div>
  )
}

const fmtWhen = (v) => {
  const d = new Date(v || '')
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * The answer to "what is next, and when should we be on deck?".
 *
 * With a tournament open it is the next match, counting down to the server's projected start
 * (published start time kept beside it, never merged into it). Without one it is the next
 * registered tournament, counting down to its published date. Both states label what is official
 * and what is an estimate, so nothing reads as a live field clock.
 */
function NextUp({ insight, upcoming, workspaceReady, sku, can, go, team }) {
  if (!workspaceReady) return null

  if (sku && insight?.available && insight.match) {
    const n = insight.match
    const published = Boolean(insight.basis?.scheduled)
    const scheduled = fmtWhen(insight.scheduledStart)
    const projected = fmtWhen(insight.projectedStart)
    return (
      <section className={`next-up ${n.alliance === 'red' ? 'is-red' : 'is-blue'}`} aria-labelledby="next-up-title">
        <div className="next-up-main">
          <div className="next-up-kicker">
            <span className="live-dot" aria-hidden="true" />
            Next match
            <Badge tone={published ? 'blue' : 'warn'}>{published ? 'published schedule' : 'estimate only'}</Badge>
            {n.field ? <span className="tiny dim">field {n.field}</span> : null}
          </div>
          <h2 id="next-up-title" className="next-up-title">
            Match {n.number} <span className="dim" style={{ fontWeight: 400 }}>· {n.round === 2 ? 'qualification' : 'elimination'}</span>
          </h2>
          <div className="next-up-time">
            <div>
              <div className="tiny dim" style={{ marginBottom: 4 }}>Estimated start</div>
              <Countdown to={insight.projectedStart} />
            </div>
            <div className="next-up-labels">
              <span><b>Scheduled</b>{scheduled || 'not published'}</span>
              <span><b>Projected</b>{projected || '—'}</span>
              {insight.queueAhead > 0 ? <span><b>Queue</b>{insight.queueAhead} matches ahead</span> : null}
              {/* Only meaningful while the event is actually running: a delay measured against the
                  last posted result says nothing about a match days away. */}
              {Math.abs(insight.delayMinutes || 0) > 0 &&
              Math.abs(insight.delayMinutes) <= 90 &&
              Math.abs(Date.parse(insight.projectedStart) - Date.now()) < 6 * 3600 * 1000 ? (
                <span><b>Running</b>{insight.delayMinutes > 0 ? `${insight.delayMinutes} min late` : `${-insight.delayMinutes} min early`}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="next-up-side">
          <div className="alliance-line">
            <Badge tone={n.alliance === 'red' ? 'red' : 'blue'}>your alliance</Badge>
            <strong className="mono">{team}</strong>
            {n.partners?.length ? <span className="small dim">+ {n.partners.join(', ')}</span> : <span className="small dim">· solo</span>}
          </div>
          <div className="alliance-line">
            <span className="tiny dim">vs</span>
            <span className="mono small">{n.opponents?.join(', ') || '—'}</span>
          </div>
          <div className="tiny dim" style={{ marginTop: 8 }}>
            {insight.basis?.note || 'Estimated from the published schedule and posted results — not a live field clock.'}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            <Btn size="sm" onClick={() => go(`match-day?event=${encodeURIComponent(sku)}&tab=matches&view=${can('matchIntelligence') ? 'brief' : 'overview'}`)}>
              {can('matchIntelligence') ? 'Match briefing' : 'Match details'}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => go(`match-day?event=${encodeURIComponent(sku)}&tab=schedule`)}>Schedule</Btn>
          </div>
        </div>
      </section>
    )
  }

  if (!sku && upcoming) {
    return (
      <section className="next-up is-next-event" aria-labelledby="next-up-title">
        <div className="next-up-main">
          <div className="next-up-kicker">
            <span className="live-dot" aria-hidden="true" />
            Next tournament
            <Badge tone="blue">scheduled date</Badge>
          </div>
          <h2 id="next-up-title" className="next-up-title">{upcoming.name}</h2>
          <div className="next-up-time">
            <div>
              <div className="tiny dim" style={{ marginBottom: 4 }}>Starts</div>
              <Countdown to={upcoming.start_date} expired="In progress" />
            </div>
            <div className="next-up-labels">
              <span><b>Scheduled</b>{fmtWhen(upcoming.start_date) || 'date not published'}</span>
              {upcoming.location ? <span><b>Location</b>{upcoming.location}</span> : null}
            </div>
          </div>
        </div>
        <div className="next-up-side">
          <div className="small">Open it to load the official match schedule and plan the day around it.</div>
          <div className="row" style={{ marginTop: 10 }}>
            <Btn size="sm" onClick={() => go(`match-day?event=${encodeURIComponent(upcoming.sku)}&tab=matches&view=overview`)}>Open tournament</Btn>
          </div>
        </div>
      </section>
    )
  }

  return null
}
