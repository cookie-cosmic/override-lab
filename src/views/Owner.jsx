import React, { useEffect, useMemo, useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { api, jdel, jpost, jput, useApi } from '../api.js'
import { Badge, Btn, Card, Empty, Field, Note, Table } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'

/** Read-only inspection of any team's private workspace, without that team's PIN. */
export function OwnerViewTeam({ team }) {
  const { isOwner } = useAccess()
  const { data, error, loading } = useApi(isOwner && team ? `/api/workspace/all?team=${encodeURIComponent(team)}` : null)
  const access = useApi(isOwner && team ? `/api/access/teams/${encodeURIComponent(team)}` : null)
  if (!isOwner) return <Note tone="bad">Owner authorization required.</Note>
  if (!team) return <Empty>Choose a team to inspect.</Empty>
  if (loading) return <div className="skeleton-block" aria-busy="true">Loading {team}&apos;s workspace…</div>
  if (error) return <Note tone="bad">{error}</Note>
  const collections = data?.collections || {}
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">Owner inspection</div>
          <h2 className="mono">{team}</h2>
          <p className="small dim">Read-only. Editing requires the team&apos;s own workspace or an intentional owner action.</p>
        </div>
        <Badge tone="warn">read-only</Badge>
      </header>
      <Note>
        Viewing this workspace is an owner action and is written to the security log. It is not a silent impersonation of
        a team member.
      </Note>
      <Card title="Enabled features" subtitle={access.data?.team?.status}>
        <p className="small">{(access.data?.team?.features || []).join(', ') || 'no features enabled'}</p>
      </Card>
      {Object.entries(collections).map(([name, rows]) => (
        <Card key={name} title={name} subtitle={`${rows.length} record${rows.length === 1 ? '' : 's'}`} flush>
          {rows.length ? (
            <Table head={['Summary', 'Updated']}>
              {rows.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.title || r.label || (r.items ? `${r.items.length} checklist items` : r.question || r.kind || r.id)}</td>
                  <td className="tiny dim">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No records.</Empty>
          )}
        </Card>
      ))}
    </div>
  )
}

const TABS = [
  { id: 'chapters', label: 'Chapters' },
  { id: 'teams', label: 'Teams' },
  { id: 'requests', label: 'Requests' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'audit', label: 'Audit' },
  { id: 'season', label: 'Season' }
]

const PRESETS = [
  ['stats', 'Statistics only'],
  ['standard', 'Standard team access'],
  ['full', 'Full competitive intelligence']
]

