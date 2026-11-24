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
          {!sku ? (
            <>
              <Note>
                Find a competition to review its official results, or open the next one to plan around its schedule.
                Public visitors see official results; the briefing and video tools need an approved workspace.
              </Note>
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
