import React, { useEffect, useState } from 'react'
import { api, jpost, endpoints, useApi, fmt } from './api.js'
import Overview from './views/Overview.jsx'
import Matches from './views/Matches.jsx'
import TeamPage from './views/TeamPage.jsx'
import CounterPage from './views/CounterPage.jsx'
import MetaPage from './views/MetaPage.jsx'
import DataPage from './views/DataPage.jsx'
import Onsite from './views/Onsite.jsx'
import Sim from './views/Sim.jsx'
import Stream from './views/Stream.jsx'
import Start from './views/Start.jsx'
import { Empty, Btn } from './components/ui.jsx'
import { THEMES, useTheme } from './theme.js'

const ROUTES = [
  { id: 'start', label: 'Find a competition', icon: '⌖', group: 'Review' },
  { id: 'overview', label: 'Overview', icon: '◎', group: 'Review' },
  { id: 'matches', label: 'Matches', icon: '▤', group: 'Review' },
  { id: 'stream', label: 'Stream analysis', icon: '▶', group: 'Review' },
  { id: 'onsite', label: 'Onsite', icon: '⚡', group: 'Review' },
  { id: 'sim', label: 'Simulation', icon: '◈', group: 'Analysis' },
  { id: 'team', label: 'Team lab', icon: '◆', group: 'Analysis' },
  { id: 'counter', label: 'Opponent & counters', icon: '⚔', group: 'Analysis' },
  { id: 'meta', label: 'Meta & model', icon: '▦', group: 'Analysis' },
  { id: 'data', label: 'Data & ingest', icon: '⤓', group: 'Data' }
]
const NAV_GROUPS = ['Review', 'Analysis', 'Data']
const titleFor = (id) => ROUTES.find((r) => r.id === id)?.label || 'Override Lab'

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, query] = raw.split('?')
  const segs = path.split('/').filter(Boolean)
  return { segs, q: new URLSearchParams(query || '') }
}

export function navigate(path) {
  window.location.hash = `#/${path}`
}

export default function App() {
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
  const known = ROUTES.some((r) => r.id === route.segs[0])
  const view = known ? route.segs[0] : events.length ? 'overview' : 'start'
  const sku = route.segs[1] || events[0]?.sku || null
  const param = route.segs[2] || null

  useEffect(() => {
    if (!events.length) return
    if (!route.segs[0] || !route.segs[1]) navigate(`${view}/${events[0].sku}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length])

  const event =
    events.find((e) => e.sku === sku) ||
    (live && liveInfo && liveInfo.sku === sku
      ? { sku: liveInfo.sku, name: liveInfo.name, transient: true, match_count: liveInfo.matches }
      : null)
  const go = (path) => navigate(path)
  // The team number is the other half of the session, so it survives changing view or event.
  // Without one, the team lab and counters fall back to their own pickers.
  const currentTeam = view === 'team' || view === 'onsite' || view === 'sim' ? param : view === 'counter' ? route.q.get('own') : null
  const pathFor = (id, eventSku = sku) => {
    const base = `${id}/${eventSku || ''}`
    if (id === 'team' || id === 'onsite' || id === 'sim') return currentTeam ? `${base}/${encodeURIComponent(currentTeam)}` : base
    if (id === 'counter') return currentTeam ? `${base}?own=${encodeURIComponent(currentTeam)}` : base
    return base
  }

  // A resolved event is transient on the server; sync so a restart or a finished save never
  // leaves a stale banner behind.
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

  // Leaving the tab discards the session unless the user saved it first.
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V5</div>
          <div>
            <div className="brand-name">Override Lab</div>
            <div className="brand-sub">match review</div>
          </div>
        </div>

        <div className="event-pick">
          <div className="nav-label">Event</div>
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

        <nav className="nav">
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
                  <span className="ico">{r.icon}</span>
                  {r.label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="spacer" />
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
              <Btn size="sm" variant="primary" onClick={saveLive}>
                Save to archive
              </Btn>
              <Btn size="sm" variant="ghost" onClick={discardLive}>
                Discard now
              </Btn>
            </div>
          </div>
        )}
        <header className="topbar">
          <div className="topbar-title">
            <h1>{titleFor(view)}</h1>
            <div className="topbar-sub">
              {event
                ? event.transient
                  ? `${event.name} · unsaved session · ${event.match_count ?? 0} matches`
                  : `${event.name} · ${event.program} · ${event.season || ''} · ${event.start_date ? String(event.start_date).slice(0, 10) : ''}`
                : 'post-tournament review, 2026-27 Override'}
            </div>
          </div>
          <div className="topbar-actions">
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
            {event && <span className="top-pill">{event.transient ? 'unsaved session' : event.season || event.sku}</span>}
          </div>
        </header>
        <main className="content">
          {view === 'start' && <Start navigate={go} />}
          {!sku && view !== 'start' && <Empty>No events in the archive yet — start with a competition name and a team ID.</Empty>}
          {sku && view === 'onsite' && <Onsite sku={sku} team={param} navigate={go} />}
          {sku && view === 'sim' && <Sim sku={sku} team={param} navigate={go} />}
          {sku && view === 'overview' && <Overview sku={sku} navigate={go} />}
          {sku && view === 'matches' && <Matches sku={sku} navigate={go} matchKey={route.q.get('m')} />}
          {sku && view === 'stream' && <Stream sku={sku} matchKey={route.q.get('m')} navigate={go} />}
          {sku && view === 'team' && <TeamPage sku={sku} team={param} vs={route.q.get('vs')} navigate={go} />}
          {sku && view === 'counter' && <CounterPage sku={sku} opp={param} own={route.q.get('own')} navigate={go} />}
          {sku && view === 'meta' && <MetaPage sku={sku} navigate={go} />}
          {sku && view === 'data' && <DataPage sku={sku} navigate={go} />}
        </main>
      </div>
    </div>
  )
}
