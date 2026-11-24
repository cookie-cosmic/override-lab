import React, { useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { teamDataSummary } from '../team/store.js'
import { useTheme, THEMES } from '../theme.js'
import { useMotion, MOTIONS } from '../motion.js'
import { useAccess } from '../access/AccessContext.jsx'
import { Badge, Btn, Card, Field, Note, Table } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import ApiKey from '../components/ApiKey.jsx'
import BackupCode from '../components/BackupCode.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { api, useApi } from '../api.js'

const TABS = [
  { id: 'access', label: 'Access' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'data', label: 'Data' }
]

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '—')

function AccessTab() {
  const { access, isTeam, isChapter, isOwner, logout, refresh } = useAccess()
  const { teams, active, defaultTeam, setDefaultTeam } = useTeam()
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Card title="Current access" subtitle="resolved by the server on every request">
        <div className="kv">
          <span className="k">Level</span>
          <span className="v">
            {isOwner ? 'Platform owner' : isTeam ? `Approved team${access.admin ? ' (chapter admin)' : ''}` : isChapter ? 'Chapter' : 'Public visitor'}
          </span>
          <span className="k">Team</span><span className="v mono">{access.team || '—'}</span>
          <span className="k">Chapter</span><span className="v">{access.chapterName || '—'}</span>
          <span className="k">Features</span><span className="v">{isOwner ? 'all' : (access.features || []).join(', ') || 'none'}</span>
          <span className="k">Season</span><span className="v">{access.season?.name || '—'}</span>
          <span className="k">Access runs to</span><span className="v">{fmtDate(access.season?.end)}</span>
        </div>
        {isTeam && (
          <Note>
            This device holds a session you can end at any time. No access code is stored in this browser.
          </Note>
        )}
        {isChapter && (
          <Btn size="sm" variant="primary" onClick={() => navigate('chapter')}>Open chapter dashboard</Btn>
        )}
      </Card>

      <Card title="Unlock another workspace" subtitle="a chapter code and a team PIN are different credentials">
        <AccessForm compact onDone={async () => { await refresh(); window.location.reload() }} />
      </Card>

      {isChapter && (
        <Card title="Chapter">
          <Btn size="sm" variant="ghost" onClick={() => navigate('chapter')}>Return to chapter dashboard</Btn>
        </Card>
      )}

      <Card title="Saved teams" subtitle={`${teams.length} in this browser`} right={<Btn size="sm" variant="ghost" onClick={() => navigate('welcome')}>Add a team</Btn>}>
        <Table head={['Team', 'Saved work', '']}>
          {teams.map((t) => (
            <tr key={t.number}>
              <td className="mono">{t.number}{active?.number === t.number ? ' · active' : ''}{defaultTeam === t.number ? ' · default' : ''}</td>
              <td className="tiny dim">{teamDataSummary(t.number).join(' · ') || 'no saved work'}</td>
              <td><Btn size="sm" variant="ghost" onClick={() => navigate(`public/${t.number}`)}>Public stats</Btn></td>
            </tr>
          ))}
        </Table>
        {!teams.length && <p className="dim small">No teams saved in this browser.</p>}
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
      </Card>

      <Card title="Sign out" subtitle="ends this device's session only">
        {!confirming ? (
          <Btn size="sm" variant="ghost" onClick={() => setConfirming(true)}>Sign out of this device…</Btn>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <Btn size="sm" variant="danger" onClick={async () => { await logout(); navigate('home') }}>Yes, sign out</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
          </div>
        )}
        <p className="tiny dim">
          Signing out revokes the session server-side. Other devices stay signed in until you revoke them from the owner
          console or rotate the team PIN.
        </p>
      </Card>
    </>
  )
}

