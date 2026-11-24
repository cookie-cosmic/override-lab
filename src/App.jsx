import React, { useEffect, useMemo, useRef, useState } from 'react'
import { endpoints, useApi } from './api.js'
import Landing from './views/Landing.jsx'
import Home from './views/Home.jsx'
import MatchDay from './views/MatchDay.jsx'
import Intelligence from './views/Intelligence.jsx'
import Simulation from './views/Simulation.jsx'
import Testing from './views/Testing.jsx'
import Rules from './views/Rules.jsx'
import Settings from './views/Settings.jsx'
import Chapter from './views/Chapter.jsx'
import Owner, { OwnerViewTeam } from './views/Owner.jsx'
import PublicTeam from './views/PublicTeam.jsx'
import { Empty } from './components/ui.jsx'
import Icon from './components/Icons.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import TeamSwitcher from './components/TeamSwitcher.jsx'
import { TeamProvider, useTeam } from './team/TeamContext.jsx'
import { AccessProvider, useAccess } from './access/AccessContext.jsx'
import { navigate, parseHash } from './router.js'
import { THEMES, useTheme } from './theme.js'

// Six primary destinations plus Settings. Everything else is a tab inside one of them.
const NAV = [
  { id: 'home', label: 'Home', icon: 'dashboard' },
  { id: 'match-day', label: 'Match Day', icon: 'zap' },
  { id: 'intelligence', label: 'Intelligence', icon: 'clipboard' },
  { id: 'simulation', label: 'Simulation', icon: 'grid' },
  { id: 'development', label: 'Development', icon: 'wrench' },
  { id: 'rules', label: 'Rules', icon: 'book' }
]
const SETTINGS = { id: 'settings', label: 'Settings', icon: 'settings' }

const TITLES = {
  home: 'Home',
  'match-day': 'Match Day',
  intelligence: 'Intelligence',
  simulation: 'Simulation',
  development: 'Development',
  rules: 'Rules & Q&A',
  settings: 'Settings',
  chapter: 'Chapter',
  owner: 'Owner Control Center',
  view: 'Workspace inspection',
  public: 'Public statistics',
  welcome: 'Override Lab'
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

const PUBLIC_VIEWS = new Set(['welcome', 'public', 'rules'])

// Old bookmarks keep working. Every retired destination lands inside the workspace that now
// owns its functionality; nothing 404s and nothing silently becomes a dashboard.
const LEGACY = {
  dashboard: () => 'home',
  tournaments: () => 'match-day',
  'find-competition': () => 'match-day',
  competition: () => 'match-day',
  onsite: (sku) => `match-day${sku ? `?event=${sku}&tab=matches` : '?tab=matches'}`,
  start: () => 'match-day',
  scouting: (sku, q) => `intelligence?tab=teams${sku ? `&event=${sku}` : ''}`,
  alliance: (sku, q, opp) => `intelligence?tab=strategy${sku ? `&event=${sku}` : ''}${opp ? `&opp=${opp}` : ''}`,
  counter: (sku, q, opp) => `intelligence?tab=strategy${sku ? `&event=${sku}` : ''}${opp ? `&opp=${opp}` : ''}`,
  meta: (sku) => `intelligence?tab=analytics${sku ? `&event=${sku}` : ''}`,
  field: () => 'simulation?tab=field',
  simulator: () => 'simulation?tab=field',
  sim: () => 'simulation?tab=match',
  testing: () => 'development',
  autonomous: () => 'development',
  data: () => 'settings?tab=data',
  teams: () => 'settings?tab=access',
  settings: () => 'settings'
}

function NavLink({ item, active, collapsed, onClick, extra }) {
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
      {extra}
    </a>
  )
}

