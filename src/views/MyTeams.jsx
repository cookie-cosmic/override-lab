import React, { useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { normalizeTeamNumber, teamDataSummary } from '../team/store.js'
import TeamLookup from '../components/TeamLookup.jsx'
import { Badge, Btn, Card, Empty, Note } from '../components/ui.jsx'
import { navigate } from '../router.js'

const place = (t) => [t.city, t.region, t.country].filter(Boolean).join(', ')

export default function MyTeams({ query }) {
  const { teams, active, addTeam, patchTeam, removeTeam, switchTeam, setDefaultTeam } = useTeam()
  const [adding, setAdding] = useState(query?.get('add') === '1')
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')

  const onAdd = (record) => {
    addTeam(record)
    setAdding(false)
    navigate('dashboard')
  }

  return (
    <div>
      <Card
        title="My teams"
        subtitle="saved in this browser"
        right={
          <Btn size="sm" variant="primary" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add team'}
          </Btn>
        }
      >
        <p className="small dim">
          A saved team sets the context for every tool. It is a personal list — it does not claim membership of that
          team&apos;s workspace, and saved work is stored separately for each team.
        </p>
        {adding && (
          <div className="add-panel">
            <TeamLookup cta="Look up team" onConfirmed={onAdd} autoFocus />
          </div>
        )}

        {!teams.length && !adding && (
          <Empty>
            No teams saved yet.{' '}
            <button className="link" onClick={() => setAdding(true)}>
              Add your first team
            </button>{' '}
            or{' '}
            <button className="link" onClick={() => navigate('welcome')}>
              open the landing page
            </button>
            .
          </Empty>
        )}

        <div className="team-cards">
          {teams.map((t) => {
            const isActive = active?.number === t.number
            const saved = teamDataSummary(t.number)
            return (
              <article className={`team-card ${isActive ? 'active' : ''}`} key={t.number}>
                <header>
                  <div>
                    <div className="team-card-number">{t.number}</div>
                    <div className="dim small">{t.label || t.name || 'no name available'}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {isActive && <Badge tone="good">active</Badge>}
                    {t.favorite && <Badge tone="warn">favorite</Badge>}
                  </div>
                </header>

                <dl className="team-card-meta">
                  <div><dt>Organization</dt><dd>{t.org || '—'}</dd></div>
                  <div><dt>Location</dt><dd>{place(t) || '—'}</dd></div>
                  <div><dt>Program</dt><dd>{t.program || 'V5RC'}</dd></div>
                  <div><dt>Season</dt><dd>{t.seasonLabel || '2026-27 Override'}</dd></div>
                </dl>

                <div className="row tiny dim" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {t.verified ? <span>official record</span> : <span>number only</span>}
                  {t.seasonStatus === 'active' && <span>· playing this season</span>}
                  {t.seasonStatus === 'none' && <span>· no current-season events</span>}
                  {saved.length ? <span>· saved work: {saved.join(', ')}</span> : <span>· no saved work yet</span>}
                </div>

                {renaming === t.number ? (
                  <form
                    className="rename-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      patchTeam(t.number, { label: draft.trim() || null })
                      setRenaming(null)
                    }}
                  >
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Label for this team" maxLength={40} />
                    <Btn size="sm" type="submit" variant="primary">Save</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Btn>
                  </form>
                ) : (
                  <div className="team-card-actions">
                    {!isActive && (
                      <Btn size="sm" variant="primary" onClick={() => switchTeam(t.number)}>
                        Switch to {t.number}
                      </Btn>
                    )}
                    {isActive && <Btn size="sm" onClick={() => navigate('dashboard')}>Open dashboard</Btn>}
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenaming(t.number)
                        setDraft(t.label || '')
                      }}
                    >
                      Rename
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => patchTeam(t.number, { favorite: !t.favorite })}>
                      {t.favorite ? 'Unfavorite' : 'Favorite'}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setDefaultTeam(t.number)}>
                      Make default
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const what = saved.length ? ` This also deletes saved ${saved.join(', ')} for ${t.number} from this browser.` : ''
                        if (window.confirm(`Remove ${t.number} from your saved teams?${what}`)) {
                          removeTeam(t.number)
                        }
                      }}
                    >
                      Remove
                    </Btn>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </Card>

      <Card title="How team access works" subtitle="what a team number does and does not unlock">
        <div className="access-grid">
          <div>
            <h3>Public profile</h3>
            <p className="small dim">Official name, organisation, location, events and results — readable by anyone.</p>
          </div>
          <div>
            <h3>Your saved team</h3>
            <p className="small dim">A personal shortcut in this browser. Removing it never touches official data.</p>
          </div>
          <div>
            <h3>Private workspace</h3>
            <p className="small dim">
              Shared scouting and testing belong to an authorised workspace. Typing a number here never grants that
              access, and this guest build does not create shared workspaces.
            </p>
          </div>
        </div>
        {normalizeTeamNumber(active?.number) && (
          <Note>
            Active context: <strong>{active.number}</strong>. Every tool writes its saved work under this team only.
          </Note>
        )}
      </Card>
    </div>
  )
}