function SecretReveal({ value, label, notice }) {
  const [shown, setShown] = useState(true)
  const [copied, setCopied] = useState(false)
  return (
    <div className="secret-box">
      <div className="row">
        <strong>{label}</strong>
        <Badge tone="warn">shown once</Badge>
      </div>
      <div className="secret-value mono" aria-live="polite">{shown ? value : '••••-••••-••••'}</div>
      <div className="row" style={{ gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => setShown((v) => !v)}>{shown ? 'Hide' : 'Show'}</Btn>
        <Btn
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              /* clipboard may be blocked; the value is visible above */
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Btn>
        <span className="tiny dim">{notice}</span>
      </div>
    </div>
  )
}

export default function Owner() {
  const { isOwner, access, logout } = useAccess()
  const [tab, setTab] = useState('chapters')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState(null)
  const [totp, setTotp] = useState('')

  const chapters = useApi(isOwner ? '/api/access/chapters' : null)
  const teams = useApi(isOwner ? '/api/access/teams' : null)
  const requests = useApi(isOwner ? '/api/access/requests' : null)
  const sessions = useApi(isOwner ? '/api/access/sessions' : null)
  const audit = useApi(isOwner ? '/api/access/audit?limit=200' : null)
  const season = useApi(isOwner ? '/api/access/season' : null)

  const [chapterName, setChapterName] = useState('')
  const [chapterSeason, setChapterSeason] = useState('2026–2027 Override')
  const [chapterExpiry, setChapterExpiry] = useState('')
  const [newTeam, setNewTeam] = useState({ chapter: '', team: '' })
  const [enable, setEnable] = useState({ team: '', chapter: '', preset: 'standard' })
  // Declared before the owner check: a hook after a conditional return breaks React's hook
  // ordering as soon as the session changes (for example, signing out on this page).
  const [featureDraft, setFeatureDraft] = useState({ team: null, features: [] })

  const reloadAll = () => {
    chapters.reload()
    teams.reload()
    requests.reload()
    sessions.reload()
    audit.reload()
    season.reload()
  }

  if (!isOwner) {
    return (
      <Card title="Owner Control Center">
        <p className="small">This console is available only to an authenticated platform owner session.</p>
        <Note tone="warn">
          Owner sign-in needs the deployment&apos;s owner entry code and a current authenticator code. Discovering this
          route grants nothing: every request here is rejected without an owner session.
        </Note>
      </Card>
    )
  }

  const run = async (fn, label) => {
    setBusy(true)
    setError(null)
    try {
      const out = await fn()
      reloadAll()
      return out
    } catch (e) {
      setError(`${label}: ${e.message}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  const createChapter = async (e) => {
    e.preventDefault()
    await run(
      () =>
        jpost('/api/access/chapters', {
          name: chapterName,
          season: chapterSeason,
          expiresAt: chapterExpiry || null
        }),
      'Could not create chapter'
    )
    setChapterName('')
  }

  const issueCode = async (id) => {
    const out = await run(() => jpost(`/api/access/chapters/${id}/code`, {}), 'Could not issue code')
    if (out) setReveal({ label: 'Chapter access code', value: out.code, notice: 'Give this to the chapter coordinator through a private channel.' })
  }

  const deleteChapter = async (id, name) => {
    if (!totp) {
      setError('Enter a current authenticator code in the field at the top of this page before deleting a chapter.')
      return
    }
    if (!window.confirm(`Delete ${name}? Its teams will be suspended and their sessions revoked. Private records are kept.`)) return
    await run(() => api(`/api/access/chapters/${id}`, { method: 'DELETE', headers: { 'x-ol-totp': totp } }), 'Could not delete chapter')
  }

  const issuePin = async (team) => {
    const out = await run(() => jpost(`/api/access/teams/${team}/pin`, {}), 'Could not issue PIN')
    if (out) setReveal({ label: `Team PIN for ${team}`, value: out.pin, notice: 'Shown once and stored only as a hash. Give it to the captain privately.' })
  }

  const chapterList = chapters.data?.chapters || []
  const teamList = teams.data?.teams || []
  const catalog = teams.data?.catalog || {}
  const requestList = requests.data?.requests || []
  const sessionList = sessions.data?.sessions || []
  const auditList = audit.data?.entries || []

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">Platform owner</div>
          <h2>Owner Control Center</h2>
          <p className="small dim">Unrestricted administrative authority. Every action here is audited.</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Badge tone="good">owner session</Badge>
          <Btn size="sm" variant="ghost" onClick={() => { logout(); navigate('home') }}>Sign out</Btn>
        </div>
      </header>

      {error && <Note tone="bad" role="alert">{error}</Note>}

      {reveal && (
        <SecretReveal
          value={reveal.value}
          label={reveal.label}
          notice={reveal.notice}
        />
      )}
      {reveal && (
        <div className="row" style={{ marginBottom: 10 }}>
          <Btn size="sm" variant="ghost" onClick={() => setReveal(null)}>Dismiss</Btn>
        </div>
      )}

      <Card title="Sensitive confirmations" subtitle="destructive actions need a fresh authenticator code">
        <Field label="Current authenticator code" hint="Required for deleting a chapter or rotating a platform-wide setting.">
          <input
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            style={{ maxWidth: 160 }}
          />
        </Field>
      </Card>

      <nav className="tabs" aria-label="Owner sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'chapters' && (
        <>
          <Card title="Create a chapter">
            <form onSubmit={createChapter} className="form-grid">
              <Field label="Chapter name">
                <input value={chapterName} onChange={(e) => setChapterName(e.target.value)} placeholder="Coppell Robotics" required />
              </Field>
              <Field label="Season">
                <input value={chapterSeason} onChange={(e) => setChapterSeason(e.target.value)} />
              </Field>
              <Field label="Access expires" hint="Leave blank to follow the configured season end.">
                <input type="date" value={chapterExpiry} onChange={(e) => setChapterExpiry(e.target.value)} />
              </Field>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Btn type="submit" variant="primary" disabled={busy || chapterName.trim().length < 2}>Create chapter</Btn>
              </div>
            </form>
          </Card>

          {chapterList.map((c) => (
            <Card key={c.id} title={c.name} subtitle={`${c.teams.length} team${c.teams.length === 1 ? '' : 's'} · ${c.status}`} right={<Badge tone={c.hasCode ? 'good' : 'warn'}>{c.hasCode ? 'code issued' : 'no code'}</Badge>}>
              <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                <Btn size="sm" onClick={() => issueCode(c.id)} disabled={busy}>{c.hasCode ? 'Rotate code' : 'Issue code'}</Btn>
                <Btn size="sm" variant="ghost" onClick={() => deleteChapter(c.id, c.name)} disabled={busy}>Delete chapter</Btn>
                <span className="tiny dim">
                  {c.expiresAt ? `expires ${new Date(c.expiresAt).toLocaleDateString()}` : 'expiry follows the season'}
                </span>
              </div>

              <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                {c.teams.map((t) => (
                  <span className="chip" key={t}>
                    <span className="mono">{t}</span>
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={`Remove ${t} from ${c.name}`}
                      onClick={() => run(() => jdel(`/api/access/chapters/${c.id}/teams/${t}`), 'Could not remove team')}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {!c.teams.length && <span className="tiny dim">No teams assigned.</span>}
              </div>

              <form
                className="row"
                style={{ gap: 6 }}
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!newTeam.chapter) setNewTeam({ chapter: c.id, team: newTeam.team })
                  await run(() => jpost(`/api/access/chapters/${c.id}/teams`, { team: newTeam.team }), 'Could not add team')
                  setNewTeam({ chapter: c.id, team: '' })
                }}
              >
                <input
                  value={newTeam.chapter === c.id || !newTeam.chapter ? newTeam.team : ''}
                  onChange={(e) => setNewTeam({ chapter: c.id, team: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6) })}
                  placeholder="75019D"
                  aria-label={`Add a team to ${c.name}`}
                  style={{ maxWidth: 140 }}
                />
                <Btn type="submit" size="sm" disabled={busy || !newTeam.team}>Assign team</Btn>
              </form>
            </Card>
          ))}
          {!chapterList.length && <Empty>No chapters yet. Create one to issue the first access code.</Empty>}
        </>
      )}

      {tab === 'teams' && (
        <>
          <Card title="Enable a workspace" subtitle="a team is invisible to its own members until you enable it and issue a PIN">
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault()
                await run(
                  () => jpost(`/api/access/teams/${enable.team}/enable`, { chapterId: enable.chapter || null, preset: enable.preset }),
                  'Could not enable team'
                )
                setEnable({ team: '', chapter: enable.chapter, preset: enable.preset })
              }}
            >
              <Field label="Team number">
                <input value={enable.team} onChange={(e) => setEnable({ ...enable, team: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6) })} placeholder="75019D" />
              </Field>
              <Field label="Chapter">
                <select value={enable.chapter} onChange={(e) => setEnable({ ...enable, chapter: e.target.value })}>
                  <option value="">none</option>
                  {chapterList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Preset">
                <select value={enable.preset} onChange={(e) => setEnable({ ...enable, preset: e.target.value })}>
                  {PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Btn type="submit" variant="primary" disabled={busy || !enable.team}>Enable</Btn>
              </div>
            </form>
          </Card>

          <Card title="Team workspaces" subtitle={`${teamList.length} configured`} flush>
            <Table head={['Team', 'Status', 'Features', 'PIN', 'Actions']}>
              {teamList.map((t) => (
                <tr key={t.team}>
                  <td className="mono">{t.team}</td>
                  <td><Badge tone={['approved', 'issued'].includes(t.status) ? 'good' : t.status === 'pending' ? 'warn' : 'bad'}>{t.status}</Badge></td>
                  <td className="tiny">{t.features.length ? t.features.join(', ') : '—'}</td>
                  <td>{t.hasPin ? 'issued' : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Btn size="sm" variant="ghost" onClick={() => issuePin(t.team)} disabled={busy}>{t.hasPin ? 'Rotate PIN' : 'Issue PIN'}</Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => setFeatureDraft({ team: t.team, features: t.features })}
                      >
                        Features
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => run(() => jpost(`/api/access/teams/${t.team}/revoke`, {}), 'Could not revoke')}>Revoke devices</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => navigate(`view/${t.team}`)}>View as</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            {!teamList.length && <Empty>No team workspaces configured.</Empty>}
          </Card>

          {featureDraft.team && (
            <Card title={`Features for ${featureDraft.team}`} subtitle="the server refuses a disabled feature, not just its link">
              <div className="feature-toggles">
                {Object.entries(catalog).map(([key, label]) => (
                  <label className="inline-check" key={key}>
                    <input
                      type="checkbox"
                      checked={featureDraft.features.includes(key)}
                      onChange={(e) =>
                        setFeatureDraft((prev) => ({
                          ...prev,
                          features: e.target.checked ? [...prev.features, key] : prev.features.filter((f) => f !== key)
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => run(() => jput(`/api/access/teams/${featureDraft.team}`, { features: featureDraft.features }), 'Could not save features')}
                >
                  Save features
                </Btn>
                {PRESETS.map(([id, label]) => (
                  <Btn
                    key={id}
                    size="sm"
                    variant="ghost"
                    onClick={() => run(() => jput(`/api/access/teams/${featureDraft.team}`, { preset: id }), 'Could not apply preset')}
                  >
                    {label}
                  </Btn>
                ))}
                <Btn size="sm" variant="ghost" onClick={() => setFeatureDraft({ team: null, features: [] })}>Close</Btn>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'requests' && (
        <Card title="Access requests" subtitle="approving enables the workspace; a PIN still has to be issued">
          <Table head={['Team', 'Chapter', 'Status', 'Submitted', 'Decision']}>
            {requestList.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.team}</td>
                <td className="tiny">{chapterList.find((c) => c.id === r.chapterId)?.name || '—'}</td>
                <td><Badge tone={r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'good' : 'bad'}>{r.status}</Badge></td>
                <td className="tiny dim">{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  {r.status === 'pending' ? (
                    <div className="row" style={{ gap: 4 }}>
                      <Btn size="sm" variant="primary" onClick={() => run(() => jpost(`/api/access/requests/${r.id}`, { approve: true }), 'Could not approve')}>Approve</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => run(() => jpost(`/api/access/requests/${r.id}`, { approve: false }), 'Could not decline')}>Decline</Btn>
                    </div>
                  ) : <span className="tiny dim">decided</span>}
                </td>
              </tr>
            ))}
          </Table>
          {!requestList.length && <Empty>No requests.</Empty>}
        </Card>
      )}

      {tab === 'sessions' && (
        <Card title="Device sessions" subtitle="revoking a session stops it on its next request">
          <Table head={['Device', 'Kind', 'Team', 'Last seen', 'Expires', '']}>
            {sessionList.map((s) => (
              <tr key={s.id}>
                <td className="mono tiny">{s.id}</td>
                <td>{s.kind}</td>
                <td className="mono">{s.team || '—'}</td>
                <td className="tiny dim">{new Date(s.lastSeenAt).toLocaleString()}</td>
                <td className="tiny dim">{new Date(s.expiresAt).toLocaleDateString()}</td>
                <td>
                  {s.revoked ? <Badge tone="bad">revoked</Badge> : (
                    <Btn size="sm" variant="ghost" onClick={() => run(() => jdel(`/api/access/sessions/${s.id}`), 'Could not revoke')}>Revoke</Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {!sessionList.length && <Empty>No device sessions.</Empty>}
        </Card>
      )}

      {tab === 'audit' && (
        <Card title="Security log" subtitle="credentials, PINs and tokens are never recorded">
          <Table head={['When', 'Action', 'Actor', 'Team', 'Detail']}>
            {auditList.map((e) => (
              <tr key={e.id}>
                <td className="tiny dim">{new Date(e.at).toLocaleString()}</td>
                <td className="mono tiny">{e.action}</td>
                <td className="tiny">{e.actor_kind || '—'}{e.actor_label ? ` · ${e.actor_label}` : ''}</td>
                <td className="mono tiny">{e.team_number || '—'}</td>
                <td className="tiny dim" title={e.detail || ''}>{e.detail ? String(e.detail).slice(0, 60) : ''}</td>
              </tr>
            ))}
          </Table>
          {!auditList.length && <Empty>No events recorded yet.</Empty>}
        </Card>
      )}

      {tab === 'season' && (
        <Card title="Season configuration" subtitle="authorization window for chapters and teams">
          <div className="kv">
            <span className="k">Season</span><span className="v">{season.data?.season?.name || access.season?.name || '—'}</span>
            <span className="k">Starts</span><span className="v">{season.data?.season?.start || '—'}</span>
            <span className="k">Ends</span><span className="v">{season.data?.season?.end ? new Date(season.data.season.end).toLocaleDateString() : 'not configured'}</span>
            <span className="k">Source</span><span className="v">{season.data?.season?.source || '—'}</span>
          </div>
          <Note tone="warn">
            The window comes from the season calendar or the <code>SEASON_ENDS_AT</code> environment variable. When it
            passes, chapter and team sessions stop being accepted; public statistics remain, private records are kept
            and the owner keeps access. No date is hardcoded here.
          </Note>
          <p className="small dim">
            Owner sessions are not limited by season expiry, though they still expire and renew on a normal schedule.
          </p>
        </Card>
      )}
    </div>
  )
}
