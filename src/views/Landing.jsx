import React from 'react'
import TeamLookup from '../components/TeamLookup.jsx'
import { useTeam } from '../team/TeamContext.jsx'
import { navigate } from '../router.js'
import { THEMES, useTheme } from '../theme.js'
import { Btn } from '../components/ui.jsx'

const FEATURES = [
  {
    icon: '◎',
    title: 'Tournament command centre',
    text: 'Real 2026–27 results, rankings, qualification record, eliminations and skills for the team you follow.'
  },
  {
    icon: '⌖',
    title: 'Scouting workspace',
    text: 'Record intake, pin handling, toggle control and cycle times — per team, event and scout.'
  },
  {
    icon: '⇄',
    title: 'Alliance analysis',
    text: 'Explainable compatibility, role division and 2v2 estimates built from scored matches, not guesses.'
  },
  {
    icon: '▩',
    title: 'Override field simulator',
    text: 'Place pins and cups, set toggles, park robots and see both alliance scores update with the manual rules.'
  },
  {
    icon: '⟜',
    title: 'Autonomous planner',
    text: 'Lay out waypoints and actions on the field, estimate the 15-second window and check AWP requirements.'
  },
  {
    icon: '◍',
    title: 'Robot testing log',
    text: 'Log trials, compare configurations and watch cycle time and reliability across sessions.'
  },
  {
    icon: '¶',
    title: 'Rules & Q&A',
    text: 'Search the scoring definitions and official sources without inventing referee rulings.'
  }
]

const STEPS = [
  ['01', 'Enter your number', 'Any V5RC team — 75019D, 37S, 1234A. Case and spacing do not matter.'],
  ['02', 'Confirm the official record', 'Name, organisation, location and this season’s events come from RobotEvents, not from a guess.'],
  ['03', 'Work in your own context', 'Every tool follows the active team. Save several teams and switch without losing work.']
]

