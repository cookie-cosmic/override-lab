import React, { useEffect, useRef, useState } from 'react'
import { api, jpost, endpoints, useApi } from './api.js'
import Overview from './views/Overview.jsx'
import Matches from './views/Matches.jsx'
import TeamPage from './views/TeamPage.jsx'
import CounterPage from './views/CounterPage.jsx'
import MetaPage from './views/MetaPage.jsx'
import Onsite from './views/Onsite.jsx'
import Stream from './views/Stream.jsx'
import Landing from './views/Landing.jsx'
import Dashboard from './views/Dashboard.jsx'
import Tournaments from './views/Tournaments.jsx'
import Scouting from './views/Scouting.jsx'
import Alliance from './views/Alliance.jsx'
import Field from './views/Field.jsx'
import Testing from './views/Testing.jsx'
import Rules from './views/Rules.jsx'
import Settings from './views/Settings.jsx'
import EventTable from './views/EventTable.jsx'
import { Empty, Btn } from './components/ui.jsx'
import Icon from './components/Icons.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import TeamSwitcher from './components/TeamSwitcher.jsx'
import { TeamProvider, useTeam } from './team/TeamContext.jsx'
import { navigate, parseHash } from './router.js'
import { THEMES, useTheme } from './theme.js'

// Nine destinations. Everything else is a tab, a panel or a link inside one of these.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Main' },
  { id: 'tournaments', label: 'Tournaments', icon: 'trophy', group: 'Competition' },
  { id: 'competition', label: 'Competition Day', icon: 'zap', group: 'Competition' },
  { id: 'scouting', label: 'Scouting', icon: 'clipboard', group: 'Competition' },
  { id: 'alliance', label: 'Alliance Strategy', icon: 'users', group: 'Competition' },
  { id: 'field', label: 'Field Simulator', icon: 'grid', group: 'Development' },
  { id: 'testing', label: 'Robot Testing', icon: 'wrench', group: 'Development' },
  { id: 'rules', label: 'Rules & Q&A', icon: 'book', group: 'Resources' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Account' }
]
const NAV_GROUPS = ['Main', 'Competition', 'Development', 'Resources']
const TITLES = {
  dashboard: 'Dashboard',
  tournaments: 'Tournaments',
  competition: 'Competition Day',
  scouting: 'Scouting',
  alliance: 'Alliance Strategy',
  field: 'Field Simulator',
  testing: 'Robot Testing',
  rules: 'Rules & Q&A',
  settings: 'Settings',
  welcome: 'Override Lab'
}
const EVENT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'skills', label: 'Skills' },
  { id: 'eliminations', label: 'Eliminations' },
  { id: 'stream', label: 'Video Review' }
]
const EVENT_VIEWS = new Set([...EVENT_TABS.map((t) => t.id), 'team', 'counter', 'meta'])
// Old bookmarks keep working; the standalone categories they belonged to are gone.
const LEGACY = {
  autonomous: () => 'testing',
  onsite: (sku, segs) => `competition${sku ? `/${sku}` : ''}`,
  start: () => 'tournaments',
  simulator: () => 'field',
  sim: () => 'alliance',
  meta: (sku) => `alliance${sku ? `?event=${sku}` : ''}`,
  data: () => 'settings',
  teams: () => 'settings',
  counter: (sku, segs) => (sku ? `scouting/${sku}${segs[2] ? `?opp=${segs[2]}` : ''}` : 'scouting')
}

const d = (v) => {
  const x = new Date(v || '')
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const readStoredEvent = () => {
  try {
    return {
      sku: localStorage.getItem('override-lab:event') || null,
      name: localStorage.getItem('override-lab:event-name') || null
    }
  } catch {
    return { sku: null, name: null }
  }
}

function NavLink({ item, active, collapsed, onClick }) {
  return (
    <a
      href={`#/${item.id}`}
      className={`nav-link ${active ? 'active' : ''}`}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        onClick(item.id)
      }}
    >
      <span className="nav-ico"><Icon name={item.icon} size={18} /></span>
      <span className="nav-text">{item.label}</span>
    </a>
  )
}

