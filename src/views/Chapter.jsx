import React, { useEffect, useMemo, useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { api, fmt, pct, useApi } from '../api.js'
import { Badge, Btn, Card, Empty, Field, Note, Stat, Table } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import { AccessForm } from './AccessPanel.jsx'

const STATUS_TONE = {
  approved: 'good',
  issued: 'good',
  pending: 'warn',
  not_requested: '',
  suspended: 'bad',
  expired: 'bad'
}
const STATUS_LABEL = {
  approved: 'Access approved',
  issued: 'Access issued',
  pending: 'Request pending',
  not_requested: 'Not requested',
  suspended: 'Suspended',
  expired: 'Expired'
}

function TeamCard({ team, onUnlock, chapterId }) {
  const { data: history } = useApi(`/api/history?team=${encodeURIComponent(team.team)}`)
  const [requesting, setRequesting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const record = history?.team ? history : null

  const request = async () => {
    setRequesting(true)
    setError(null)
    try {
      await api('/api/access/request', {
        method: 'POST',
        body: JSON.stringify({ team: team.team, chapterId, note: 'Requested from the chapter dashboard' })
      })
      setSent(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setRequesting(false)
    }
  }

  return (
    <article className="team-card">
      <header>
        <div>
          <h3 className="mono">{team.team}</h3>
          <p className="tiny dim">{record?.season || 'Public record'} · official RobotEvents results</p>
        </div>
        <Badge tone={STATUS_TONE[team.status] || ''}>{STATUS_LABEL[team.status] || team.status}</Badge>
      </header>

      <div className="team-card-stats">
        <div><span>Record</span><strong>{record ? `${record.wins ?? 0}–${record.losses ?? 0}–${record.ties ?? 0}` : '—'}</strong></div>
        <div><span>Matches</span><strong>{record?.matches ?? '—'}</strong></div>
        <div><span>Adj. win rate</span><strong>{record?.winRate != null ? pct(record.winRate) : '—'}</strong></div>
        <div><span>Events</span><strong>{record?.events?.length ?? '—'}</strong></div>
      </div>

      <div className="row wrap" style={{ gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => navigate(`public/${team.team}`)}>Public statistics</Btn>
        <Btn size="sm" variant="ghost" onClick={() => navigate(`team-login?team=${team.team}`)}>Enter team code</Btn>
        {['approved', 'issued'].includes(team.status) ? (
          <Btn size="sm" variant="primary" onClick={() => onUnlock(team.team)}>Unlock workspace</Btn>
        ) : sent || team.status === 'pending' ? (
          <Badge tone="warn">request pending</Badge>
        ) : (
          <Btn size="sm" onClick={request} disabled={requesting}>{requesting ? 'Sending…' : 'Request access'}</Btn>
        )}
      </div>
      {error && <p className="tiny bad">{error}</p>}
    </article>
  )
}

export default function Chapter() {
  const { access, refresh } = useAccess()
  const chapterId = access.chapter
  const { data, error, loading, reload } = useApi(chapterId ? `/api/access/chapters/${chapterId}` : null)
  const [tab, setTab] = useState('teams')
  const [unlock, setUnlock] = useState(null)

  const chapter = data?.chapter
  const teams = data?.teams || []
  const requests = data?.requests || []

  const totals = useMemo(
    () => ({
      teams: teams.length,
      issued: teams.filter((t) => t.hasPin).length,
      pending: teams.filter((t) => t.status === 'pending').length,
      enabled: teams.filter((t) => ['approved', 'issued'].includes(t.status)).length
    }),
    [teams]
  )

  useEffect(() => {
    if (unlock) setTab('teams')
  }, [unlock])

  if (!chapterId) {
    return (
      <Card title="Chapter dashboard">
        <p className="small">Enter a chapter access code to open its dashboard.</p>
        <AccessForm compact onDone={() => window.location.reload()} />
      </Card>
    )
  }

  if (loading && !data) return <div className="skeleton-block" aria-busy="true">Loading chapter…</div>
  if (error) return <Note tone="bad">{error}</Note>

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">Chapter</div>
          <h2>{chapter?.name || 'Chapter'}</h2>
          <p className="small dim">
            {chapter?.season || '2026–2027 · Override Season'}
            {chapter?.expiresAt ? ` · access until ${new Date(chapter.expiresAt).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Badge tone={chapter?.status === 'active' ? 'good' : 'bad'}>{chapter?.status || 'active'}</Badge>
          <Btn size="sm" variant="ghost" onClick={() => navigate('chapter-admin')}>
            {access.admin ? 'Administration' : 'Chapter admin'}
          </Btn>
        </div>
      </header>

      <div className="stat-grid">
        <Stat label="Chapter teams" value={totals.teams} sub="assigned by the owner" />
        <Stat label="Workspaces enabled" value={totals.enabled} sub={`${totals.issued} with an issued PIN`} />
        <Stat label="Pending requests" value={totals.pending} sub="awaiting owner approval" />
        <Stat label="Your role" value={access.admin ? 'Chapter administrator' : 'Chapter member'} sub="private team records stay private" />
      </div>

      <Note>
        Chapter access shows official public results and each team&apos;s access status. Each team opens its own workspace
        with its own code — a chapter code never unlocks one. This panel does not display any team&apos;s strategies,
        scouting notes, predictions, schedules or code.
      </Note>

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
            {teams.map((team) => (
              <TeamCard key={team.team} team={team} chapterId={chapterId} onUnlock={setUnlock} />
            ))}
          </div>
          {!teams.length && <Empty>No teams are assigned to this chapter yet.</Empty>}
        </>
      )}

      {tab === 'codes' && (
        <Card title="Access codes" subtitle="status only — codes and PINs are never shown here">
          <Table head={['Team', 'Status', 'PIN issued', 'Last seen', 'Action']}>
            {teams.map((team) => (
              <tr key={team.team}>
                <td className="mono">{team.team}</td>
                <td><Badge tone={STATUS_TONE[team.status] || ''}>{STATUS_LABEL[team.status] || team.status}</Badge></td>
                <td>{team.hasPin ? 'yes' : 'no'}</td>
                <td className="tiny dim">{team.lastSeenAt ? new Date(team.lastSeenAt).toLocaleString() : '—'}</td>
                <td>
                  {['approved', 'issued'].includes(team.status) ? (
                    <div className="row" style={{ gap: 4 }}>
                      <Btn size="sm" variant="ghost" onClick={() => navigate(`team-login?team=${team.team}`)}>Team sign-in</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setUnlock(team.team)}>Unlock here</Btn>
                    </div>
                  ) : team.status === 'pending' ? (
                    <span className="tiny dim">awaiting owner</span>
                  ) : (
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api('/api/access/request', {
                          method: 'POST',
                          body: JSON.stringify({ team: team.team, chapterId })
                        }).catch(() => {})
                        reload()
                      }}
                    >
                      Request
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {!teams.length && <Empty>No teams assigned.</Empty>}
          {requests.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3 className="small">Requests from this chapter</h3>
              <Table head={['Team', 'Status', 'Submitted']}>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.team}</td>
                    <td><Badge tone={STATUS_TONE[r.status] || ''}>{r.status}</Badge></td>
                    <td className="tiny dim">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          <Note tone="warn">
            Only the platform owner can approve a workspace or issue a PIN. Submitting a request does not grant access.
          </Note>
        </Card>
      )}

      {unlock && (
        <Card title={`Unlock ${unlock}`} subtitle="team PIN required — a chapter code is not enough">
          <AccessForm
            compact
            onDone={async () => {
              setUnlock(null)
              await refresh()
              reload()
              navigate('home')
            }}
          />
          <Btn size="sm" variant="ghost" onClick={() => setUnlock(null)}>Cancel</Btn>
        </Card>
      )}
    </div>
  )
}
