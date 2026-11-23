import React, { useEffect, useRef, useState } from 'react'
import { api, jpost, endpoints, useApi } from './api.js'
import Overview from './views/Overview.jsx'
import Matches from './views/Matches.jsx'
import TeamPage from './views/TeamPage.jsx'
import CounterPage from './views/CounterPage.jsx'
import MetaPage from './views/MetaPage.jsx'
import DataPage from './views/DataPage.jsx'
import Onsite from './views/Onsite.jsx'
import Sim from './views/Sim.jsx'
import Simulator from './views/Simulator.jsx'
import Stream from './views/Stream.jsx'
import Start from './views/Start.jsx'
import Landing from './views/Landing.jsx'
import Dashboard from './views/Dashboard.jsx'
import MyTeams from './views/MyTeams.jsx'
import Tournaments from './views/Tournaments.jsx'
import Scouting from './views/Scouting.jsx'
import Alliance from './views/Alliance.jsx'
import Field from './views/Field.jsx'
import Autonomous from './views/Autonomous.jsx'
import Testing from './views/Testing.jsx'
import Rules from './views/Rules.jsx'
import Settings from './views/Settings.jsx'
import { Empty, Btn } from './components/ui.jsx'
import ApiKey from './components/ApiKey.jsx'
import TeamSwitcher from './components/TeamSwitcher.jsx'
import { THEMES, useTheme } from './theme.js'
import { TeamProvider, useTeam } from './team/TeamContext.jsx'
import { navigate, parseHash } from './router.js'

const ROUTES = [
  { id: 'dashboard', label: 'My dashboard', icon: '◫', group: 'My team' },
  { id: 'teams', label: 'My teams', icon: '◉', group: 'My team' },
  { id: 'tournaments', label: 'Tournaments', icon: '⌖', group: 'My team' },

  { id: 'scouting', label: 'Scouting', icon: '◎', group: 'Tools' },
  { id: 'alliance', label: 'Alliance analysis', icon: '⇄', group: 'Tools' },
  { id: 'field', label: 'Field simulator', icon: '▩', group: 'Tools' },
  { id: 'autonomous', label: 'Autonomous planner', icon: '⟜', group: 'Tools' },
  { id: 'testing', label: 'Robot testing', icon: '◍', group: 'Tools' },
  { id: 'rules', label: 'Rules & Q&A', icon: '¶', group: 'Tools' },

  { id: 'start', label: 'Find a competition', icon: '⌖', group: 'Review' },
  { id: 'overview', label: 'Overview', icon: '▤', group: 'Review' },
  { id: 'matches', label: 'Matches', icon: '▥', group: 'Review' },
  { id: 'stream', label: 'Stream analysis', icon: '▶', group: 'Review' },
  { id: 'onsite', label: 'Onsite', icon: '⚡', group: 'Review' },

  { id: 'sim', label: 'Simulation', icon: '◈', group: 'Analysis' },
  { id: 'simulator', label: 'Override sim', icon: '▦', group: 'Analysis' },
  { id: 'team', label: 'Team lab', icon: '◆', group: 'Analysis' },
  { id: 'counter', label: 'Opponent & counters', icon: '⚔', group: 'Analysis' },
  { id: 'meta', label: 'Meta & model', icon: '▣', group: 'Analysis' },

  { id: 'data', label: 'Data & ingest', icon: '⤓', group: 'Data' },
  { id: 'settings', label: 'Settings', icon: '⚙', group: 'Data' }
]
const NAV_GROUPS = ['My team', 'Tools', 'Review', 'Analysis', 'Data']
const titleFor = (id) => ROUTES.find((r) => r.id === id)?.label || 'Override Lab'
const MODEL_VIEWS = new Set(['overview', 'matches', 'stream', 'onsite', 'team', 'counter', 'meta', 'data', 'sim'])

