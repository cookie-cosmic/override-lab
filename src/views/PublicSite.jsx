import React, { useMemo, useRef, useState } from 'react'
import { endpoints, useApi } from '../api.js'
import { useAccess } from '../access/AccessContext.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { routeForAccess } from './AccessPages.jsx'
import PublicTeam from './PublicTeam.jsx'
import FieldMotion from '../components/FieldMotion.jsx'
import { BrandMark } from '../components/Brand.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import { Btn, Empty, Table } from '../components/ui.jsx'

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'teams', label: 'Teams' },
  { id: 'competitions', label: 'Competitions' },
  { id: 'rules', label: 'Rules' }
]

const RECENT_KEY = 'override-lab:recent-teams'
const teamNumber = (value) => String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
const looksLikeTeam = (value) => /^[0-9]{1,5}[A-Z]?$/.test(teamNumber(value))

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && looksLikeTeam(x)).slice(0, 5) : []
  } catch {
    return []
  }
}

function rememberTeam(number) {
  const next = [number, ...readRecent().filter((x) => x !== number)].slice(0, 5)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage is optional; the search still works */
  }
  return next
}

/** Minimal public chrome: brand, season, four destinations and the appearance control. */
export function PublicHeader({ view, children }) {
  const { access } = useAccess()
  const [open, setOpen] = useState(false)
  const season = access?.season?.name || 'V5RC 2026–27'
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <a className="public-brand" href="#/home" aria-label="Override Lab home">
          <BrandMark size={34} />
          <span className="public-brand-text">
            <span className="public-wordmark">Override Lab</span>
            <span className="public-season">{season}</span>
          </span>
        </a>

        <nav className={`public-nav ${open ? 'open' : ''}`} aria-label="Public">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              className={view === item.id ? 'active' : ''}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="public-header-actions">
          {children}
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'x' : 'menu'} size={19} />
          </button>
        </div>
      </div>
    </header>
  )
}

export function PublicFooter() {
  const { access } = useAccess()
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        <div>
          <div className="footer-brand">
            <BrandMark size={26} />
            <strong>Override Lab</strong>
          </div>
          <p className="tiny dim" style={{ margin: '8px 0 0', maxWidth: '34ch' }}>
            Competition intelligence for VEX V5RC teams, mentors and event staff.
          </p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <a href="#/teams">Team statistics</a>
          <a href="#/competitions">Competitions</a>
          <a href="#/rules">Rules &amp; Q&amp;A</a>
          <a href="#/home">Home</a>
        </nav>
        <p className="footer-meta">
          {access?.season?.name || '2026–2027 Override Season'} · Unofficial analysis, not affiliated with VEX or the REC
          Foundation. Results are published by RobotEvents.
        </p>
      </div>
    </footer>
  )
}

