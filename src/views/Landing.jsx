import React from 'react'
import TeamLookup from '../components/TeamLookup.jsx'
import Icon from '../components/Icons.jsx'
import { useTeam } from '../team/TeamContext.jsx'
import { navigate } from '../router.js'
import { THEMES, useTheme } from '../theme.js'
import { Btn, Card } from '../components/ui.jsx'
import { AccessForm } from './AccessPanel.jsx'

const FEATURES = [
  {
    icon: 'trophy',
    title: 'Tournament Intelligence',
    text: 'Official results, rankings, skills, eliminations and match history for the team you follow.'
  },
  {
    icon: 'zap',
    title: 'Competition Day',
    text: 'Your next match, alliance partner, opponents and current standing — built for standing at the field.'
  },
  {
    icon: 'clipboard',
    title: 'Match Scouting',
    text: 'Record what you actually saw, then turn observations into team profiles and opponent counters.'
  },
  {
    icon: 'users',
    title: 'Alliance Strategy',
    text: 'Partner fit, role division and 2v2 estimates from scored matches, with the method shown.'
  },
  {
    icon: 'grid',
    title: 'Field Simulator',
    text: 'Place pins and cups, set toggles, park robots and score any Override end state with the manual rules.'
  },
  {
    icon: 'wrench',
    title: 'Robot Testing',
    text: 'Log practice trials, compare robot versions and track cycle time and reliability over time.'
  },
  {
    icon: 'book',
    title: 'Rules & Q&A',
    text: 'Search scoring definitions, the manual and official Q&A without inventing referee rulings.'
  }
]

const STEPS = [
  ['01', 'Enter your number', 'Any V5RC team — 75019D, 37S, 1234A. Case and spacing do not matter.'],
  ['02', 'Confirm the official record', 'Name, organisation, location and this season’s events come from RobotEvents, not from a guess.'],
  ['03', 'Work in your own context', 'Every tool follows the active team. Save several teams and switch without losing work.']
]

/** A labelled illustration of the real dashboard, never passed off as live results. */
function PreviewCard() {
  return (
    <div className="preview-wrap" aria-label="Illustrative dashboard preview">
      <div className="preview-card">
        <div className="preview-top">
          <div className="preview-id">
            <span className="preview-mark">D</span>
            <div>
              <strong>75019D · Paradigm</strong>
              <span className="tiny dim">Coppell High School · Texas</span>
            </div>
          </div>
          <span className="preview-tag">DEMO</span>
        </div>

        <div className="preview-stats">
          <div><span>Record</span><strong>4–3–1</strong></div>
          <div><span>Avg alliance</span><strong>38.5</strong></div>
          <div><span>Adj. win rate</span><strong>56%</strong></div>
        </div>

        <div className="preview-chart">
          {[34, 48, 22, 61, 40, 54, 30, 47].map((h, i) => (
            <span key={i} style={{ height: `${h + 18}%` }} className={i === 6 ? 'loss' : 'win'} />
          ))}
        </div>

        <div className="preview-next">
          <span className="tiny dim">Next registered event</span>
          <strong>A Very Vex-mas Tournament</strong>
          <span className="tiny dim">Dec 18, 2026 · Blended</span>
        </div>

        <div className="preview-foot">
          <Icon name="clipboard" size={13} /> Scouting coverage: 6 opponents · <Icon name="wrench" size={13} /> 4 test sessions
        </div>
      </div>
      <div className="preview-glow" aria-hidden="true" />
      <p className="preview-note">Illustration with sample values · your dashboard uses official data for your team</p>
    </div>
  )
}