function Shell() {
  const { active, addTeam, hasTeams } = useTeam()
  const [route, setRoute] = useState(parseHash)
  const [theme, setTheme] = useTheme()

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const { data: eventsData, loading: eventsLoading, reload: reloadEvents } = useApi(endpoints.events())
  const events = eventsData?.events || []
  const [live, setLive] = useState(() => {
    try {
      return sessionStorage.getItem('vex-live')
    } catch {
      return null
    }
  })
  const [liveInfo, setLiveInfo] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState(null)
  const [syncError, setSyncError] = useState(null)
  const [dataKey, setDataKey] = useState(0)
  const syncBusy = useRef(false)

  const rawView = route.segs[0]
  const known = ROUTES.some((r) => r.id === rawView)
  const welcome = rawView === 'welcome'
  const view = welcome || !known ? (hasTeams ? 'dashboard' : 'welcome') : rawView
  const sku = route.segs[1] || events[0]?.sku || null
  const param = route.segs[2] || null

  // A first-time visitor lands on the public page, never on a hardcoded team.
  if (welcome || (!hasTeams && view !== 'welcome')) {
    return (
      <Landing
        onTeam={(record) => {
          addTeam(record)
          navigate('dashboard')
        }}
      />
    )
  }

  const event =
    events.find((e) => e.sku === sku) ||
    (live && liveInfo && liveInfo.sku === sku
      ? { sku: liveInfo.sku, name: liveInfo.name, transient: true, match_count: liveInfo.matches }
      : null)
  const go = (path) => navigate(path)

  // Every team-scoped view falls back to the active team, so the URL stays optional and a
  // switch changes the context of the tool immediately.
  const currentTeam =
    view === 'team' || view === 'onsite' || view === 'sim'
      ? param || active?.number
      : view === 'counter'
        ? route.q.get('own') || active?.number
        : active?.number

  const pathFor = (id, eventSku = sku) => {
    const base = `${id}/${eventSku || ''}`
    if (id === 'team' || id === 'onsite' || id === 'sim') return currentTeam ? `${base}/${encodeURIComponent(currentTeam)}` : base
    if (id === 'counter') return currentTeam ? `${base}?own=${encodeURIComponent(currentTeam)}` : base
    return base
  }

  const sync = async ({ silent = false } = {}) => {
    if (!sku || syncBusy.current) return
    syncBusy.current = true
    setSyncing(true)
    setSyncError(null)
    try {
      await jpost(endpoints.refresh(sku), { team: currentTeam || undefined })
      setSyncedAt(new Date())
      setDataKey((k) => k + 1)
    } catch (e) {
      if (!silent) setSyncError(e.message)
    } finally {
      syncBusy.current = false
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!sku || !event) return
    const start = Date.parse(event.start_date || '')
    const end = Date.parse(event.end_date || event.start_date || '')
    const now = Date.now()
    const running = !Number.isNaN(start) && now >= start - 86400000 && (Number.isNaN(end) || now <= end + 2 * 86400000)
    if (!running) return
    const id = setInterval(() => sync({ silent: true }), 4 * 60 * 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku, event?.start_date, event?.end_date])

  useEffect(() => {
    api('/api/session')
      .then((r) => {
        setLiveInfo(r?.session || null)
        if (!r?.session) {
          sessionStorage.removeItem('vex-live')
          setLive(null)
        }
      })
      .catch(() => {})
  }, [live])

  useEffect(() => {
    const onHide = () => {
      const pending = sessionStorage.getItem('vex-live')
      if (!pending) return
      navigator.sendBeacon('/api/session/discard', new Blob([JSON.stringify({ sku: pending })], { type: 'application/json' }))
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  const saveLive = async () => {
    if (!live) return
    try {
      await jpost('/api/session/save', { sku: live })
    } catch (e) {
      console.error(e)
    }
    sessionStorage.removeItem('vex-live')
    setLive(null)
    reloadEvents()
  }

  const discardLive = async () => {
    if (!live) return
    try {
      await jpost('/api/session/discard', { sku: live })
    } catch (e) {
      console.error(e)
    }
    sessionStorage.removeItem('vex-live')
    setLive(null)
    reloadEvents()
    navigate('start')
  }

  const eventView = MODEL_VIEWS.has(view)
  const noEventNeeded = !eventView

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V5</div>
          <div>
            <div className="brand-name">Override Lab</div>
            <div className="brand-sub">V5RC 2026–27</div>
          </div>
        </div>

        <TeamSwitcher />

        <div className="event-pick">
          <div className="nav-label">Archived event</div>
          {eventsLoading && <div className="dim small">loading…</div>}
          {!eventsLoading && !events.length && <div className="small dim">Archive empty</div>}
          {events.length > 0 && (
            <select value={sku || ''} onChange={(e) => go(pathFor(view, e.target.value))}>
              {events.map((e) => (
                <option key={e.sku} value={e.sku}>
                  {e.name} ({e.season || e.sku})
                </option>
              ))}
            </select>
          )}
          {event && (
            <div className="tiny dim" style={{ lineHeight: 1.45 }}>
              {event.transient ? (
                <>
                  unsaved session
                  <br />
                  {event.match_count ?? 0} matches loaded
                  <br />
                  save it or it is deleted
                </>
              ) : (
                <>
                  {event.program} · {event.season || 'season n/a'}
                  <br />
                  {event.team_count} teams · {event.match_count} matches
                  <br />
                  {event.video_count} video{event.video_count === 1 ? '' : 's'} linked
                </>
              )}
            </div>
          )}
        </div>

        <nav className="nav" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {ROUTES.filter((r) => r.group === group).map((r) => (
                <a
                  key={r.id}
                  href={`#/${pathFor(r.id)}`}
                  className={view === r.id ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault()
                    go(pathFor(r.id))
                  }}
                >
                  <span className="ico" aria-hidden="true">{r.icon}</span>
                  {r.label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="spacer" />
        <ApiKey />
        <div className="sidebar-foot">Model estimates, not an official VEX product.</div>
      </aside>

      <div className="main">
        {live && (
          <div className="live-bar">
            <div>
              <strong>Unsaved session</strong> · <span className="mono">{live}</span> — this event is temporary. Close the tab or
              discard it and the data is deleted.
            </div>
            <div className="row">
              <Btn size="sm" variant="primary" onClick={saveLive}>Save to archive</Btn>
              <Btn size="sm" variant="ghost" onClick={discardLive}>Discard now</Btn>
            </div>
          </div>
        )}

        <header className="topbar">
          <div className="topbar-title">
            <h1>{titleFor(view)}</h1>
            <div className="topbar-sub">
              {event && eventView
                ? event.transient
                  ? `${event.name} · unsaved session · ${event.match_count ?? 0} matches`
                  : `${event.name} · ${event.program} · ${event.season || ''} · ${event.start_date ? String(event.start_date).slice(0, 10) : ''}`
                : active
                  ? `${active.number}${active.name ? ` · ${active.name}` : ''} · ${active.seasonLabel}`
                  : 'multi-team VEX V5RC Override analysis'}
            </div>
          </div>
          <div className="topbar-actions">
            {!noEventNeeded && sku && (
              <button
                type="button"
                className="theme-opt"
                onClick={() => sync()}
                disabled={syncing}
                title={syncedAt ? `last synced ${syncedAt.toLocaleTimeString()}` : 'pull the latest matches from RobotEvents'}
              >
                <span>{syncing ? '⟳ syncing…' : '⟳ sync'}</span>
              </button>
            )}
            {syncError && <span className="tiny bad">{syncError}</span>}
            <div className="theme-switch" role="group" aria-label="Colour theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-opt ${theme === t.id ? 'active' : ''}`}
                  title={`${t.label} theme`}
                  aria-pressed={theme === t.id}
                  onClick={() => setTheme(t.id)}
                >
                  <span className={`swatch ${t.id}`} />
                  <span className="theme-label">{t.label}</span>
                </button>
              ))}
            </div>
            {active && <span className="top-pill">{active.number}</span>}
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Primary">
          {[
            { id: 'dashboard', label: 'Home' },
            { id: 'tournaments', label: 'Events' },
            { id: 'field', label: 'Field' },
            { id: 'testing', label: 'Testing' }
          ].map((item) => (
            <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => go(item.id)}>
              <span aria-hidden="true">{ROUTES.find((r) => r.id === item.id)?.icon}</span>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => go('teams')}>
            <span aria-hidden="true">☰</span> More
          </button>
        </nav>

        <main className="content" id="main-content" key={dataKey}>
          {view === 'dashboard' && <Dashboard />}
          {view === 'teams' && <MyTeams query={route.q} />}
          {view === 'tournaments' && <Tournaments />}
          {view === 'scouting' && <Scouting />}
          {view === 'alliance' && <Alliance />}
          {view === 'field' && <Field query={route.q} />}
          {view === 'autonomous' && <Autonomous />}
          {view === 'testing' && <Testing />}
          {view === 'rules' && <Rules />}
          {view === 'settings' && <Settings />}
          {view === 'start' && <Start navigate={go} />}
          {view === 'simulator' && <Simulator />}
          {eventView && !sku && (
            <Empty>No events in the archive yet — start with a competition name and a team ID.</Empty>
          )}
          {sku && view === 'onsite' && <Onsite sku={sku} team={currentTeam} navigate={go} />}
          {sku && view === 'sim' && <Sim sku={sku} team={currentTeam} navigate={go} />}
          {sku && view === 'overview' && <Overview sku={sku} navigate={go} />}
          {sku && view === 'matches' && <Matches sku={sku} navigate={go} matchKey={route.q.get('m')} />}
          {sku && view === 'stream' && <Stream sku={sku} matchKey={route.q.get('m')} navigate={go} />}
          {sku && view === 'team' && <TeamPage sku={sku} team={currentTeam} vs={route.q.get('vs')} navigate={go} />}
          {sku && view === 'counter' && <CounterPage sku={sku} opp={param} own={currentTeam} navigate={go} />}
          {sku && view === 'meta' && <MetaPage sku={sku} navigate={go} />}
          {sku && view === 'data' && <DataPage sku={sku} navigate={go} />}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <TeamProvider>
      <Shell />
    </TeamProvider>
  )
}
