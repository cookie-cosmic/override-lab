import React, { useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { Gate } from './AccessPanel.jsx'
import Field from './Field.jsx'
import MatchSim from './MatchSim.jsx'
import { Badge } from '../components/ui.jsx'

const TABS = [
  { id: 'field', label: 'Field & Strategy', feature: 'fieldSimulator' },
  { id: 'match', label: 'Match Simulation', feature: 'simulation' }
]

export default function Simulation({ query, sku }) {
  const { can } = useAccess()
  const initial = TABS.some((t) => t.id === query?.get('tab')) ? query.get('tab') : 'field'
  const [tab, setTab] = useState(initial)

  const pick = (id) => {
    setTab(id)
    const q = new URLSearchParams(query?.toString() || '')
    q.set('tab', id)
    window.history.replaceState(null, '', `#/simulation?${q.toString()}`)
  }

  return (
    <div>
      <nav className="tabs" aria-label="Simulation sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => pick(t.id)}>
            {t.label}
            {!can(t.feature) && <span className="lock-dot" aria-label="requires approval"> ·</span>}
          </button>
        ))}
      </nav>

      {tab === 'field' && (
        <Gate feature="fieldSimulator" title="Field & Strategy simulator">
          <Field query={query} />
        </Gate>
      )}

      {tab === 'match' && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <Badge tone="warn">hypothetical</Badge>
            <span className="tiny dim">Simulation output is never an official result.</span>
          </div>
          <Gate feature="simulation" title="Match simulation">
            <MatchSim query={query} sku={sku} />
          </Gate>
        </>
      )}
    </div>
  )
}