export default function Landing({ onTeam }) {
  const { hasTeams, teams, active } = useTeam()
  const [theme, setTheme] = useTheme()

  const open = () => navigate(hasTeams ? 'dashboard' : 'welcome')

  return (
    <div className="landing">
      <header className="landing-head">
        <a className="landing-brand" href="#/welcome" onClick={(e) => { e.preventDefault(); navigate('welcome') }}>
          <span className="brand-mark">V5</span>
          <span>
            <strong>Override Lab</strong>
            <span className="dim"> · VEX V5RC 2026–27</span>
          </span>
        </a>
        <nav className="landing-nav" aria-label="Site">
          <a href="#welcome-features">Features</a>
          <a href="#welcome-data">Data</a>
          <a href="#welcome-how">Personalisation</a>
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
                <span className={`swatch ${t.id}`} />
              </button>
            ))}
          </div>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">VEX V5 Robotics Competition · Override</span>
          <h1>OVERRIDE LAB</h1>
          <p className="hero-sub">Your Team. Your Strategy. Your Competitive Edge.</p>
          <p className="hero-desc">
            Analyze tournaments, scout opponents, predict alliances, simulate Override strategies, and take your VEX
            V5RC team to the next level.
          </p>
          <TeamLookup
            cta="Launch my dashboard →"
            onConfirmed={onTeam}
          />
          {hasTeams && (
            <div className="hero-return">
              Returning?{' '}
              <button type="button" onClick={open}>
                Continue with {active?.number || teams[0]?.number}
              </button>
            </div>
          )}
          <div className="hero-facts">
            <span><strong>9</strong> goals</span>
            <span><strong>4</strong> toggles</span>
            <span><strong>15s</strong> autonomous</span>
            <span><strong>1:45</strong> driver</span>
            <span><strong>12</strong> auto bonus</span>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="hv-card">
            <div className="hv-head">
              <span className="hv-dot red" /> <span className="hv-dot blue" /> <span className="dim tiny">match preview</span>
            </div>
            <div className="hv-score">
              <span className="red">86</span>
              <span className="dim">–</span>
              <span className="blue">79</span>
            </div>
            <div className="hv-bars">
              {[62, 78, 54, 88, 70, 94, 66, 81].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} className={i % 2 ? 'blue' : 'red'} />
              ))}
            </div>
            <div className="hv-foot tiny dim">Illustrative index · not live data</div>
          </div>
          <svg className="hv-field" viewBox="0 0 220 220" role="img" aria-label="Stylised Override field">
            <rect x="2" y="2" width="216" height="216" rx="10" className="field-bg" />
            <line x1="2" y1="2" x2="218" y2="218" className="field-line" />
            <line x1="218" y1="2" x2="2" y2="218" className="field-line" />
            <circle cx="110" cy="110" r="34" className="field-mid" />
            <circle cx="110" cy="110" r="9" className="goal tall" />
            <circle cx="56" cy="72" r="8" className="goal red-g" />
            <circle cx="72" cy="56" r="8" className="goal red-g" />
            <circle cx="164" cy="148" r="8" className="goal blue-g" />
            <circle cx="148" cy="164" r="8" className="goal blue-g" />
            <circle cx="56" cy="56" r="6" className="goal n" />
            <circle cx="164" cy="164" r="6" className="goal n" />
            <circle cx="164" cy="56" r="6" className="goal n" />
            <circle cx="56" cy="164" r="6" className="goal n" />
          </svg>
        </div>
      </section>

      <section className="landing-section" id="welcome-features">
        <div className="section-head">
          <h2>Seven tools, one team context</h2>
          <p>Everything below follows the team you select. Nothing is hardcoded to a single program.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <article className="feature" key={f.title}>
              <span className="feature-icon" aria-hidden="true">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section previews" id="welcome-data">
        <div className="section-head">
          <h2>Built around real Override data</h2>
          <p>
            Results come from the VEX Events API. Anything computed — ratings, compatibility, estimates — is labelled
            with its method and sample size.
          </p>
        </div>
        <div className="preview-grid">
          <article className="preview">
            <div className="preview-label">Example layout · not live data</div>
            <h3>Tournament analytics</h3>
            <div className="mini-kpis">
              <span><strong>6–2–0</strong> qualification</span>
              <span><strong>3rd</strong> ranking</span>
              <span><strong>89.4</strong> avg alliance</span>
              <span><strong>+7.1</strong> margin</span>
            </div>
            <div className="mini-table">
              <div><span>QF 2–1</span><span className="dim">won</span></div>
              <div><span>SF 1–2</span><span className="dim">lost</span></div>
              <div><span>Skills 214</span><span className="dim">driver · auto</span></div>
            </div>
          </article>
          <article className="preview">
            <div className="preview-label">Example layout · not live data</div>
            <h3>Alliance compatibility</h3>
            <div className="mini-compat">
              <span style={{ width: '78%' }} />
            </div>
            <p className="tiny dim">Autonomous overlap, AWP fit, scoring balance and role conflict, each shown separately.</p>
            <div className="mini-tags">
              <span className="chip">auto: complementary</span>
              <span className="chip">AWP: both capable</span>
              <span className="chip">role: scorer + toggle</span>
            </div>
          </article>
          <article className="preview">
            <div className="preview-label">Example layout · not live data</div>
            <h3>Field simulator</h3>
            <div className="mini-score">
              <span className="red">red 74</span>
              <span className="dim">·</span>
              <span className="blue">blue 61</span>
            </div>
            <ul className="mini-list tiny">
              <li>Alliance halves 55 · 45</li>
              <li>Yellow halves 0 · 10</li>
              <li>Midfield 16 · 8</li>
              <li>Auto bonus 12 · 0</li>
            </ul>
          </article>
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
          <strong>Private work stays private.</strong> Entering a team number never grants editing access to that team&apos;s
          workspace. Shared workspaces require an invitation from the team that owns them; this build keeps personal
          work in your own browser and does not expose one team&apos;s saved data to another.
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <h2>Start with your team number</h2>
          <p>One number, every tool. Add more teams later and switch between them at any time.</p>
        </div>
        <TeamLookup
          compact
          cta="Continue →"
          onConfirmed={onTeam}
        />
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
