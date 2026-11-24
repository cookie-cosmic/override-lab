import React, { useEffect, useMemo, useState } from 'react'
import { useTeam, useTeamStore } from '../team/TeamContext.jsx'
import { Badge, Btn, Card, Empty, Note, Stat, Table, Tabs } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import CounterPage from './CounterPage.jsx'
import { navigate } from '../router.js'
import { fmt } from '../api.js'

const RATINGS = [
  ['intake', 'Intake design'],
  ['pinHandling', 'Pin handling'],
  ['cupHandling', 'Cup handling'],
  ['scoringSpeed', 'Scoring speed'],
  ['stacking', 'Stacking efficiency'],
  ['toggleControl', 'Toggle control'],
  ['autonomous', 'Autonomous'],
  ['defense', 'Defence'],
  ['driveSpeed', 'Drive speed'],
  ['reliability', 'Reliability'],
  ['midfield', 'Midfield play']
]

const TAGS = ['pin-first', 'cup-heavy', 'toggle-focused', 'midfield park', 'defensive', 'fast cycles', 'risky auton', 'AWP hunter']
const SECTIONS = [
  ['intake', 'Intake'],
  ['scoringSpeed', 'Scoring'],
  ['autonomous', 'Autonomous'],
  ['defense', 'Defence'],
  ['reliability', 'Reliability']
]

function blank(team) {
  return {
    opponent: '',
    eventName: '',
    eventSku: '',
    kind: 'match',
    label: '',
    startingPosition: '',
    notes: '',
    strengths: '',
    weaknesses: '',
    tags: [],
    source: 'observed',
    ratings: Object.fromEntries(RATINGS.map(([k]) => [k, 3]))
  }
}

const avg = (note) => RATINGS.reduce((s, [k]) => s + (note.ratings?.[k] || 0), 0) / RATINGS.length

/** One team's observations, folded into a profile. Nothing is inferred beyond the notes. */
function profileFor(team, notes) {
  const rows = notes.filter((n) => n.opponent === team)
  if (!rows.length) return null
  const ratings = Object.fromEntries(
    RATINGS.map(([k]) => [k, Math.round((rows.reduce((s, n) => s + (n.ratings?.[k] || 0), 0) / rows.length) * 10) / 10])
  )
  return {
    team,
    notes: rows.length,
    ratings,
    tags: [...new Set(rows.flatMap((n) => n.tags || []))],
    strengths: rows.map((n) => n.strengths).filter(Boolean),
    weaknesses: rows.map((n) => n.weaknesses).filter(Boolean),
    events: [...new Set(rows.map((n) => n.eventName).filter(Boolean))],
    last: rows[0]?.updatedAt
  }
}

