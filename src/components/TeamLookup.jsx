import React, { useEffect, useId, useRef, useState } from 'react'
import { api, endpoints } from '../api.js'
import { isValidTeamNumber, normalizeTeamNumber } from '../team/store.js'
import { Badge, Btn, Note } from './ui.jsx'

const place = (c) => [c.city, c.region, c.country].filter(Boolean).join(', ')
const when = (v) => {
  const d = new Date(v || '')
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Team number search and confirmation.
 *
 * Lookup is only ever a read: it resolves the public record behind a number and reports the
 * team's season activity. Confirming adds the team to this browser's personal list — it does
 * not claim a workspace, and nothing private is keyed by the typed number.
 */
export default function TeamLookup({ onConfirmed, autoFocus = false, compact = false, cta = 'Launch my dashboard' }) {
  const [number, setNumber] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | candidates | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [pick, setPick] = useState(0)
  const inputRef = useRef(null)
  const uid = useId()
  const inputId = `team-number-${uid}`
  const hintId = `team-hint-${uid}`

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const normalized = normalizeTeamNumber(number)
  const valid = isValidTeamNumber(normalized)

  const lookup = async (e) => {
    e?.preventDefault()
    if (!normalized) {
      setError('Enter your V5RC team number, for example 75019D.')
      setStatus('error')
      return
    }
    if (!valid) {
      setError('That is not a V5RC team number. Use up to five digits and an optional letter, like 75019D or 37S.')
      setStatus('error')
      return
    }
    setStatus('loading')
    setError(null)
    setResult(null)
    try {
      const out = await api(endpoints.teamLookup(normalized))
      setResult(out)
      setPick(0)
      if (out.tokenRequired) {
        setStatus('error')
        setError(out.notes?.[0] || 'Official team details need a RobotEvents token.')
        return
      }
      setStatus('candidates')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const confirm = (candidate, { verified }) => {
    const c = candidate || {}
    onConfirmed({
      number: c.number || normalized,
      name: c.name || null,
      org: c.org || null,
      city: c.city || null,
      region: c.region || null,
      country: c.country || null,
      program: c.program || null,
      grade: c.grade || null,
      teamId: c.id ?? null,
      verified,
      seasonStatus: c.schedule ? (c.schedule.total ? 'active' : 'none') : 'unknown',
      seasonLabel: result?.season?.name || '2026-27 Override'
    })
  }

  const candidates = result?.candidates || []
  const selected = candidates[pick]

  return (
    <div className={`team-lookup ${compact ? 'compact' : ''}`}>
      <form className="lookup-bar" onSubmit={lookup}>
        <label className="sr-only" htmlFor={inputId}>
          VEX team number
        </label>
        <input
          id={inputId}
          ref={inputRef}
          value={number}
          onChange={(e) => setNumber(e.target.value.toUpperCase())}
          placeholder="75019D"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={number.length > 0 && !valid}
          aria-describedby={hintId}
        />
        <Btn type="submit" variant="primary" disabled={status === 'loading'}>
          {status === 'loading' ? 'Looking up…' : cta}
        </Btn>
      </form>
      <span id={hintId} className="tiny dim">
        Your number is used to personalise the tools. It does not grant access to another team&apos;s private work.
      </span>

      {status === 'loading' && (
        <div className="lookup-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Checking {normalized} against this season&apos;s official records…
        </div>
      )}

      {status === 'error' && (
        <div className="lookup-state">
          <Note tone="warn">{error}</Note>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Btn size="sm" onClick={lookup}>
              Retry lookup
            </Btn>
            <Btn size="sm" variant="ghost" disabled={!valid} onClick={() => confirm(null, { verified: false })}>
              Continue with {normalized || 'this number'} only
            </Btn>
          </div>
          <span className="tiny dim">
            Without official data, tools that need RobotEvents results will show empty states. You can add the official
            record later.
          </span>
        </div>
      )}

      {status === 'candidates' && (
        <div className="confirm-card">
          <div className="confirm-head">
            <div>
              <div className="tiny dim">Confirm this is your team</div>
              <div className="confirm-title">
                {selected?.number} {selected?.name ? <span className="dim">· {selected.name}</span> : null}
              </div>
            </div>
            <Badge tone={result?.seasonStatus === 'active' ? 'good' : 'warn'}>
              {result?.seasonStatus === 'active' ? 'active this season' : 'no current-season events'}
            </Badge>
          </div>

          {candidates.length > 1 && (
            <div className="candidate-list" role="radiogroup" aria-label="Matching team records">
              {candidates.map((c, i) => (
                <label key={`${c.id}-${i}`} className={`candidate ${i === pick ? 'active' : ''}`}>
                  <input type="radio" name="candidate" checked={i === pick} onChange={() => setPick(i)} />
                  <span>
                    <strong>{c.number}</strong> {c.name || 'unnamed record'}
                    <span className="dim">
                      {' '}
                      · {c.program || 'program unknown'}
                      {c.grade ? ` · ${c.grade}` : ''}
                      {place(c) ? ` · ${place(c)}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <dl className="confirm-grid">
            <div>
              <dt>Team</dt>
              <dd>{selected?.number || '—'}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{selected?.name || 'not listed'}</dd>
            </div>
            <div>
              <dt>Organization</dt>
              <dd>{selected?.org || 'not listed'}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{place(selected || {}) || 'not listed'}</dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd>{selected?.program || 'VEX V5 Robotics Competition'}</dd>
            </div>
            <div>
              <dt>Season</dt>
              <dd>{result?.season?.name || '2026-27 Override'}</dd>
            </div>
          </dl>

          <div className="confirm-events">
            {selected?.schedule?.next ? (
              <div>
                <span className="tiny dim">Next event</span>
                <div>
                  {selected.schedule.next.name} <span className="dim">· {when(selected.schedule.next.start)}</span>
                </div>
              </div>
            ) : null}
            {selected?.schedule?.latest ? (
              <div>
                <span className="tiny dim">Latest completed event</span>
                <div>
                  {selected.schedule.latest.name} <span className="dim">· {when(selected.schedule.latest.start)}</span>
                </div>
              </div>
            ) : null}
            {selected?.schedule && !selected.schedule.total && (
              <div className="tiny dim">
                This team has no events in the current season yet. The dashboard will open with tools and empty states
                instead of invented results.
              </div>
            )}
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={() => confirm(selected, { verified: true })}>
              Use this team →
            </Btn>
            <Btn variant="ghost" onClick={() => setStatus('idle')}>
              Search again
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
