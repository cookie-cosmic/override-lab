import React, { useEffect, useMemo, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useTeamStore } from '../team/TeamContext.jsx'
import { Badge, Btn, Card, Empty, Note, Stat, Table } from '../components/ui.jsx'
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

function blank(team) {
  return {
    opponent: '',
    eventName: '',
    eventSku: '',
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

export default function Scouting() {
  const { active } = useTeam()
  const { value, save, markDirty, clearDirty } = useTeamStore('scouting', { notes: [] })
  const [form, setForm] = useState(() => blank())
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')

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

  const coverage = useMemo(() => {
    const events = new Set(notes.map((n) => n.eventSku || n.eventName).filter(Boolean))
    const teams = new Set(notes.map((n) => n.opponent))
    const fields = notes.length * RATINGS.length
    const filled = notes.reduce((s, n) => s + RATINGS.filter(([k]) => n.ratings?.[k] != null).length, 0)
    return { events: events.size, teams: teams.size, notes: notes.length, completeness: fields ? filled / fields : 0 }
  }, [notes])

  const startEdit = (n) => {
    setEditing(n.id)
    setForm({
      opponent: n.opponent,
      eventName: n.eventName || '',
      eventSku: n.eventSku || '',
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
        <button className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.
      </Empty>
    )
  }

  return (
    <div>
      <Card
        title="Scouting"
        subtitle={`${active.number} · personal notes in this browser`}
        right={<Btn size="sm" variant="ghost" onClick={exportJson} disabled={!notes.length}>Export JSON</Btn>}
      >
        <div className="stat-row">
          <Stat label="Opponents" value={coverage.teams} sub="distinct team numbers" />
          <Stat label="Notes" value={coverage.notes} sub={`${coverage.events} events`} />
          <Stat label="Coverage" value={`${Math.round(coverage.completeness * 100)}%`} sub="ratings filled" />
        </div>

        <form className="scout-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              <span>Opponent team</span>
              <input value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value.toUpperCase() })} placeholder="e.g. 1234A" required maxLength={8} />
            </label>
            <label>
              <span>Event</span>
              <input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="event name" maxLength={60} />
            </label>
            <label>
              <span>Event SKU</span>
              <input value={form.eventSku} onChange={(e) => setForm({ ...form, eventSku: e.target.value.toUpperCase() })} placeholder="optional" maxLength={30} />
            </label>
            <label>
              <span>Starting position</span>
              <input value={form.startingPosition} onChange={(e) => setForm({ ...form, startingPosition: e.target.value })} placeholder="e.g. left wall, forward" maxLength={60} />
            </label>
            <label>
              <span>Observation source</span>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="observed">Observed in a match</option>
                <option value="estimate">Estimate / second-hand</option>
              </select>
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
                    >
                      ●
                    </button>
                  ))}
                </div>
              </label>
            ))}
          </div>

          <div className="tag-row">
            {TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip ${form.tags.includes(t) ? 'on' : ''}`}
                onClick={() =>
                  setForm({ ...form, tags: form.tags.includes(t) ? form.tags.filter((x) => x !== t) : [...form.tags, t] })
                }
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
            {editing && (
              <Btn size="sm" variant="ghost" onClick={() => { setEditing(null); setForm(blank()) }}>
                Cancel edit
              </Btn>
            )}
            <span className="tiny dim">Ratings are your observations, not official measurements.</span>
          </div>
        </form>
      </Card>

      <Card title="Scouting notes" subtitle={`${notes.length} recorded for ${active.number}`}>
        <div className="toolbar">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by team, event, tag" aria-label="Filter scouting notes" />
        </div>
        {!filtered.length ? (
          <Empty>No notes yet. Record what you actually saw; estimates are labelled as estimates.</Empty>
        ) : (
          <div className="scout-cards">
            {filtered.map((n) => {
              const avg = RATINGS.reduce((s, [k]) => s + (n.ratings?.[k] || 0), 0) / RATINGS.length
              return (
                <article key={n.id} className="scout-card">
                  <header>
                    <div>
                      <strong>{n.opponent}</strong>
                      {n.label ? <span className="dim"> · {n.label}</span> : null}
                      <div className="tiny dim">{n.eventName || 'event not recorded'} · {new Date(n.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <Badge tone={n.source === 'observed' ? 'good' : 'warn'}>{n.source}</Badge>
                  </header>
                  <div className="scout-tags">
                    {(n.tags || []).map((t) => <span className="chip" key={t}>{t}</span>)}
                  </div>
                  <div className="tiny dim">Average rating {fmt(avg, 1)}/5 · starting {n.startingPosition || 'not recorded'}</div>
                  {n.strengths && <p className="small"><strong>Strengths:</strong> {n.strengths}</p>}
                  {n.weaknesses && <p className="small"><strong>Weaknesses:</strong> {n.weaknesses}</p>}
                  {n.notes && <p className="small dim">{n.notes}</p>}
                  <div className="row" style={{ gap: 4 }}>
                    <Btn size="sm" variant="ghost" onClick={() => startEdit(n)}>Edit</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => save((prev) => ({ notes: prev.notes.filter((x) => x.id !== n.id) }))}>
                      Delete
                    </Btn>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Card>

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
