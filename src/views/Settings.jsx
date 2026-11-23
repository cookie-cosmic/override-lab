import React, { useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { teamDataSummary } from '../team/store.js'
import { useTheme, THEMES } from '../theme.js'
import { Badge, Btn, Card, Note } from '../components/ui.jsx'
import { navigate } from '../router.js'
import ApiKey from '../components/ApiKey.jsx'
import BackupCode from '../components/BackupCode.jsx'

export default function Settings() {
  const { teams, active, defaultTeam, prefs, setPref, setDefaultTeam, reset } = useTeam()
  const [theme, setTheme] = useTheme()
  const [confirming, setConfirming] = useState(false)

  return (
    <div>
      <Card title="Preferences" subtitle="saved in this browser">
        <div className="settings-grid">
          <div className="setting">
            <div>
              <strong>Default team</strong>
              <p className="tiny dim">Opened when you return to the app without an active selection.</p>
            </div>
            <select value={defaultTeam || ''} onChange={(e) => setDefaultTeam(e.target.value)} aria-label="Default team">
              <option value="">none</option>
              {teams.map((t) => <option key={t.number} value={t.number}>{t.number}</option>)}
            </select>
          </div>
          <div className="setting">
            <div>
              <strong>Colour theme</strong>
              <p className="tiny dim">Applies everywhere, including the landing page.</p>
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
                  <span className={`swatch ${t.id}`} />
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
        </div>
      </Card>

      <Card title="Saved team work" subtitle="what this browser holds, per team">
        {!teams.length && <p className="dim small">No teams saved.</p>}
        {teams.map((t) => {
          const scopes = teamDataSummary(t.number)
          return (
            <div className="storage-row" key={t.number}>
              <div>
                <strong>{t.number}</strong> {active?.number === t.number && <Badge tone="good">active</Badge>}
                <div className="tiny dim">{t.label || t.name || 'unnamed'}</div>
              </div>
              <div className="tiny dim">
                {scopes.length ? scopes.join(' · ') : 'no saved work'}
              </div>
            </div>
          )
        })}
        <div className="row" style={{ marginTop: 10 }}>
          <Btn size="sm" variant="ghost" onClick={() => navigate('teams')}>Manage teams</Btn>
          <Btn size="sm" variant="ghost" onClick={() => navigate('welcome')}>Open landing page</Btn>
        </div>
      </Card>

      <Card title="Local backup & restore" subtitle="one PIN-protected code for everything saved in this browser">
        <BackupCode />
      </Card>

      <Card title="RobotEvents access" subtitle="server-side token, or a key you keep in this browser">
        <ApiKey />
        <p className="tiny dim" style={{ marginTop: 8 }}>
          The server token is never sent to the browser or printed. A key you add here is stored in this browser and
          travels as a request header; it is used for that request only.
        </p>
      </Card>

      <Card title="Reset personal data" subtitle="this browser only">
        <p className="small dim">
          Removing personal data deletes the saved team list and every team&apos;s saved scenarios, routines, testing
          sessions and scouting notes from this browser. Official results on the server are untouched.
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
        <Note>
          Accounts and shared workspaces are not enabled in this build. Personalisation is guest-only: it persists in
          this browser and does not sync between devices.
        </Note>
      </Card>
    </div>
  )
}