function ThemeMenu() {
  const [theme, setTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = THEMES.find((t) => t.id === theme) || THEMES[2]
  return (
    <div className="theme-menu" ref={box}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Colour theme: ${current.label}`}
        title={`Colour theme: ${current.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={current.icon} size={17} />
      </button>
      {open && (
        <div className="theme-pop" role="menu">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === t.id}
              className={theme === t.id ? 'on' : ''}
              onClick={() => {
                setTheme(t.id)
                setOpen(false)
              }}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
              {theme === t.id && <span className="theme-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EventWorkspace({ view, event, sku, go, children, query = '' }) {
  return (
    <div>
      <section className="event-head">
        <div>
          <div className="eyebrow">Tournament review</div>
          <h2>{event?.name || 'Tournament'}</h2>
          <div className="event-head-meta">
            {event?.start_date ? <span className="mono">{d(event.start_date)}</span> : null}
            {event?.sku ? <span className="mono dim">{event.sku}</span> : null}
            {event?.season ? <span className="dim">{event.season}</span> : null}
            {event?.transient ? <span className="badge warn">unsaved session</span> : null}
            {event?.match_count != null ? <span className="dim">{event.match_count} matches</span> : null}
            {sku ? (
              <a className="link tiny" href={`https://www.robotevents.com/robot-competitions/vex-robotics-competition/${sku}.html`} target="_blank" rel="noreferrer">
                Official event ↗
              </a>
            ) : null}
          </div>
        </div>
        <Btn size="sm" variant="ghost" onClick={() => go('tournaments')}>
          All tournaments
        </Btn>
      </section>
      <nav className="tabs event-tabs" aria-label="Tournament sections">
        {EVENT_TABS.map((t) => (
          <a
            key={t.id}
            href={`#/${t.id}/${sku || ''}${query ? `?${query}` : ''}`}
            className={`tab ${view === t.id ? 'active' : ''}`}
            aria-current={view === t.id ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              go(`${t.id}/${sku || ''}${query ? `?${query}` : ''}`)
            }}
          >
            {t.label}
          </a>
        ))}
      </nav>
      <div className="content-body">{children}</div>
    </div>
  )
}

function Shell() {
  const { active, addTeam, hasTeams, teams } = useTeam()
  const [route, setRoute] = useState(parseHash)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('override-lab:sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { data: eventsData, loading: eventsLoading } = useApi(endpoints.events())
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
  const [syncError, setSyncError] = useState(null)
  const [dataKey, setDataKey] = useState(0)
  const syncBusy = useRef(false)

  const [storedEvent, setStoredEvent] = useState(readStoredEvent)

  const rawView = route.segs[0]
  const welcome = !rawView || rawView === 'welcome'
  const known = NAV.some((r) => r.id === rawView) || EVENT_VIEWS.has(rawView)
  const sku = route.segs[1] || null
  const view = welcome ? 'welcome' : known ? rawView : 'dashboard'
  const param = route.segs[2] || null

  const eventName = route.q.get('name')
  const event =
    events.find((e) => e.sku === sku) ||
    (eventName ? { sku, name: eventName, start_date: route.q.get('start') || null } : null) ||
    (!sku && storedEvent.sku ? { sku: storedEvent.sku, name: storedEvent.name, start_date: null } : null) ||
    (live && liveInfo && liveInfo.sku === sku
      ? { sku: liveInfo.sku, name: liveInfo.name, transient: true, match_count: liveInfo.matches }
      : null)

  // Legacy bookmarks from the old 21-link navigation land on their new home.
  useEffect(() => {
    if (welcome || known) return
    const map = LEGACY[rawView]
    if (map) {
      const target = map(sku, route.segs)
      if (target) window.location.replace(`#/${target}`)
      return
    }
    if (!hasTeams) return
    window.location.replace('#/dashboard')
  }, [rawView, sku, known, welcome, hasTeams, route.segs])

  const go = (path) => {
    setDrawer(false)
    navigate(path)
  }

  const setSidebar = () => {
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('override-lab:sidebar', next ? 'collapsed' : 'expanded')
      } catch {
        /* preference simply will not persist */
      }
      return next
    })
  }

  const contextSku = sku || storedEvent.sku || null
  const contextViews = new Set(['competition', 'scouting', 'alliance'])

  const currentTeam =
    view === 'counter'
      ? route.q.get('own') || active?.number
      : view === 'team' || view === 'competition'
        ? param || active?.number
        : active?.number

  useEffect(() => {
    if (!sku) return
    try {
      localStorage.setItem('override-lab:event', sku)
      if (event?.name) localStorage.setItem('override-lab:event-name', event.name)
      // Other destinations (Scouting, Alliance, Competition Day) read this context.
      setStoredEvent((prev) =>
        prev.sku === sku && (!event?.name || prev.name === event.name)
          ? prev
          : { sku, name: event?.name || prev.name || null }
      )
    } catch {
      /* storage may be unavailable */
    }
  }, [sku, event?.name])

  const sync = async () => {
    if (!sku || syncBusy.current) return
    syncBusy.current = true
    setSyncing(true)
    setSyncError(null)
    try {
      await jpost(endpoints.refresh(sku), { team: currentTeam || undefined })
      setDataKey((k) => k + 1)
    } catch (e) {
      setSyncError(e.message)
    } finally {
      syncBusy.current = false
      setSyncing(false)
    }
  }

  // A tournament opened from the list becomes a temporary server session; the notice must
  // appear at once, not only after a reload.
  useEffect(() => {
    const onLive = (e) => setLive(e.detail || null)
    window.addEventListener('override-lab:live', onLive)
    return () => window.removeEventListener('override-lab:live', onLive)
  }, [])

  // Closing or hiding the tab without saving discards the temporary copy, as before.
  useEffect(() => {
    const onHide = () => {
      let pending = null
      try {
        pending = sessionStorage.getItem('vex-live')
      } catch {
        return
      }
      if (!pending) return
      navigator.sendBeacon('/api/session/discard', new Blob([JSON.stringify({ sku: pending })], { type: 'application/json' }))
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

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

  const saveLive = async () => {
    if (!live) return
    try {
      await jpost('/api/session/save', { sku: live })
    } catch (e) {
      setSyncError(e.message)
    }
    sessionStorage.removeItem('vex-live')
    setLive(null)
  }

  const discardLive = async () => {
    if (!live) return
    try {
      await jpost('/api/session/discard', { sku: live })
    } catch (e) {
      setSyncError(e.message)
    }
    sessionStorage.removeItem('vex-live')
    setLive(null)
    go('tournaments')
  }

  if (welcome || !hasTeams) {
    return (
      <>
        <Landing
          onTeam={(record) => {
            addTeam(record)
            navigate('dashboard')
          }}
        />
        <CommandPalette open={palette} onClose={() => setPalette(false)} events={events} />
      </>
    )
  }

  const eventView = EVENT_VIEWS.has(view)
  const showEventPicker = eventView || contextViews.has(view)
  const primary = NAV.find((n) => n.id === view)
  const title = eventView ? event?.name || TITLES[view] || 'Tournament' : TITLES[view] || 'Override Lab'
  const crumb = eventView ? 'Tournaments' : primary?.group === 'Competition' ? 'Competition' : primary?.group || ''

  return (
    <div className={`app ${collapsed ? 'rail' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>

      {drawer && <button type="button" className="drawer-scrim" aria-label="Close navigation" onClick={() => setDrawer(false)} />}

      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-top">
          <a className="brand" href="#/dashboard" onClick={(e) => { e.preventDefault(); go('dashboard') }}>
            <span className="brand-mark" aria-hidden="true">OL</span>
            <span className="brand-text">
              <span className="brand-name">Override Lab</span>
              <span className="brand-sub">V5RC 2026–27</span>
            </span>
          </a>
          <button type="button" className="icon-btn rail-toggle" onClick={setSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name="panel" size={17} />
          </button>
        </div>

        <TeamSwitcher className={collapsed ? 'is-collapsed' : ''} />

        <nav className="nav" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group)
            if (!items.length) return null
            return (
              <div className="nav-group" key={group}>
                <div className="nav-label">{group}</div>
                {items.map((item) => (
                  <NavLink key={item.id} item={item} active={view === item.id || (eventView && item.id === 'tournaments')} collapsed={collapsed} onClick={go} />
                ))}
              </div>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <NavLink item={NAV.find((n) => n.id === 'settings')} active={view === 'settings'} collapsed={collapsed} onClick={go} />
          <div className="sidebar-foot">
            Unofficial V5RC analysis · not affiliated with VEX or the REC Foundation.
          </div>
        </div>
      </aside>

      <div className="main">
        {live && (
          <div className="live-bar">
            <div>
              <strong>Unsaved session</strong> · <span className="mono">{live}</span> — this event is temporary until saved.
            </div>
            <div className="row">
              <Btn size="sm" variant="primary" onClick={saveLive}>Save to archive</Btn>
              <Btn size="sm" variant="ghost" onClick={discardLive}>Discard</Btn>
            </div>
          </div>
        )}

        <header className="topbar">
          <button type="button" className="icon-btn mobile-only" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Icon name="menu" size={19} />
          </button>
          <div className="topbar-title">
            <div className="crumbs">
              <span>Override Lab</span>
              {crumb ? <><span aria-hidden="true">/</span><span>{crumb}</span></> : null}
            </div>
            <h1>{title}</h1>
          </div>

          <div className="topbar-actions">
            <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Search tools, teams and events">
              <Icon name="search" size={16} />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>

            {showEventPicker && (events.length > 0 || contextSku) && (
              <select
                className="event-select"
                value={sku || contextSku || ''}
                onChange={(e) => go(eventView ? `overview/${e.target.value}` : `${view}/${e.target.value}`)}
                aria-label="Selected tournament"
                title="Selected tournament"
              >
                <option value="">Choose event…</option>
                {contextSku && !events.some((e) => e.sku === contextSku) && (
                  <option value={contextSku}>{event?.name || contextSku}</option>
                )}
                {events.map((e) => (
                  <option key={e.sku} value={e.sku}>{e.name}</option>
                ))}
              </select>
            )}

            {eventView && sku && (
              <button type="button" className="icon-btn" onClick={sync} disabled={syncing} title="Pull the latest official matches">
                <Icon name={syncing ? 'close' : 'arrow'} size={16} className={syncing ? 'spin' : ''} />
              </button>
            )}
            {syncError && <span className="tiny bad" title={syncError}>sync failed</span>}
            <ThemeMenu />
          </div>
        </header>

        <main className="content" id="main-content" key={`${view}-${sku || ''}-${dataKey}`}>
          {view === 'dashboard' && <Dashboard />}
          {view === 'tournaments' && (
            eventsLoading && !events.length ? <div className="skeleton-block" aria-busy="true">Loading tournaments…</div> : <Tournaments />
          )}
          {view === 'competition' && (
            contextSku ? (
              <Onsite sku={contextSku} team={currentTeam} navigate={go} />
            ) : (
              <Empty>
                Choose a tournament to open Competition Day. <button type="button" className="link" onClick={() => go('tournaments')}>Browse tournaments</button>.
              </Empty>
            )
          )}
          {view === 'scouting' && <Scouting sku={contextSku} />}
          {view === 'alliance' && <Alliance sku={contextSku} />}
          {view === 'field' && <Field query={route.q} />}
          {view === 'testing' && <Testing />}
          {view === 'rules' && <Rules />}
          {view === 'settings' && <Settings />}

          {eventView && (
            <EventWorkspace view={view} event={event} sku={sku} go={go} query={(() => { const q = new URLSearchParams(); if (eventName) q.set('name', eventName); if (event?.start_date) q.set('start', event.start_date); return q.toString() })()}>
              {!sku ? (
                <Empty>
                  No tournament selected. <button type="button" className="link" onClick={() => go('tournaments')}>Open a tournament</button> to see its review.
                </Empty>
              ) : (
                <>
                  {view === 'overview' && <Overview sku={sku} navigate={go} />}
                  {view === 'matches' && <Matches sku={sku} navigate={go} matchKey={route.q.get('m')} />}
                  {view === 'stream' && <Stream sku={sku} matchKey={route.q.get('m')} navigate={go} />}
                  {view === 'rankings' && <EventTable sku={sku} mode="rankings" navigate={go} />}
                  {view === 'skills' && <EventTable sku={sku} mode="skills" navigate={go} />}
                  {view === 'eliminations' && <EventTable sku={sku} mode="eliminations" navigate={go} />}
                  {view === 'team' && <TeamPage sku={sku} team={currentTeam} vs={route.q.get('vs')} navigate={go} />}
                  {view === 'counter' && <CounterPage sku={sku} opp={param} own={currentTeam} navigate={go} />}
                  {view === 'meta' && <MetaPage sku={sku} navigate={go} />}
                </>
              )}
            </EventWorkspace>
          )}
        </main>

        <nav className="mobile-bar" aria-label="Primary mobile navigation">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
            { id: 'tournaments', label: 'Events', icon: 'trophy' },
            { id: 'competition', label: 'Match day', icon: 'zap' },
            { id: 'scouting', label: 'Scout', icon: 'clipboard' },
            { id: 'alliance', label: 'Strategy', icon: 'users' }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          ))}
          <button type="button" onClick={() => setDrawer(true)}>
            <Icon name="menu" size={20} />
            <span>More</span>
          </button>
        </nav>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} events={events} />
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