function ThemeMenu() {
  const [theme, setTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
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
      <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Colour theme: ${current.label}`} title={`Colour theme: ${current.label}`} onClick={() => setOpen((v) => !v)}>
        <Icon name={current.icon} size={17} />
      </button>
      {open && (
        <div className="theme-pop" role="menu">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''} onClick={() => { setTheme(t.id); setOpen(false) }}>
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

function Shell() {
  const { active, addTeam, hasTeams, teams, switchTeam } = useTeam()
  const { access, isOwner, isChapter, isTeam } = useAccess()
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
  const [storedEvent, setStoredEvent] = useState(readStoredEvent)
  const boundTeam = useRef(null)

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

  // A remembered team session opens its workspace without asking again. It never creates a
  // chapter or owner team binding.
  useEffect(() => {
    if (!isTeam || !access.team) return
    if (boundTeam.current === access.team) return
    boundTeam.current = access.team
    if (!teams.some((t) => t.number === access.team)) addTeam({ number: access.team, verified: false })
    else if (active?.number !== access.team) switchTeam(access.team)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeam, access.team])

  const { data: eventsData, loading: eventsLoading } = useApi(endpoints.events())
  const events = eventsData?.events || []
  const [evicted, setEvicted] = useState(false)

  const rawView = route.segs[0]
  const view = rawView && TITLES[rawView] ? rawView : rawView ? rawView : 'welcome'
  const known = Boolean(TITLES[view]) || view === 'public'
  const eventParam = route.q.get('event')
  const eventName = route.q.get('name') || storedEvent.name

  const sku =
    eventParam ||
    (['match-day', 'intelligence', 'simulation'].includes(view) ? route.segs[1] || storedEvent.sku : null) ||
    null

  // Legacy routes from the old 21-link navigation land on their new workspace.
  useEffect(() => {
    if (!rawView || known) return
    const map = LEGACY[rawView]
    if (map) {
      const target = map(sku, route.q, route.segs[2] || route.q.get('opp'))
      if (target) window.location.replace(`#/${target}`)
    }
  }, [rawView, known, sku, route.q, route.segs])

  useEffect(() => {
    if (!sku) return
    try {
      const existing = localStorage.getItem('override-lab:event')
      localStorage.setItem('override-lab:event', sku)
      if (eventName) localStorage.setItem('override-lab:event-name', eventName)
      if (existing !== sku) setStoredEvent({ sku, name: eventName })
    } catch {
      /* storage may be unavailable */
    }
  }, [sku, eventName])

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

  const currentTeam =
    route.q.get('own') ||
    (view === 'public' ? route.segs[1] : null) ||
    access.team ||
    active?.number ||
    null

  if (view === 'welcome' || (!hasTeams && !isTeam && !isChapter && !isOwner && !PUBLIC_VIEWS.has(view))) {
    return (
      <>
        <Landing
          onTeam={(record) => {
            addTeam(record)
            navigate('home')
          }}
        />
        <CommandPalette open={palette} onClose={() => setPalette(false)} events={events} />
      </>
    )
  }

  const title = view === 'public' ? 'Public statistics' : TITLES[view] || 'Override Lab'
  const showEventPicker = ['match-day', 'intelligence', 'simulation'].includes(view) && (events.length > 0 || sku)

  return (
    <div className={`app ${collapsed ? 'rail' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>

      {drawer && <button type="button" className="drawer-scrim" aria-label="Close navigation" onClick={() => setDrawer(false)} />}

      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-top">
          <a className="brand" href="#/home" onClick={(e) => { e.preventDefault(); go('home') }}>
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
          <div className="nav-group">
            <div className="nav-label">Workspace</div>
            {NAV.map((item) => (
              <NavLink key={item.id} item={item} active={view === item.id} collapsed={collapsed} onClick={go} />
            ))}
          </div>
          {(isChapter || isOwner) && (
            <div className="nav-group">
              <div className="nav-label">Access</div>
              {isChapter && <NavLink item={{ id: 'chapter', label: access.chapterName || 'Chapter', icon: 'users' }} active={view === 'chapter'} collapsed={collapsed} onClick={go} />}
              {isOwner && <NavLink item={{ id: 'owner', label: 'Owner', icon: 'settings' }} active={view === 'owner'} collapsed={collapsed} onClick={go} />}
            </div>
          )}
        </nav>

        <div className="sidebar-bottom">
          <NavLink item={SETTINGS} active={view === 'settings'} collapsed={collapsed} onClick={go} />
          <div className="sidebar-foot">Unofficial V5RC analysis · not affiliated with VEX or the REC Foundation.</div>
        </div>
      </aside>

      <div className="main">
        {isOwner && <div className="owner-bar"><Icon name="settings" size={14} /> Owner session — every workspace and administrative action is audited.</div>}
        {isTeam && (
          <div className="session-bar">
            <span><Icon name="users" size={14} /> <strong className="mono">{access.team}</strong> workspace · {(access.features || []).length} features</span>
            <button type="button" className="link tiny" onClick={() => go('settings?tab=access')}>Manage</button>
          </div>
        )}

        <header className="topbar">
          <button type="button" className="icon-btn mobile-only" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Icon name="menu" size={19} />
          </button>
          <div className="topbar-title">
            <div className="crumbs"><span>Override Lab</span></div>
            <h1>{title}</h1>
          </div>

          <div className="topbar-actions">
            <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Search tools, teams and events">
              <Icon name="search" size={16} />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>

            {showEventPicker && (
              <select
                className="event-select"
                value={sku || ''}
                onChange={(e) => {
                  const q = new URLSearchParams(route.q.toString())
                  if (e.target.value) q.set('event', e.target.value)
                  else q.delete('event')
                  go(`${view}?${q.toString()}`)
                }}
                aria-label="Selected tournament"
                title="Selected tournament"
              >
                <option value="">Choose event…</option>
                {sku && !events.some((e) => e.sku === sku) && <option value={sku}>{eventName || sku}</option>}
                {events.map((e) => <option key={e.sku} value={e.sku}>{e.name}</option>)}
              </select>
            )}
            <ThemeMenu />
          </div>
        </header>

        <main className="content" id="main-content">
          {view === 'home' && <Home />}
          {view === 'match-day' && <MatchDay query={route.q} sku={sku} activeTeam={currentTeam} go={go} eventName={eventName} />}
          {view === 'intelligence' && <Intelligence query={route.q} sku={sku} activeTeam={currentTeam} />}
          {view === 'simulation' && <Simulation query={route.q} sku={sku} />}
          {view === 'development' && <Testing />}
          {view === 'rules' && <Rules />}
          {view === 'settings' && <Settings query={route.q} />}
          {view === 'chapter' && <Chapter />}
          {view === 'owner' && <Owner />}
          {view === 'view' && <OwnerViewTeam team={route.segs[1]} />}
          {view === 'public' && <PublicTeam team={route.segs[1] || route.q.get('team')} />}
          {!known && !LEGACY[rawView] && (
            <Empty>
              That page no longer exists. <button type="button" className="link" onClick={() => go('home')}>Go to Home</button>.
            </Empty>
          )}
        </main>

        <nav className="mobile-bar" aria-label="Primary mobile navigation">
          {[
            { id: 'home', label: 'Home', icon: 'dashboard' },
            { id: 'match-day', label: 'Match day', icon: 'zap' },
            { id: 'intelligence', label: 'Intel', icon: 'clipboard' },
            { id: 'simulation', label: 'Sim', icon: 'grid' }
          ].map((item) => (
            <button key={item.id} type="button" className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
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
    <AccessProvider>
      <TeamProvider>
        <Shell />
      </TeamProvider>
    </AccessProvider>
  )
}