export default function Landing({ onTeam }) {
  const { hasTeams, teams, active } = useTeam()
  const [theme, setTheme] = useTheme()

  const open = () => navigate(hasTeams ? 'dashboard' : 'welcome')

  return (
    <div className="landing">
      <header className="landing-head">
        <a className="landing-brand" href="#/welcome" onClick={(e) => { e.preventDefault(); navigate('welcome') }}>
          <span className="brand-mark">OL</span>
          <span>
            <strong>Override Lab</strong>
            <span className="dim"> · VEX V5RC 2026–27</span>
          </span>
        </a>
        <nav className="landing-nav" aria-label="Site">
          <a href="#welcome-features">Tools</a>
          <a href="#welcome-how">How it works</a>
          {hasTeams ? (
            <Btn size="sm" variant="primary" onClick={open}>
              Open dashboard
            </Btn>
          ) : (
            <Btn size="sm" onClick={() => document.querySelector('.hero .lookup-bar input')?.focus()}>
              Enter team
            </Btn>
          )}
          <div className="theme-switch landing-theme" role="group" aria-label="Colour theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-opt ${theme === t.id ? 'active' : ''}`}
                aria-pressed={theme === t.id}
                title={`${t.label} theme`}
                onClick={() => setTheme(t.id)}
              >
                <Icon name={t.icon} size={14} />
                <span className="theme-label">{t.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Override Lab · VEX V5 Robotics Competition · Override</span>
          <h1>Your competitive edge.</h1>
          <p className="hero-sub">
            Explore VEX V5RC competition statistics, tournament results, rankings, and team performance — then open
            your team&apos;s private strategy workspace.
          </p>
          <TeamLookup cta="Find my team →" onConfirmed={onTeam} />
          {hasTeams && (
            <div className="hero-return">
              Returning?{' '}
              <button type="button" onClick={open}>
                Continue with {active?.number || teams[0]?.number}
              </button>
            </div>
          )}
        </div>

        <PreviewCard />
      </section>

      <section className="landing-section" id="welcome-access">
        <div className="section-head">
          <h2>Public statistics, or your team workspace</h2>
          <p>Searching a team number is always public. Private tools need a chapter and a team credential.</p>
        </div>
        <div className="access-split">
          <Card title="Chapter access" subtitle="for coordinators and their teams">
            <p className="tiny dim">
              Chapter access codes are issued by an authorised coordinator. A chapter code opens the chapter dashboard;
              each team&apos;s private workspace still needs that team&apos;s own PIN.
            </p>
            <AccessForm compact onDone={() => window.location.reload()} />
          </Card>
          <Card title="Public visitor" subtitle="no account required">
            <p className="tiny dim">
              Anyone can search a team and read its official record: results, rankings, skills, awards and event history.
              No sign-in, chapter code or team PIN is needed for that.
            </p>
            <Btn variant="primary" size="sm" onClick={() => document.querySelector('.hero .lookup-bar input')?.focus()}>
              Search a team number
            </Btn>
          </Card>
        </div>
      </section>

      <section className="landing-section" id="welcome-features">
        <div className="section-head">
          <h2>Your Competition Toolkit</h2>
          <p>Every tool automatically adapts to your VEX team.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <article className="feature" key={f.title}>
              <span className="feature-icon" aria-hidden="true"><Icon name={f.icon} size={18} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="welcome-how">
        <div className="section-head">
          <h2>How personalisation works</h2>
          <p>The team number is a lens on public data, not a key to someone else&apos;s private records.</p>
        </div>
        <div className="step-grid">
          {STEPS.map(([n, title, text]) => (
            <div className="step" key={n}>
              <span className="step-n">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <div className="privacy-note">
          <strong>Private work stays private.</strong> Entering a team number never grants access to that team&apos;s
          workspace. Strategic tools are enforced on the server: your device holds a revocable session, never a stored
          PIN, and one team cannot read another team&apos;s records by changing a number in the URL.
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <h2>Start with your team number</h2>
          <p>One number, every tool. Add more teams later and switch between them at any time.</p>
        </div>
        {hasTeams ? (
          <Btn variant="primary" onClick={open}>Open dashboard</Btn>
        ) : (
          <Btn variant="primary" onClick={() => document.querySelector('.hero .lookup-bar input')?.focus()}>
            Find my team
          </Btn>
        )}
      </section>

      <footer className="landing-foot">
        <div>
          <strong>Override Lab</strong>
          <span className="dim"> · unofficial VEX V5RC analysis</span>
          <p className="tiny dim">
            Not affiliated with or endorsed by VEX Robotics or the REC Foundation. Model estimates are labelled;
            official results link back to their source.
          </p>
        </div>
        <div className="foot-links">
          <a href="https://events.vex.com" target="_blank" rel="noreferrer">VEX Events</a>
          <a href="https://manuals.vex.com" target="_blank" rel="noreferrer">Game manuals</a>
          <a href="https://www.robotevents.com" target="_blank" rel="noreferrer">RobotEvents</a>
          <a href="#/welcome" onClick={(e) => { e.preventDefault(); navigate('welcome') }}>Landing page</a>
        </div>
      </footer>
    </div>
  )
}