function PreferencesTab() {
  const { prefs, setPref } = useTeam()
  const [theme, setTheme] = useTheme()
  const [motion, setMotionPref] = useMotion()
  const { isTeam, access } = useAccess()
  const { data, reload } = useApi(isTeam ? '/api/workspace/notifications/subscriptions' : null)
  const [lead, setLead] = useState(10)
  const [quiet, setQuiet] = useState({ start: '', end: '' })
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  const requestPermission = async () => {
    setError(null)
    try {
      if (!('Notification' in window)) throw new Error('This browser does not support notifications.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('Notification permission was not granted. Reminder delivery stays off until it is.')
        return
      }
      // A local subscription record is stored so the team and its preferences are known. Actual
      // push delivery additionally needs a push service and VAPID keys on the server.
      await api('/api/workspace/notifications/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: `local:${navigator.userAgent.slice(0, 80)}`,
          label: 'this device',
          categories: ['match', 'tasks'],
          leadMinutes: lead
        })
      })
      setStatus(
        data?.pushConfigured
          ? 'This device is registered. Push delivery is configured on the server.'
          : 'This device is registered for reminders. Push delivery is not configured on this server, so reminders only appear while Override Lab is open — they are not sent to a locked phone.'
      )
      reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const savePrefs = async () => {
    setError(null)
    try {
      await api('/api/workspace/notifications/preferences', {
        method: 'POST',
        body: JSON.stringify({ categories: ['match', 'tasks'], leadMinutes: lead, quietStart: quiet.start === '' ? null : Number(quiet.start), quietEnd: quiet.end === '' ? null : Number(quiet.end) })
      })
      setStatus('Preferences saved for this team.')
      reload()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      <Card title="Appearance">
        <div className="setting">
          <div><strong>Colour theme</strong><p className="tiny dim">Applies everywhere, including the landing page.</p></div>
          <div className="theme-switch" role="group" aria-label="Colour theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={`theme-opt ${theme === t.id ? 'active' : ''}`} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                <Icon name={t.icon} size={14} />
                <span className="theme-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div><strong>Motion</strong><p className="tiny dim">Field animation, entrances and transitions. Reduced motion keeps every control responsive without decorative movement.</p></div>
          <select value={motion} onChange={(e) => setMotionPref(e.target.value)} aria-label="Motion preference">
            {MOTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="setting">
          <div><strong>Field orientation</strong><p className="tiny dim">Which side of the Override field the simulator shows at the bottom.</p></div>
          <select value={prefs.fieldOrientation} onChange={(e) => setPref({ fieldOrientation: e.target.value })} aria-label="Field orientation">
            <option value="blue-bottom">Blue side at the top</option>
            <option value="red-top">View from the red side</option>
          </select>
        </div>
        <div className="setting">
          <div><strong>Hints</strong><p className="tiny dim">Explanatory notes under tools.</p></div>
          <label className="inline-check">
            <input type="checkbox" checked={prefs.showHints} onChange={(e) => setPref({ showHints: e.target.checked })} />
            show hints
          </label>
        </div>
      </Card>

      <Card title="Match notifications" subtitle={isTeam ? 'per team workspace' : 'requires a team workspace'}>
        {!isTeam && <Note tone="warn">Match reminders belong to a team workspace. Unlock your team to configure them.</Note>}
        {isTeam && (
          <>
            <div className="setting">
              <div><strong>Reminder lead time</strong><p className="tiny dim">How long before an estimated match start.</p></div>
              <select value={lead} onChange={(e) => setLead(Number(e.target.value))} aria-label="Reminder lead time">
                {[5, 10, 15, 20].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="setting">
              <div><strong>Quiet hours</strong><p className="tiny dim">No reminders inside this window, in local time.</p></div>
              <div className="row" style={{ gap: 6 }}>
                <input type="number" min="0" max="23" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} placeholder="from" aria-label="Quiet hours start" style={{ maxWidth: 80 }} />
                <input type="number" min="0" max="23" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} placeholder="to" aria-label="Quiet hours end" style={{ maxWidth: 80 }} />
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Btn size="sm" variant="primary" onClick={requestPermission}>Enable on this device</Btn>
              <Btn size="sm" variant="ghost" onClick={savePrefs}>Save preferences</Btn>
            </div>
            <p className="tiny dim">
              Permission is per device and can be withdrawn in browser settings. Match times are estimates from the
              published schedule; a reminder never claims a match is on the field.
            </p>
            {data?.subscriptions?.length > 0 && (
              <div className="tiny dim" style={{ marginTop: 6 }}>
                {data.subscriptions.length} device subscription{data.subscriptions.length === 1 ? '' : 's'} · server push{' '}
                {data.pushConfigured ? 'configured' : 'not configured'}
              </div>
            )}
            {status && <Note>{status}</Note>}
            {error && <p className="tiny bad">{error}</p>}
          </>
        )}
      </Card>

      <Card title="Install Override Lab" subtitle="a home-screen app that opens without the browser chrome">
        <p className="small">
          On Android and desktop Chrome, use the install button in the address bar or the menu. On iPhone and iPad, open
          the Share menu and choose <strong>Add to Home Screen</strong>.
        </p>
        <p className="tiny dim">
          An installed app keeps its own storage, so a session unlocked in your browser may need unlocking once inside the
          installed copy. Bookmarking a page does not by itself enable notifications.
        </p>
      </Card>
    </>
  )
}

function DataTab() {
  const { reset } = useTeam()
  const { isOwner, access } = useAccess()
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Card title="Saved work in this browser" subtitle="one PIN-protected backup for everything saved here">
        <BackupCode />
      </Card>

      <Card title="Data & ingest" subtitle="operational tools">
        {isOwner ? (
          <>
            <p className="small">Owner sessions can ingest and refresh archived events. These actions are audited.</p>
            <ApiKey />
            <Btn size="sm" variant="ghost" onClick={() => navigate('owner')}>Open the Owner Control Center</Btn>
          </>
        ) : (
          <>
            <p className="small">
              Archive ingestion, cache refresh and API health are owner operations. Your workspace can read the data it is
              entitled to but cannot import or replace an archive.
            </p>
            <details className="admin-block">
              <summary>RobotEvents key for this browser</summary>
              <ApiKey />
              <p className="tiny dim">
                A key pasted here stays in this browser and travels as a request header. The server&apos;s own key is never
                sent to a browser, printed or displayed.
              </p>
            </details>
          </>
        )}
      </Card>

      <Card title="Remove this browser’s personal data">
        <p className="small dim">
          Deletes the saved team list and every team&apos;s locally saved scenarios, testing sessions and scouting notes
          from this browser. Server records, official results and your access session are untouched.
        </p>
        {!confirming ? (
          <Btn size="sm" variant="ghost" onClick={() => setConfirming(true)}>Clear this browser’s data…</Btn>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <Btn size="sm" variant="danger" onClick={() => { reset(); setConfirming(false); navigate('welcome') }}>Yes, delete it</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
          </div>
        )}
      </Card>
    </>
  )
}

export default function Settings({ query }) {
  const initial = TABS.some((t) => t.id === query?.get('tab')) ? query.get('tab') : 'access'
  const [tab, setTab] = useState(initial)

  return (
    <div>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'access' && <AccessTab />}
      {tab === 'preferences' && <PreferencesTab />}
      {tab === 'data' && <DataTab />}
    </div>
  )
}