/** Public landing: one search, three signposts, one chapter code field. */
export function PublicHome() {
  const { access } = useAccess()
  const [team, setTeam] = useState('')
  const [result, setResult] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const [recents, setRecents] = useState(readRecent)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef(null)

  const season = access?.season?.name || '2026–27 V5RC'
  const showRecents = open && recents.length > 0

  const submit = (value) => {
    const next = teamNumber(value ?? team)
    if (!looksLikeTeam(next)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setOpen(false)
    setActive(-1)
    setTeam(next)
    setResult(next)
    setRecents(rememberTeam(next))
  }

  const onKeyDown = (e) => {
    if (!showRecents) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(recents.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      submit(recents[active])
      setActive(-1)
    }
  }

  return (
    <div className="public-page">
      <section className="hero-split">
        <div className="hero-copy">
          <span className="hero-season">
            <span className="dot" aria-hidden="true" />
            {season} · Built for competitive robotics
          </span>
          <h1 className="hero-title">
            Play smarter.
            <br />
            <span className="hero-accent">Compete with an edge.</span>
          </h1>
          <p className="hero-lede">
            Your robotics season, connected through data. Explore VEX V5RC team performance, tournament results, rankings
            and competition statistics.
          </p>

          <form
            className="search-shell"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <span className="search-ico" aria-hidden="true"><Icon name="search" size={17} /></span>
            <label className="sr-only" htmlFor="public-team-search">Team number</label>
            <input
              id="public-team-search"
              value={team}
              onChange={(e) => {
                setTeam(teamNumber(e.target.value).slice(0, 6))
                setInvalid(false)
                setOpen(true)
              }}
              onFocus={() => {
                clearTimeout(blurTimer.current)
                setOpen(true)
              }}
              onBlur={() => {
                blurTimer.current = setTimeout(() => setOpen(false), 120)
              }}
              onKeyDown={onKeyDown}
              placeholder="Enter a team number"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="public-team-caption"
              aria-invalid={invalid}
            />
            <Btn type="submit" variant="primary" disabled={!looksLikeTeam(team)}>Search</Btn>

            {showRecents && (
              <div className="search-recent" role="listbox" aria-label="Recent teams">
                <div className="sr-head">Recent teams</div>
                {recents.map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    role="option"
                    aria-selected={active === i}
                    data-active={active === i}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => submit(r)}
                  >
                    <Icon name="clipboard" size={14} />
                    <span className="mono">{r}</span>
                    <span className="spacer" />
                    <span className="tiny dim">public statistics</span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <span className="hero-caption" id="public-team-caption">
            {invalid ? 'Enter a team number, such as 1234A.' : 'Explore any V5RC team. No account required.'}
          </span>

          <div className="hero-chips">
            <span className="chip">Official results</span>
            <span className="chip">No account</span>
            <span className="chip">RobotEvents data</span>
          </div>
        </div>

        <FieldMotion />
      </section>

      {result && (
        <section className="page-enter" aria-live="polite" style={{ marginTop: 8 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Team {result}</h2>
            <span className="spacer" />
            <Btn size="sm" variant="ghost" onClick={() => setResult(null)}>Clear</Btn>
          </div>
          <PublicTeam team={result} />
        </section>
      )}

      <section className="feature-strip" aria-label="Public tools">
        <a className="feature-card" href="#/teams">
          <span className="fc-icon"><Icon name="clipboard" size={19} /></span>
          <h3>Team Statistics</h3>
          <p>Records, win rates, average alliance scores and recent form for any team number.</p>
        </a>
        <a className="feature-card" href="#/competitions">
          <span className="fc-icon"><Icon name="trophy" size={19} /></span>
          <h3>Competitions</h3>
          <p>Tournaments on the current season calendar, with dates and official results.</p>
        </a>
        <div className="feature-card is-static">
          <span className="fc-icon"><Icon name="zap" size={19} /></span>
          <h3>Robot Skills</h3>
          <p>Driver and programming skills runs count toward a team&apos;s official season record. Skills detail is not part of the public team page.</p>
        </div>
      </section>

      <section className="chapter-band" id="chapter">
        <div className="chapter-band-copy">
          <span className="cb-icon" aria-hidden="true"><Icon name="users" size={17} /></span>
          <div>
            <h2>Chapter access</h2>
            <p>
              Connect to your robotics chapter. Sign in once to see your chapter&apos;s teams, their official results,
              and which workspaces are ready.
            </p>
          </div>
        </div>
        <div>
          <AccessForm compact initialMode="chapter" onDone={routeForAccess} />
          <p className="chapter-foot" style={{ marginTop: 10 }}>
            Contact your chapter coordinator if you need access.
          </p>
        </div>
      </section>
    </div>
  )
}

/** Public team search page. */
export function PublicTeams({ query }) {
  const [team, setTeam] = useState(query?.get('team') || '')
  const [result, setResult] = useState(query?.get('team') || null)

  return (
    <div className="public-page" style={{ paddingTop: 40 }}>
      <div className="landing-hero" style={{ padding: 0, marginBottom: 26 }}>
        <span className="hero-eyebrow">Team statistics</span>
        <h1 style={{ fontSize: 'var(--fs-title)' }}>Look up any team.</h1>
        <p className="hero-sub" style={{ marginBottom: 20 }}>
          Official match results and descriptive statistics, published by RobotEvents. No account required.
        </p>
        <form
          className="search-shell"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            const next = teamNumber(team)
            setResult(looksLikeTeam(next) ? next : null)
            if (looksLikeTeam(next)) rememberTeam(next)
          }}
        >
          <span className="search-ico" aria-hidden="true"><Icon name="search" size={17} /></span>
          <label className="sr-only" htmlFor="teams-page-search">Team number</label>
          <input
            id="teams-page-search"
            value={team}
            onChange={(e) => setTeam(teamNumber(e.target.value).slice(0, 6))}
            placeholder="Enter a team number"
            autoComplete="off"
            spellCheck={false}
          />
          <Btn type="submit" variant="primary" disabled={!looksLikeTeam(team)}>Search</Btn>
        </form>
      </div>

      {result ? (
        <div className="page-enter">
          <PublicTeam team={result} />
        </div>
      ) : (
        <div className="note">
          Enter a team number to see its record, average alliance score, tournaments and recent form.
        </div>
      )}
    </div>
  )
}

/** Public competition calendar. */
export function PublicCompetitions() {
  const { data, error, loading } = useApi(endpoints.events())
  const events = useMemo(() => data?.events || [], [data])

  return (
    <div className="public-page" style={{ paddingTop: 40 }}>
      <div style={{ marginBottom: 20 }}>
        <span className="hero-eyebrow">Competitions</span>
        <h1 style={{ fontSize: 'var(--fs-title)', margin: '0 0 8px' }}>This season&apos;s events.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: '62ch' }}>
          Events with published results. Choose a team number on the Teams page to read how a team performed at any of
          them.
        </p>
      </div>

      {loading && <div className="skeleton-block" aria-busy="true">Loading the event calendar…</div>}
      {error && (
        <div className="note bad">The event calendar is unavailable right now. Public team statistics still work.</div>
      )}
      {!loading && !error && (
        <div className="card">
          <div className="card-b flush">
            <Table head={['Event', 'Code', 'Starts', '']}>
              {events.map((e) => (
                <tr key={e.sku}>
                  <td>{e.name || e.sku}</td>
                  <td className="mono tiny">{e.sku}</td>
                  <td className="tiny dim">{e.start ? new Date(e.start).toLocaleDateString() : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Btn size="sm" variant="ghost" onClick={() => navigate('teams')}>Find a team</Btn>
                  </td>
                </tr>
              ))}
            </Table>
            {!events.length && <Empty>No events are published for this season yet.</Empty>}
          </div>
        </div>
      )}
    </div>
  )
}
