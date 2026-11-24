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
import { PublicHeader, PublicFooter, PublicHome, PublicTeams, PublicCompetitions } from './views/PublicSite.jsx'
import { ChapterLogin, TeamLogin, ChapterAdmin } from './views/AccessPages.jsx'
import { Btn, Empty } from './components/ui.jsx'
import Icon from './components/Icons.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import { BrandMark } from './components/Brand.jsx'
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
  'chapter-login': 'Chapter sign-in',
  'team-login': 'Team sign-in',
  'chapter-admin': 'Chapter administration',
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
  // Public destinations remain reachable from a signed-in session.
  competitions: () => 'match-day',
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
  const { access, isOwner, isChapter, isTeam, leaveTeam } = useAccess()
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
  // The active-page indicator is one element that travels between destinations rather than a
  // background that blinks on and off.
  const navRef = useRef(null)
  const [ink, setInk] = useState({ top: 0, height: 0, show: false })

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
  // The public home is the default screen, not a sign-in wall.
  const view = rawView || 'home'
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

  // Which experience this device is in. Navigation, page chrome and available routes follow it.
  const mode = isOwner ? 'owner' : isTeam ? 'team' : isChapter ? 'chapter' : 'public'

  useEffect(() => {
    const nav = navRef.current
    if (!nav) {
      setInk((i) => (i.show ? { ...i, show: false } : i))
      return
    }
    const activeLink = nav.querySelector('.nav-link.active')
    if (!activeLink) {
      setInk((i) => (i.show ? { ...i, show: false } : i))
      return
    }
    const navBox = nav.getBoundingClientRect()
    const linkBox = activeLink.getBoundingClientRect()
    setInk({ top: linkBox.top - navBox.top, height: linkBox.height, show: true })
  }, [view, mode, collapsed, isChapter, isOwner, route.q.toString()])

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

  // The marketing page stays reachable at #/welcome, but it no longer gates the app: the home
  // screen is public statistics with the access codes further down.
  if (view === 'welcome') {
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

  // Public visitors get a marketing shell with no workspace sidebar. Private routes resolve to
  // an explanation instead of rendering a locked copy of the app.
  if (mode === 'public') {
    const publicViews = ['home', 'teams', 'competitions', 'public', 'rules', 'chapter-login', 'team-login', 'chapter']
    return (
      <div className="app mode-public">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <PublicHeader view={view}>
          <ThemeMenu />
        </PublicHeader>
        <main className="content page-enter" id="main-content" key={view}>
          {view === 'home' && <PublicHome />}
          {view === 'teams' && <PublicTeams query={route.q} />}
          {view === 'competitions' && <PublicCompetitions />}
          {view === 'public' && (
            <div className="public-page" style={{ paddingTop: 36 }}>
              <PublicTeam team={route.segs[1] || route.q.get('team')} />
            </div>
          )}
          {view === 'rules' && (
            <div className="public-page" style={{ paddingTop: 36 }}>
              <Rules />
            </div>
          )}
          {view === 'chapter-login' && (
            <div className="public-page" style={{ paddingTop: 24 }}><ChapterLogin /></div>
          )}
          {view === 'team-login' && (
            <div className="public-page" style={{ paddingTop: 24 }}><TeamLogin query={route.q} /></div>
          )}
          {view === 'chapter' && (
            <div className="public-page" style={{ paddingTop: 36 }}>
              <Chapter query={route.q} />
            </div>
          )}
          {!publicViews.includes(view) && (
            <div className="public-page" style={{ paddingTop: 48 }}>
              <h1 style={{ fontSize: 'var(--fs-title)', margin: '0 0 8px' }}>Sign in to continue</h1>
              <p className="muted" style={{ maxWidth: '52ch' }}>
                This workspace is available to chapter and team members. Enter your chapter access code to begin.
              </p>
              <Btn variant="primary" onClick={() => go('home')}>Back to the homepage</Btn>
            </div>
          )}
        </main>
        <PublicFooter />
        <CommandPalette open={palette} onClose={() => setPalette(false)} events={events} />
      </div>
    )
  }

  const title =
    mode === 'chapter'
      ? access.chapterName || 'Chapter'
      : view === 'public'
        ? 'Public statistics'
        : TITLES[view] || 'Override Lab'
  const showEventPicker =
    mode !== 'chapter' && ['match-day', 'intelligence', 'simulation'].includes(view) && (events.length > 0 || sku)

  return (
    <div className={`app mode-${mode} ${collapsed ? 'rail' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>

      {drawer && <button type="button" className="drawer-scrim" aria-label="Close navigation" onClick={() => setDrawer(false)} />}

      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-top">
          <a className="brand" href="#/home" onClick={(e) => { e.preventDefault(); go('home') }}>
            <BrandMark size={32} />
            <span className="brand-text">
              <span className="brand-name">Override Lab</span>
              <span className="brand-sub">Competition intelligence</span>
            </span>
          </a>
          <button type="button" className="icon-btn rail-toggle" onClick={setSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name="panel" size={17} />
          </button>
        </div>

        {mode !== 'chapter' && <TeamSwitcher className={collapsed ? 'is-collapsed' : ''} />}

        <nav className="nav" aria-label="Main navigation" ref={navRef}>
          {ink.show && (
            <span className="nav-indicator" aria-hidden="true" style={{ transform: `translateY(${ink.top}px)`, height: ink.height, opacity: 1 }} />
          )}
          {mode === 'chapter' ? (
            <div className="nav-group">
              <div className="nav-label">Chapter</div>
              <NavLink
                item={{ id: 'chapter', label: 'Teams', icon: 'users' }}
                active={view === 'chapter' && route.q.get('tab') !== 'codes'}
                collapsed={collapsed}
                onClick={() => go('chapter')}
              />
              <NavLink
                item={{ id: 'chapter?tab=codes', label: 'Access Codes', icon: 'clipboard' }}
                active={view === 'chapter' && route.q.get('tab') === 'codes'}
                collapsed={collapsed}
                onClick={() => go('chapter?tab=codes')}
              />
            </div>
          ) : (
            <div className="nav-group">
              <div className="nav-label">Workspace</div>
              {NAV.map((item) => (
                <NavLink key={item.id} item={item} active={view === item.id} collapsed={collapsed} onClick={go} />
              ))}
              {isTeam && access.viaChapter && (
                <button
                  type="button"
                  className="nav-link"
                  onClick={async () => {
                    await leaveTeam()
                    go('chapter')
                  }}
                >
                  <span className="nav-ico"><Icon name="users" size={18} /></span>
                  <span className="nav-text">Chapter</span>
                </button>
              )}
            </div>
          )}
          {isOwner && (
            <div className="nav-group">
              <div className="nav-label">Access</div>
              <NavLink item={{ id: 'owner', label: 'Owner', icon: 'settings' }} active={view === 'owner'} collapsed={collapsed} onClick={go} />
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

        <main className="content page-enter" id="main-content" key={view}>
          {view === 'home' && (isChapter && !isTeam ? <Chapter query={route.q} /> : <Home query={route.q} />)}
          {view === 'chapter-login' && <ChapterLogin />}
          {view === 'team-login' && <TeamLogin query={route.q} />}
          {view === 'chapter-admin' && <ChapterAdmin />}
          {view === 'match-day' && <MatchDay query={route.q} sku={sku} activeTeam={currentTeam} go={go} eventName={eventName} />}
          {view === 'intelligence' && <Intelligence query={route.q} sku={sku} activeTeam={currentTeam} />}
          {view === 'simulation' && <Simulation query={route.q} sku={sku} />}
          {view === 'development' && <Testing />}
          {view === 'rules' && <Rules />}
          {view === 'settings' && <Settings query={route.q} />}
          {view === 'chapter' && <Chapter query={route.q} />}
          {view === 'owner' && <Owner />}
          {view === 'view' && <OwnerViewTeam team={route.segs[1]} />}
          {view === 'public' && <PublicTeam team={route.segs[1] || route.q.get('team')} />}
          {!known && !LEGACY[rawView] && (
            <Empty>
              That page no longer exists. <button type="button" className="link" onClick={() => go('home')}>Go to Home</button>.
            </Empty>
          )}
        </main>

        {mode !== 'chapter' && (<nav className="mobile-bar" aria-label="Primary mobile navigation">
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
        </nav>)}
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
