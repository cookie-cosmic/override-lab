import React, { useState } from 'react'
import { endpoints, useApi } from '../api.js'
import { useAccess } from '../access/AccessContext.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { routeForAccess } from './AccessPages.jsx'
import PublicTeam from './PublicTeam.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import { Btn, Empty, Table } from '../components/ui.jsx'

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'teams', label: 'Teams' },
  { id: 'competitions', label: 'Competitions' },
  { id: 'rules', label: 'Rules' }
]

const teamNumber = (value) => String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
const looksLikeTeam = (value) => /^[0-9]{1,5}[A-Z]?$/.test(teamNumber(value))

/** Minimal public chrome: brand, season, four destinations and the appearance control. */
export function PublicHeader({ view, children }) {
  const { access } = useAccess()
  const [open, setOpen] = useState(false)
  const season = access?.season?.name || 'V5RC 2026–27'
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <a className="public-brand" href="#/home" aria-label="Override Lab home">
          <span className="brand-mark" aria-hidden="true">OL</span>
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
            <span className="brand-mark" aria-hidden="true">OL</span>
            <strong>Override Lab</strong>
          </div>
          <p className="tiny dim" style={{ margin: '8px 0 0', maxWidth: '34ch' }}>
            Public VEX V5RC statistics for teams, mentors and event staff.
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
          Foundation. Team results are published by RobotEvents.
        </p>
      </div>
    </footer>
  )
}

function TeamSearch({ value, onChange, onSubmit, cta = 'Search' }) {
  return (
    <form
      className="public-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="sr-only" htmlFor="public-team-search">
        Team number
      </label>
      <input
        id="public-team-search"
        value={value}
        onChange={(e) => onChange(teamNumber(e.target.value).slice(0, 6))}
        placeholder="Team number"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="public-team-caption"
      />
      <Btn type="submit" variant="primary" disabled={!looksLikeTeam(value)}>
        {cta}
      </Btn>
    </form>
  )
}

/** The public landing page: one search, three signposts, one chapter code field. */
export function PublicHome() {
  const [team, setTeam] = useState('')
  const [result, setResult] = useState(null)
  const [invalid, setInvalid] = useState(false)

  const search = () => {
    const next = teamNumber(team)
    if (!looksLikeTeam(next)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setResult(next)
  }

  return (
    <div className="public-page">
      <section className="landing-hero">
        <span className="hero-eyebrow">Built for competitive robotics</span>
        <h1>Your competitive edge.</h1>
        <p className="hero-sub">
          Explore VEX V5RC team performance, tournament results, rankings, and competition statistics.
        </p>
        <TeamSearch
          value={team}
          onChange={(v) => {
            setTeam(v)
            setInvalid(false)
          }}
          onSubmit={search}
        />
        <span className="hero-caption" id="public-team-caption">
          {invalid ? 'Enter a team number, such as 1234A.' : 'Explore any V5RC team. No account required.'}
        </span>
      </section>

      {result && (
        <section aria-live="polite" style={{ marginBottom: 8 }}>
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
        <div>
          <h2>Chapter access</h2>
          <p>
            Connect to your robotics chapter. Sign in once to see your chapter&apos;s teams, their official results, and
            which workspaces are ready.
          </p>
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
        <TeamSearch
          value={team}
          onChange={setTeam}
          onSubmit={() => (looksLikeTeam(team) ? setResult(teamNumber(team)) : setResult(null))}
        />
      </div>

      {result ? (
        <PublicTeam team={result} />
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
  const events = data?.events || []

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
        <div className="note bad">
          The event calendar is unavailable right now. Public team statistics still work.
        </div>
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
