import React, { useMemo, useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { api, pct, useApi } from '../api.js'
import { Badge, Btn, Empty, Table } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import Help from '../components/Help.jsx'
import { navigate } from '../router.js'
import { AccessForm } from './AccessPanel.jsx'
import UnlockDialog from './UnlockDialog.jsx'

const OPEN = ['approved', 'issued']
const STATUS = {
  approved: { label: 'Available', tone: 'good' },
  issued: { label: 'Available', tone: 'good' },
  not_requested: { label: 'Not issued', tone: '' },
  pending: { label: 'Request pending', tone: 'warn' },
  suspended: { label: 'Suspended', tone: 'bad' },
  expired: { label: 'Expired', tone: 'bad' }
}

const label = (status) => STATUS[status] || { label: status || 'Not issued', tone: '' }

// A workspace is only ready once its access code has actually been issued. An approved team
// with no code looks enabled in the database but nobody can open it, so it reads as not issued.
const isAvailable = (team) => OPEN.includes(team.status) && Boolean(team.hasPin)
const teamStatus = (team) =>
  OPEN.includes(team.status) && !team.hasPin ? { label: 'Not issued', tone: '' } : label(team.status)
const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function TeamCard({ team, open, onOpen, onRequest, requesting, index = 0 }) {
  const status = teamStatus(team)
  const available = isAvailable(team)
  const record = team.record
  const bestSkill = (team.skills || [])[0]
  const event = team.upcoming || team.latestEvent

  return (
    <article className="team-card" style={{ '--i': index }}>
      <div className="team-card-head">
        <div>
          <div className="num mono">{team.team}</div>
          <div className="name">{team.name || 'Chapter team'}</div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="team-metrics">
        <div className="m">
          <div className="l">Record</div>
          <div className="v">{record ? `${record.wins}–${record.losses}–${record.ties}` : '—'}</div>
        </div>
        <div className="m">
          <div className="l">Win rate</div>
          <div className="v">{record?.winRate != null ? pct(record.winRate) : '—'}</div>
        </div>
        <div className="m">
          <div className="l">Skills</div>
          <div className="v">{bestSkill ? Math.round(bestSkill.score) : '—'}</div>
        </div>
      </div>

      <div className="event-line">
        {event ? (
          <>
            <strong>{team.upcoming ? 'Next event' : 'Latest event'}:</strong> {event.name || event.sku}
            {event.start ? ` · ${fmtDate(event.start)}` : ''}
          </>
        ) : (
          <span className="dim">No scored events this season yet.</span>
        )}
      </div>

      {team.awards?.length > 0 && (
        <div className="row wrap" style={{ gap: 5 }}>
          {team.awards.slice(0, 3).map((a) => (
            <span className="chip" key={a}>{a}</span>
          ))}
          {team.awards.length > 3 && <span className="small dim">+{team.awards.length - 3}</span>}
        </div>
      )}

      <div className="team-actions">
        <Btn size="sm" variant="ghost" onClick={() => navigate(`teams?team=${team.team}`)}>
          View Statistics
        </Btn>
        {available ? (
          <Btn size="sm" variant="primary" onClick={onOpen}>
            {open ? 'Go to workspace' : 'Open Workspace'}
          </Btn>
        ) : team.status === 'pending' ? (
          <Btn size="sm" disabled>Request pending</Btn>
        ) : (
          <Btn size="sm" onClick={onRequest} disabled={requesting}>
            {requesting ? 'Sending…' : 'Request access'}
          </Btn>
        )}
      </div>
    </article>
  )
}

export default function Chapter({ query }) {
  const { access, isChapter, refresh } = useAccess()
  const chapterId = access.chapter
  const { data, error, loading, reload } = useApi(chapterId ? `/api/access/chapters/${chapterId}` : null)
  const [tab, setTab] = useState(query?.get('tab') === 'codes' ? 'codes' : 'teams')
  const [unlock, setUnlock] = useState(null)
  const [requesting, setRequesting] = useState(null)

  const chapter = data?.chapter
  const teams = data?.teams || []
  const requests = data?.requests || []

  const totals = useMemo(
    () => ({
      teams: teams.length,
      ready: teams.filter((t) => isAvailable(t)).length,
      pending: teams.filter((t) => t.status === 'pending').length,
      awards: teams.reduce((sum, t) => sum + (t.awards?.length || 0), 0)
    }),
    [teams]
  )

  const request = async (team) => {
    setRequesting(team)
    try {
      await api('/api/access/request', {
        method: 'POST',
        body: JSON.stringify({ team, chapterId, note: 'Requested from the chapter dashboard' })
      })
      reload()
    } catch {
      /* the refresh below shows the real status */
      reload()
    } finally {
      setRequesting(null)
    }
  }

  if (!isChapter && !chapterId) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Chapter access</h1>
          <p className="auth-sub">Connect to your robotics chapter.</p>
          <AccessForm compact initialMode="chapter" onDone={() => window.location.reload()} />
        </div>
      </div>
    )
  }

  if (loading && !data) return <div className="skeleton-block" aria-busy="true">Loading chapter…</div>
  if (error) return <div className="note bad">The chapter could not be loaded. Try again in a moment.</div>

  return (
    <div>
      <header className="chapter-head">
        <div>
          <h1>{chapter?.name || 'Chapter'}</h1>
          <div className="meta">
            {chapter?.season || '2026–2027 Override Season'}
            {chapter?.expiresAt ? ` · access to ${new Date(chapter.expiresAt).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div className="corner">
          <Badge tone={chapter?.status === 'active' ? 'good' : 'bad'}>{chapter?.status || 'active'}</Badge>
          <Btn size="sm" variant="ghost" onClick={() => navigate('chapter-admin')}>
            Administration
          </Btn>
        </div>
      </header>

      <div className="chapter-summary">
        <div className="cs">
          <div className="l">Chapter teams</div>
          <div className="v">{totals.teams}</div>
          <div className="s">assigned by the owner</div>
        </div>
        <div className="cs">
          <div className="l">Workspaces ready</div>
          <div className="v">{totals.ready}</div>
          <div className="s">private access issued</div>
        </div>
        <div className="cs">
          <div className="l">Access requests</div>
          <div className="v">{totals.pending}</div>
          <div className="s">awaiting approval</div>
        </div>
        <div className="cs">
          <div className="l">Awards</div>
          <div className="v">{totals.awards}</div>
          <div className="s">published this season</div>
        </div>
      </div>

      <nav className="tabs" aria-label="Chapter sections">
        <button type="button" className={`tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
          Teams <span className="dim">{teams.length}</span>
        </button>
        <button type="button" className={`tab ${tab === 'codes' ? 'active' : ''}`} onClick={() => setTab('codes')}>
          Access Codes
        </button>
      </nav>

      {tab === 'teams' && (
        <>
          <div className="team-grid">
            {teams.map((team, i) => (
              <TeamCard
                key={team.team}
                index={i}
                team={team}
                open={access.team === team.team}
                onOpen={() => (access.team === team.team ? navigate('home') : setUnlock(team))}
                onRequest={() => request(team.team)}
                requesting={requesting === team.team}
              />
            ))}
          </div>
          {!teams.length && <Empty>No teams are assigned to this chapter yet.</Empty>}
        </>
      )}

      {tab === 'codes' && (
        <div className="card">
          <div className="card-h">
            <h2>Access codes</h2>
            <span className="sub">status only — codes are never shown</span>
          </div>
          <div className="card-b flush">
            <Table head={['Team', 'Status', 'Code', 'Last used', '']}>
              {teams.map((team) => {
                const status = teamStatus(team)
                return (
                  <tr key={team.team}>
                    <td className="mono">{team.team}</td>
                    <td><Badge tone={status.tone}>{status.label}</Badge></td>
                    <td className="tiny dim">{team.hasPin ? 'Issued privately' : 'Not issued'}</td>
                    <td className="tiny dim">{team.lastSeenAt ? new Date(team.lastSeenAt).toLocaleString() : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isAvailable(team) ? (
                        <Btn size="sm" variant="ghost" onClick={() => setUnlock(team)}>Open workspace</Btn>
                      ) : team.status === 'pending' ? (
                        <span className="tiny dim">awaiting owner</span>
                      ) : (
                        <Btn size="sm" variant="ghost" disabled={requesting === team.team} onClick={() => request(team.team)}>
                          {requesting === team.team ? 'Sending…' : 'Request access'}
                        </Btn>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Table>
            {!teams.length && <Empty>No teams assigned.</Empty>}
          </div>
        </div>
      )}

      {tab === 'codes' && requests.length > 0 && (
        <div className="card">
          <div className="card-h"><h2>Your requests</h2></div>
          <div className="card-b flush">
            <Table head={['Team', 'Status', 'Submitted']}>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.team}</td>
                  <td><Badge tone={label(r.status).tone}>{label(r.status).label}</Badge></td>
                  <td className="tiny dim">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}

      <p className="tiny dim" style={{ marginTop: 14 }}>
        Chapter view shows official public results and access status only. Team workspace credentials are issued by the
        owner and are never displayed here.{' '}
        <Help label="Why are strategies missing?">
          A chapter code opens the dashboard, not a team&apos;s private work. Strategies, scouting notes and predictions
          stay inside each team&apos;s own workspace.
        </Help>
      </p>

      {unlock && (
        <UnlockDialog
          team={unlock}
          onClose={() => setUnlock(null)}
          onUnlocked={async () => {
            setUnlock(null)
            await refresh()
            reload()
            navigate('home')
          }}
        />
      )}
    </div>
  )
}
