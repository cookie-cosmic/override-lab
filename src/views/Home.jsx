import React, { useState } from 'react'
import TeamLookup from '../components/TeamLookup.jsx'
import PublicTeam from './PublicTeam.jsx'
import Dashboard from './Dashboard.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { routeForAccess, SessionSummary } from './AccessPages.jsx'
import { useAccess } from '../access/AccessContext.jsx'
import { Btn, Card, Note } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'

/**
 * The home screen is public first: anyone can search a team and read official results without
 * an account. Chapter, team and administrator entry live further down the same page, and each
 * one also has its own sign-in page.
 */
export default function Home({ query }) {
  const { isTeam, isChapter, isOwner } = useAccess()
  const [publicTeam, setPublicTeam] = useState(query?.get('team') || null)

  return (
    <div className="home-public">
      <section className="public-hero">
        <span className="eyebrow">Public statistics · VEX V5RC 2026–27</span>
        <h2>Your competitive edge.</h2>
        <p className="public-sub">
          Explore VEX V5RC competition statistics, tournament results, rankings, and team performance. No account is
          needed to look up a team.
        </p>
        <TeamLookup
          cta="View public statistics →"
          onConfirmed={(record) => setPublicTeam(record?.number || null)}
        />
        <p className="tiny dim">
          A team number is public information. Entering one never opens that team&apos;s private workspace.
        </p>
      </section>

      {publicTeam ? (
        <PublicTeam team={publicTeam} />
      ) : (
        <Note>
          Search any V5RC team number above — for example the number on the robot. Official results, rankings, skills and
          awards are read from RobotEvents.
        </Note>
      )}

      <section className="home-access" id="access">
        <div className="section-head">
          <h2>Access</h2>
          <p>Chapters, teams and platform administration each have their own sign-in.</p>
        </div>

        <div className="access-split">
          <Card title="Chapter access" subtitle="code from your coordinator">
            <AccessForm compact initialMode="chapter" onDone={routeForAccess} />
            <div className="auth-links">
              <button type="button" className="link tiny" onClick={() => navigate('chapter-login')}>
                Open the chapter sign-in page →
              </button>
            </div>
          </Card>

          <Card title="Team workspace" subtitle="team number and team code">
            <AccessForm compact initialMode="team" onDone={routeForAccess} />
            <div className="auth-links">
              <button type="button" className="link tiny" onClick={() => navigate('team-login')}>
                Open the team sign-in page →
              </button>
            </div>
          </Card>
        </div>

        <p className="tiny dim">
          Administrators can enter the administrator code in either code field. Only the configured code opens the admin
          panel; every attempt is rate limited and logged.
        </p>
      </section>

      <SessionSummary />

      {(isTeam || isChapter || isOwner) && (
        <section className="home-team">
          <div className="section-head">
            <h2>Your team</h2>
            <p>Official results for the team this device is signed in to.</p>
          </div>
          <Dashboard />
        </section>
      )}

      <section className="home-links">
        <Card title="More on Override Lab" subtitle="public pages">
          <div className="row wrap" style={{ gap: 8 }}>
            <Btn size="sm" variant="ghost" onClick={() => navigate('match-day')}>
              <Icon name="trophy" size={14} /> Tournament results
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => navigate('rules')}>
              <Icon name="book" size={14} /> Rules &amp; Q&amp;A
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => navigate('chapter-login')}>
              <Icon name="users" size={14} /> Chapter sign-in
            </Btn>
          </div>
        </Card>
      </section>
    </div>
  )
}
