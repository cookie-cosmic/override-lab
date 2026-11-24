import React, { useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { Badge, Btn, Card, Empty, Note } from '../components/ui.jsx'
import Scouting from './Scouting.jsx'
import Alliance from './Alliance.jsx'
import CounterPage from './CounterPage.jsx'
import MetaPage from './MetaPage.jsx'
import { Gate } from './AccessPanel.jsx'

const TABS = [
  { id: 'teams', label: 'Teams', feature: 'scouting' },
  { id: 'strategy', label: 'Strategy', feature: 'allianceStrategy' },
  { id: 'analytics', label: 'Analytics', feature: 'metaModel' }
]

/**
 * One intelligence workspace. Teams, strategy and analytics share the same event context and
 * the same scouting records; they are three views of one dataset, not three applications.
 */
export default function Intelligence({ query, sku, activeTeam }) {
  const { can } = useAccess()
  const initial = TABS.some((t) => t.id === query?.get('tab')) ? query.get('tab') : 'teams'
  const [tab, setTab] = useState(initial)
  const opp = query?.get('opp') || null

  const setTabAndHash = (id) => {
    setTab(id)
    const q = new URLSearchParams(query?.toString() || '')
    q.set('tab', id)
    window.history.replaceState(null, '', `#/intelligence?${q.toString()}`)
  }

  return (
    <div>
      <nav className="tabs" aria-label="Intelligence sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTabAndHash(t.id)}>
            {t.label}
            {!can(t.feature) && <span className="lock-dot" aria-label="requires approval"> ·</span>}
          </button>
        ))}
      </nav>

      {tab === 'teams' && (
        <Gate feature="scouting" title="Scouting and team lab">
          <Scouting sku={sku} />
        </Gate>
      )}

      {tab === 'strategy' && (
        <>
          <Gate feature="counters" title="Opponents & Counters">
            {sku && opp ? (
              <CounterPage sku={sku} opp={opp} own={activeTeam} navigate={() => {}} />
            ) : (
              <Card title="Opponent counters" subtitle="opened from a match or a scouting profile">
                <p className="small">
                  Choose an opponent from a scouting profile or from the next match briefing to load the full counter
                  sheet. Counters combine official results with your own observations, and never claim a weakness your
                  team has not recorded.
                </p>
                {!sku && <Note>Open a tournament first so opponents can be resolved.</Note>}
              </Card>
            )}
          </Gate>
          <Gate feature="allianceStrategy" title="Alliance strategy">
            <Alliance sku={sku} />
          </Gate>
        </>
      )}

      {tab === 'analytics' && (
        <Gate feature="metaModel" title="Meta & Model">
          {sku ? <MetaPage sku={sku} navigate={() => {}} /> : <Empty>Choose a tournament to run the meta and model analysis.</Empty>}
        </Gate>
      )}
    </div>
  )
}