export default function Scouting({ sku }) {
  const { active } = useTeam()
  const { value, save, markDirty, clearDirty } = useTeamStore('scouting', { notes: [] })
  const [tab, setTab] = useState('overview')
  const [form, setForm] = useState(() => blank())
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [detailed, setDetailed] = useState(false)

  // A half-written scouting note should not vanish on a team switch without a question.
  useEffect(() => {
    if (form.opponent || form.notes || form.strengths) markDirty('a scouting note', active?.number)
    else clearDirty()
    return () => clearDirty()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.opponent, form.notes, form.strengths, active?.number])

  const notes = value.notes || []
  const filtered = notes.filter((n) =>
    filter ? `${n.opponent} ${n.eventName} ${n.label} ${(n.tags || []).join(' ')}`.toLowerCase().includes(filter.toLowerCase()) : true
  )
  const teams = useMemo(() => [...new Set(notes.map((n) => n.opponent))].sort(), [notes])
  const profiles = useMemo(() => teams.map((t) => profileFor(t, notes)).filter(Boolean), [teams, notes])

  const coverage = useMemo(() => {
    const events = new Set(notes.map((n) => n.eventSku || n.eventName).filter(Boolean))
    const fields = notes.length * RATINGS.length
    const filled = notes.reduce((s, n) => s + RATINGS.filter(([k]) => n.ratings?.[k] != null).length, 0)
    const thin = teams.filter((t) => notes.filter((n) => n.opponent === t).length < 2)
    return { events: events.size, teams: teams.length, notes: notes.length, completeness: fields ? filled / fields : 0, thin }
  }, [notes, teams])

  const startEdit = (n) => {
    setEditing(n.id)
    setTab('scout')
    setForm({
      opponent: n.opponent,
      eventName: n.eventName || '',
      eventSku: n.eventSku || '',
      kind: n.kind || 'match',
      label: n.label || '',
      startingPosition: n.startingPosition || '',
      notes: n.notes || '',
      strengths: n.strengths || '',
      weaknesses: n.weaknesses || '',
      tags: n.tags || [],
      source: n.source || 'observed',
      ratings: { ...Object.fromEntries(RATINGS.map(([k]) => [k, 3])), ...(n.ratings || {}) }
    })
  }

  const submit = (e) => {
    e.preventDefault()
    const opponent = form.opponent.trim().toUpperCase()
    if (!opponent) {
      setError('A team number is the minimum for a scouting note.')
      return
    }
    if (!/^[0-9]{1,5}[A-Z]?$/.test(opponent)) {
      setError('That does not look like a V5RC team number.')
      return
    }
    const record = {
      id: editing || `${Date.now()}`,
      opponent,
      eventName: form.eventName.trim() || null,
      eventSku: form.eventSku.trim() || null,
      kind: form.kind,
      label: form.label.trim() || null,
      startingPosition: form.startingPosition.trim() || null,
      notes: form.notes.trim() || null,
      strengths: form.strengths.trim() || null,
      weaknesses: form.weaknesses.trim() || null,
      tags: form.tags,
      ratings: form.ratings,
      source: form.source,
      updatedAt: new Date().toISOString()
    }
    save((prev) => ({
      notes: editing ? prev.notes.map((n) => (n.id === editing ? record : n)) : [record, ...(prev.notes || [])]
    }))
    setForm(blank())
    setEditing(null)
    setError(null)
  }

  const exportJson = () => {
    const payload = JSON.stringify({ team: active?.number, exportedAt: new Date().toISOString(), notes }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${active?.number || 'team'}-scouting.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!active) {
    return (
      <Empty>
        Choose a team first — scouting notes belong to a team context.{' '}
        <button type="button" className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.
      </Empty>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Scouting</h2>
          <p className="dim small">{active.number} · observations saved in this browser</p>
        </div>
        <div className="row">
          <Btn size="sm" variant="primary" onClick={() => { setTab('scout'); setEditing(null); setForm(blank()) }}>
            <Icon name="plus" size={14} /> New observation
          </Btn>
          <Btn size="sm" variant="ghost" onClick={exportJson} disabled={!notes.length}>Export JSON</Btn>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview', count: coverage.teams },
          { id: 'scout', label: 'Match & pit scouting', count: notes.length },
          { id: 'profiles', label: 'Team profiles' },
          { id: 'opponents', label: 'Opponent analysis' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <>
          <div className="stat-row">
            <Stat label="Teams observed" value={coverage.teams} sub={`${coverage.notes} observations`} />
            <Stat label="Events covered" value={coverage.events} sub="from note context" />
            <Stat label="Rating coverage" value={`${Math.round(coverage.completeness * 100)}%`} sub="fields filled" />
            <Stat label="Need more looks" value={coverage.thin.length} sub="teams with one note" />
          </div>

          <Card title="Coverage matrix" subtitle="observations recorded per opponent">
            {!teams.length ? (
              <Empty>
                No observations yet. <button type="button" className="link" onClick={() => setTab('scout')}>Record the first one</button> —
                quick entry only needs a team number, two ratings and a note.
              </Empty>
            ) : (
              <div className="coverage-grid">
                {teams.map((t) => {
                  const count = notes.filter((n) => n.opponent === t).length
                  return (
                    <button key={t} type="button" className="coverage-cell" onClick={() => setTab('profiles')} title={`${count} note${count === 1 ? '' : 's'}`}>
                      <strong className="mono">{t}</strong>
                      <span className={count >= 2 ? 'good' : 'warn'}>{count} note{count === 1 ? '' : 's'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="Recent observations" subtitle="newest first">
            {!notes.length ? (
              <p className="dim small">Nothing recorded for {active.number} yet.</p>
            ) : (
              <Table head={['Team', 'Type', 'Event', 'Tags', 'Updated', '']}>
                {notes.slice(0, 6).map((n) => (
                  <tr key={n.id}>
                    <td className="mono">{n.opponent}</td>
                    <td><Badge>{n.kind || 'match'}</Badge></td>
                    <td className="small dim">{n.eventName || '—'}</td>
                    <td className="small">{(n.tags || []).slice(0, 3).join(' · ') || '—'}</td>
                    <td className="tiny dim">{new Date(n.updatedAt).toLocaleDateString()}</td>
                    <td><Btn size="sm" variant="ghost" onClick={() => startEdit(n)}>Edit</Btn></td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'scout' && (
        <Card
          title={editing ? `Edit note · ${form.opponent}` : 'Quick scouting entry'}
          subtitle="Only the team number and a note are required; everything else is optional"
          right={<label className="inline-check"><input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} /> detailed fields</label>}
        >
          <form className="scout-form" onSubmit={submit}>
            <div className="form-grid">
              <label>
                <span>Opponent team</span>
                <input value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value.toUpperCase() })} placeholder="e.g. 1234A" required maxLength={8} />
              </label>
              <label>
                <span>Observation type</span>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="match">Match observation</option>
                  <option value="pit">Pit observation</option>
                </select>
              </label>
              <label>
                <span>Event</span>
                <input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="event name" maxLength={60} />
              </label>
              <label>
                <span>Observation source</span>
                <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  <option value="observed">Observed in person</option>
                  <option value="estimate">Estimate / second-hand</option>
                </select>
              </label>
            </div>

            <div className="quick-ratings">
              {[
                ['scoringSpeed', 'Scoring speed'],
                ['toggleControl', 'Toggle control'],
                ['autonomous', 'Autonomous'],
                ['reliability', 'Reliability']
              ].map(([key, label]) => (
                <div className="rating" key={key}>
                  <span>{label}</span>
                  <div className="stepper" role="group" aria-label={label}>
                    <button type="button" onClick={() => setForm({ ...form, ratings: { ...form.ratings, [key]: Math.max(1, form.ratings[key] - 1) } })} aria-label={`Lower ${label}`}>−</button>
                    <strong>{form.ratings[key]}</strong>
                    <button type="button" onClick={() => setForm({ ...form, ratings: { ...form.ratings, [key]: Math.min(5, form.ratings[key] + 1) } })} aria-label={`Raise ${label}`}>+</button>
                  </div>
                </div>
              ))}
            </div>

            {detailed && (
              <>
                <div className="form-grid">
                  <label>
                    <span>Event SKU</span>
                    <input value={form.eventSku} onChange={(e) => setForm({ ...form, eventSku: e.target.value.toUpperCase() })} placeholder="optional" maxLength={30} />
                  </label>
                  <label>
                    <span>Starting position</span>
                    <input value={form.startingPosition} onChange={(e) => setForm({ ...form, startingPosition: e.target.value })} placeholder="e.g. left wall, forward" maxLength={60} />
                  </label>
                </div>
                <div className="rating-grid">
                  {RATINGS.map(([key, label]) => (
                    <label key={key} className="rating">
                      <span>{label}</span>
                      <div className="rating-dots" role="radiogroup" aria-label={label}>
                        {[1, 2, 3, 4, 5].map((v) => (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={form.ratings[key] === v}
                            className={form.ratings[key] >= v ? 'on' : ''}
                            onClick={() => setForm({ ...form, ratings: { ...form.ratings, [key]: v } })}
                            aria-label={`${label}: ${v} of 5`}
                          >●</button>
                        ))}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="tag-row">
              {TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${form.tags.includes(t) ? 'on' : ''}`}
                  onClick={() => setForm({ ...form, tags: form.tags.includes(t) ? form.tags.filter((x) => x !== t) : [...form.tags, t] })}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="form-grid">
              <label className="wide">
                <span>Strengths</span>
                <input value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} maxLength={160} />
              </label>
              <label className="wide">
                <span>Weaknesses</span>
                <input value={form.weaknesses} onChange={(e) => setForm({ ...form, weaknesses: e.target.value })} maxLength={160} />
              </label>
              <label className="wide">
                <span>Notes</span>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={400} />
              </label>
            </div>
            {error && <Note tone="warn">{error}</Note>}
            <div className="row">
              <Btn type="submit" variant="primary" size="sm">{editing ? 'Update note' : 'Save note'}</Btn>
              {editing && <Btn size="sm" variant="ghost" onClick={() => { setEditing(null); setForm(blank()) }}>Cancel edit</Btn>}
              <span className="tiny dim">Ratings are your observations, not official measurements.</span>
            </div>
          </form>

          <div className="divider" />
          <div className="toolbar">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by team, event, tag" aria-label="Filter scouting notes" />
          </div>
          {!filtered.length ? (
            <p className="dim small">No notes yet. Save one above to build the coverage matrix and team profiles.</p>
          ) : (
            <div className="scout-cards">
              {filtered.map((n) => (
                <article key={n.id} className="scout-card">
                  <header>
                    <div>
                      <strong>{n.opponent}</strong>
                      {n.label ? <span className="dim"> · {n.label}</span> : null}
                      <div className="tiny dim">{n.eventName || 'event not recorded'} · {new Date(n.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <Badge tone={n.source === 'observed' ? 'good' : 'warn'}>{n.source}</Badge>
                  </header>
                  <div className="scout-tags">{(n.tags || []).map((t) => <span className="chip" key={t}>{t}</span>)}</div>
                  <div className="tiny dim">Average rating {fmt(avg(n), 1)}/5 · {n.kind || 'match'} observation</div>
                  {n.strengths && <p className="small"><strong>Strengths:</strong> {n.strengths}</p>}
                  {n.weaknesses && <p className="small"><strong>Weaknesses:</strong> {n.weaknesses}</p>}
                  {n.notes && <p className="small dim">{n.notes}</p>}
                  <div className="row" style={{ gap: 4 }}>
                    <Btn size="sm" variant="ghost" onClick={() => startEdit(n)}>Edit</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => save((prev) => ({ notes: prev.notes.filter((x) => x.id !== n.id) }))}>Delete</Btn>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'profiles' && (
        <div className="profile-grid">
          {!profiles.length ? (
            <Empty>Team profiles appear after the first observation.</Empty>
          ) : (
            profiles.map((p) => (
              <Card key={p.team} title={`${p.team} · ${p.notes} note${p.notes === 1 ? '' : 's'}`} subtitle={p.events.join(' · ') || 'event not recorded'}>
                <div className="rating-bars">
                  {SECTIONS.map(([key, label]) => (
                    <div key={key} className="rating-bar-row">
                      <span>{label}</span>
                      <div className="rating-bar"><span style={{ width: `${(p.ratings[key] / 5) * 100}%` }} /></div>
                      <strong className="mono">{fmt(p.ratings[key], 1)}</strong>
                    </div>
                  ))}
                </div>
                {p.tags.length > 0 && <div className="scout-tags">{p.tags.map((t) => <span className="chip" key={t}>{t}</span>)}</div>}
                {p.strengths.length > 0 && <p className="small"><strong>Observed strengths:</strong> {p.strengths.slice(0, 2).join('; ')}</p>}
                {p.weaknesses.length > 0 && <p className="small"><strong>Observed weaknesses:</strong> {p.weaknesses.slice(0, 2).join('; ')}</p>}
                {!p.strengths.length && !p.weaknesses.length && <p className="tiny dim">No qualitative strengths or weaknesses recorded — nothing is inferred.</p>}
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'opponents' && (
        sku ? (
          <Card title="Opponent analysis" subtitle="built from this tournament's official matches and your observations">
            <CounterPage sku={sku} opp={null} own={active.number} navigate={navigate} embedded />
          </Card>
        ) : (
          <Empty>
            Open a tournament first to analyse its opponents.{' '}
            <button type="button" className="link" onClick={() => navigate('tournaments')}>Browse tournaments</button>.
          </Empty>
        )
      )}

      <Card title="Scouting coverage and privacy">
        <p className="small dim">
          Notes are personal to this browser and stored under the active team, {active.number}. Switching teams loads
          that team&apos;s notes only. Collaborative scouting — multiple scouts sharing one event workspace with roles
          and conflict handling — needs an authenticated workspace, which this guest build does not create: a team number
          is never treated as proof of membership.
        </p>
      </Card>
    </div>
  )
}
