import React, { useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { teamDataSummary } from '../team/store.js'
import { useTheme, THEMES } from '../theme.js'
import { Badge, Btn, Card, Note } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import ApiKey from '../components/ApiKey.jsx'
import BackupCode from '../components/BackupCode.jsx'

export default function Settings() {
  const { teams, active, defaultTeam, prefs, setPref, setDefaultTeam, reset } = useTeam()
  const [theme, setTheme] = useTheme()
  const [confirming, setConfirming] = useState(false)

  return (
    <div>
      <Card title="Profile" subtitle="guest profile in this browser">
        {active ? (
          <div className="setting">
            <div>
              <strong>{active.number}{active.name ? ` · ${active.name}` : ''}</strong>
              <p className="tiny dim">
                {[active.org, [active.city, active.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Public record details not available'}
              </p>
            </div>
            <Badge tone={active.verified ? 'good' : 'warn'}>{active.verified ? 'official record' : 'number only'}</Badge>
          </div>
        ) : (
          <p className="dim small">No active team. <button type="button" className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.</p>
        )}
        <Note>
          Accounts and shared workspaces are not enabled. There is no sign-in, no cloud profile and no team-level
          permission system: a team number is public data, never proof of membership.
        </Note>
      </Card>

      <Card title="Appearance" subtitle="applies everywhere, including the landing page">
        <div className="setting">
          <div>
            <strong>Colour theme</strong>
            <p className="tiny dim">Choose a skin or follow your operating system.</p>
          </div>
          <div className="theme-switch" role="group" aria-label="Colour theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-opt ${theme === t.id ? 'active' : ''}`}
                aria-pressed={theme === t.id}
                onClick={() => setTheme(t.id)}
              >
                <Icon name={t.icon} size={14} />
                <span className="theme-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div>
            <strong>Field orientation</strong>
            <p className="tiny dim">Which side of the Override field the simulator shows at the bottom.</p>
          </div>
          <select value={prefs.fieldOrientation} onChange={(e) => setPref({ fieldOrientation: e.target.value })} aria-label="Field orientation">
            <option value="blue-bottom">Blue side at the top</option>
            <option value="red-top">View from the red side</option>
          </select>
        </div>
        <div className="setting">
          <div>
            <strong>Hints</strong>
            <p className="tiny dim">Explanatory notes under tools.</p>
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={prefs.showHints} onChange={(e) => setPref({ showHints: e.target.checked })} />
            show hints
          </label>
        </div>
      </Card>

      <Card title="Saved teams" subtitle={`${teams.length} team${teams.length === 1 ? '' : 's'} in this browser`} right={<Btn size="sm" variant="ghost" onClick={() => navigate('welcome')}>Add a team</Btn>}>
        {!teams.length && <p className="dim small">No teams saved.</p>}
        {teams.map((t) => {
          const scopes = teamDataSummary(t.number)
          return (
            <div className="storage-row" key={t.number}>
              <div>
                <strong>{t.number}</strong> {active?.number === t.number && <Badge tone="good">active</Badge>}
                {defaultTeam === t.number && <Badge>default</Badge>}
                <div className="tiny dim">{t.label || t.name || 'unnamed'}</div>
              </div>
              <div className="tiny dim">{scopes.length ? scopes.join(' · ') : 'no saved work'}</div>
            </div>
          )
        })}
        <div className="setting" style={{ marginTop: 10 }}>
          <div>
            <strong>Default team</strong>
            <p className="tiny dim">Opened when you return without an active selection.</p>
          </div>
          <select value={defaultTeam || ''} onChange={(e) => setDefaultTeam(e.target.value)} aria-label="Default team">
            <option value="">none</option>
            {teams.map((t) => <option key={t.number} value={t.number}>{t.number}</option>)}
          </select>
        </div>
        <p className="tiny dim">Switch teams from the switcher at the top of the sidebar, or with ⌘K.</p>
      </Card>

      <Card title="Data & privacy" subtitle="one PIN-protected backup for everything saved here">
        <BackupCode />
        <div className="divider" />
        <p className="small dim">
          Removing personal data deletes the saved team list and every team&apos;s scenarios, testing sessions and
          scouting notes from this browser. Official results on the server are untouched.
        </p>
        {!confirming ? (
          <Btn size="sm" variant="ghost" onClick={() => setConfirming(true)}>Clear this browser’s data…</Btn>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <Btn
              size="sm"
              variant="danger"
              onClick={() => {
                reset()
                setConfirming(false)
                navigate('welcome')
              }}
            >
              Yes, delete it
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
          </div>
        )}
      </Card>

      <Card title="Administration" subtitle="server connection and RobotEvents access">
        <details className="admin-block">
          <summary>Advanced: data source and ingestion</summary>
          <p className="tiny dim">
            Official data is pulled from RobotEvents by the server. Archive ingestion, cache refresh and API health are
            operational tools, not something the public navigation exposes. This guest build has no authenticated
            administrator role, so these controls are not shown here — hiding a link would not make them secure.
          </p>
          <ApiKey />
          <p className="tiny dim">
            A key entered above stays in this browser and travels as a request header. The server&apos;s own token is never
            sent to the browser, printed, or displayed.
          </p>
        </details>
      </Card>
    </div>
  )
}
