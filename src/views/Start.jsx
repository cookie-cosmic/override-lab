import React, { useEffect, useState } from 'react'
import { api, jpost } from '../api.js'
import { Card, Field, Btn, Note, Table, Badge } from '../components/ui.jsx'

const shortDate = (v) => {
  const d = new Date(v || '')
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Entry point for a post-tournament review, scoped to the season being played right now.
 *
 * Two facts gate everything: which competition, and which team number. Everything is looked
 * up inside the current season — the app will not quietly analyse an event from 2019 — and a
 * team's schedule is listed so upcoming events (which cannot be reviewed yet) are visible
 * alongside the ones that can.
 */
export default function Start({ navigate }) {
  const [competition, setCompetition] = useState('')
  const [team, setTeam] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoStart, setVideoStart] = useState('')
  const [videoField, setVideoField] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [candidates, setCandidates] = useState(null)
  // Autocomplete over this season's events: typing a few letters offers the full names.
  const [picked, setPicked] = useState(null)
  const [sugg, setSugg] = useState({ items: [], open: false, note: null, cursor: -1 })

  const [season, setSeason] = useState(null)
  const [tokenKnown, setTokenKnown] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [eventScope, setEventScope] = useState('team')
  const [eventQuery, setEventQuery] = useState('')

  // The event alone is enough: a team number is optional and only narrows the review.
  const ready = competition.trim().length > 1
  const hasToken = tokenKnown

  useEffect(() => {
    api('/api/season')
      .then((r) => {
        setSeason(r.season || null)
        setTokenKnown(Boolean(r.token))
      })
      .catch(() => {})
  }, [])

  // Debounced season search behind the competition field. Names come from RobotEvents, so
  // what is offered is exactly what the resolver will accept.
  useEffect(() => {
    const text = competition.trim()
    if (picked && text === picked.name) return
    if (text.length < 2) {
      setSugg({ items: [], open: false, note: null, cursor: -1 })
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      jpost('/api/season/events', { scope: 'season', q: text })
        .then((out) => {
          if (!alive) return
          const items = [...(out.completed || []), ...(out.upcoming || [])].slice(0, 8)
          setSugg({
            items,
            open: true,
            note: out.tokenRequired ? out.notes?.[0] || 'A RobotEvents token is required to search the season.' : null,
            cursor: -1
          })
        })
        .catch((e) => {
          if (alive) setSugg({ items: [], open: false, note: e.message, cursor: -1 })
        })
    }, 260)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition, picked])

  const loadSchedule = async (scopeOverride = null, queryOverride = null) => {
    const t = team.trim().toUpperCase()
    const scope = scopeOverride || eventScope
    if (scope === 'team' && !t) {
      setError('Enter the team ID first, or switch the scope to the whole season.')
      return
    }
    setScheduleBusy(true)
    setError(null)
    try {
      setSchedule(
        await jpost('/api/season/events', {
          team: t || undefined,
          scope,
          q: (queryOverride ?? eventQuery).trim() || undefined
        })
      )
      setEventScope(scope)
    } catch (e) {
      setError(e.message)
    } finally {
      setScheduleBusy(false)
    }
  }

  const pickSuggestion = (item) => {
    setCompetition(item.name)
    setPicked(item)
    setSugg((s) => ({ ...s, open: false, cursor: -1 }))
    submit(null, item.sku)
  }

  const onCompetitionKey = (e) => {
    if (e.key === 'Escape') {
      setSugg((s) => ({ ...s, open: false }))
      return
    }
    if (!sugg.open || !sugg.items.length) {
      if (e.key === 'Enter') submit()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSugg((s) => ({ ...s, cursor: Math.min(s.items.length - 1, s.cursor + 1) }))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSugg((s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (sugg.cursor >= 0) pickSuggestion(sugg.items[sugg.cursor])
      else submit()
    }
  }

  const submit = async (pick = null, skuOverride = null) => {
    const comp = skuOverride || competition.trim()
    if (!comp) {
      setError('A competition name or event SKU is required — the team ID is optional.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const out = await jpost('/api/resolve', {
        competition: comp,
        team: team.trim().toUpperCase() || undefined,
        pick: pick || undefined,
        video_url: videoUrl.trim() || undefined,
        video_field: videoField.trim() || undefined,
        stream_start: videoStart ? new Date(videoStart).toISOString() : null
      })
      if (out.ambiguous) {
        setCandidates(out.candidates || [])
        return
      }
      setCandidates(null)
      try {
        // Marks the session as unsaved so the app can offer save/discard and discard on close.
        sessionStorage.setItem('vex-live', out.sku)
      } catch {
        /* private mode: the server still drops the session on expiry */
      }
      // With a team the review opens on that team; without one it opens on the event. A future
      // event has no team profiles, so it lands on the roster picker instead of an empty overview.
      if (out.teamFound) navigate(`team/${out.sku}/${encodeURIComponent(out.team)}`)
      else navigate(out.rosterOnly ? `team/${out.sku}` : `overview/${out.sku}`)
    } catch (e) {
      setError(e.message)
      setCandidates(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Card title="Season scope" subtitle="this build reviews the season being played now, and nothing older">
        {season ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Badge tone="good">{season.name}</Badge>
            <span className="small dim">
              {shortDate(season.start)} → {shortDate(season.end)}
            </span>
            {season.id == null && <Badge tone="warn">window derived from today's date</Badge>}
            {!hasToken && <Badge tone="warn">token required</Badge>}
          </div>
        ) : (
          <span className="small dim">loading the current season…</span>
        )}

        <div style={{ marginTop: 10 }}>
          <Note tone={hasToken ? 'good' : 'warn'}>
            {tokenKnown
              ? 'RobotEvents access is configured on the server, so current-season events can be read.'
              : 'No RobotEvents token on the server yet — add ROBOTEVENTS_TOKEN to .env and restart. The public archives stop at 2020, so nothing current-season can be read without it.'}
          </Note>
        </div>
      </Card>

      <Card
        title="Start with the competition and the team number"
        subtitle="post-tournament review of a completed VEX V5 Robotics Competition High School event"
      >
        <div className="grid g2">
          <Field label="Competition name" hint="start typing — matching events from this season appear below">
            <div className="combo">
              <input
                className="input"
                value={competition}
                onChange={(e) => {
                  setCompetition(e.target.value)
                  setPicked(null)
                }}
                onKeyDown={onCompetitionKey}
                onFocus={() => sugg.items.length > 0 && setSugg((s) => ({ ...s, open: true }))}
                onBlur={() => window.setTimeout(() => setSugg((s) => ({ ...s, open: false })), 140)}
                placeholder="competition or tournament name"
                autoComplete="off"
                role="combobox"
                aria-expanded={sugg.open}
                aria-autocomplete="list"
              />
              {sugg.open && (sugg.items.length > 0 || sugg.note) && (
                <div className="combo-list" role="listbox">
                  {sugg.items.length > 0 && (
                    <div className="combo-hint">
                      {sugg.items.length} event{sugg.items.length === 1 ? '' : 's'} in {season?.name || 'this season'}
                    </div>
                  )}
                  {sugg.items.map((it, i) => (
                    <div
                      key={it.sku}
                      role="option"
                      aria-selected={sugg.cursor === i}
                      className={`combo-item ${sugg.cursor === i ? 'active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pickSuggestion(it)
                      }}
                      onMouseEnter={() => setSugg((s) => ({ ...s, cursor: i }))}
                    >
                      <div className="combo-name">{it.name}</div>
                      <div className="combo-meta">
                        <span className="mono">{it.sku}</span>
                        <span>{it.divisions?.length ? it.divisions.join(' · ') : 'no divisions listed'}</span>
                        <span>{shortDate(it.start)}</span>
                        {it.upcoming ? <span>upcoming</span> : null}
                      </div>
                    </div>
                  ))}
                  {sugg.note && sugg.items.length === 0 && <div className="combo-empty">{sugg.note}</div>}
                </div>
              )}
            </div>
          </Field>
          <Field label="Team ID (optional)" hint="e.g. 321A — leave it blank to load the whole event">
            <input
              className="input mono"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="321A"
            />
          </Field>
        </div>

        <div className="grid g3">
          <Field label="YouTube stream (optional)" hint="the event's main stream or a field stream">
            <input
              className="input"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
            />
          </Field>
          <Field label="Stream start (local)" hint="first frame time — this is what aligns matches to video">
            <input className="input" type="datetime-local" value={videoStart} onChange={(e) => setVideoStart(e.target.value)} />
          </Field>
          <Field label="Field (optional)" hint="only needed when one event had several field streams">
            <input
              className="input"
              value={videoField}
              onChange={(e) => setVideoField(e.target.value)}
              placeholder="Field 1"
            />
          </Field>
        </div>

        <div className="row">
          <Btn variant="primary" onClick={() => submit()} disabled={busy || !ready}>
            {busy ? 'Resolving…' : 'Find competition & load'}
          </Btn>
          <span className="tiny dim">
            Resolves inside {season?.name || 'the current season'}, loads only the division this team played in, and (if a stream
            is given) aligns every match to its timestamp so each match opens at the right second.
          </span>
        </div>

        {error && (
          <div style={{ marginTop: 12 }}>
            <Note tone="bad">{error}</Note>
          </div>
        )}
      </Card>

      <Card
        title={`${season?.name || 'Current season'} events`}
        subtitle="the whole season, completed events first — past events are the ones there is something to review"
        right={
          <div className="row" style={{ gap: 8 }}>
            <Btn size="sm" onClick={() => loadSchedule('team')} disabled={scheduleBusy || !team.trim()}>
              This team's events
            </Btn>
            <Btn size="sm" onClick={() => loadSchedule('season')} disabled={scheduleBusy}>
              All season events
            </Btn>
          </div>
        }
      >
        <div className="grid g2">
          <Field label="Scope" hint="the whole season, or only the events this team entered">
            <select value={eventScope} onChange={(e) => setEventScope(e.target.value)}>
              <option value="team">this team</option>
              <option value="season">the whole season</option>
            </select>
          </Field>
          <Field label="Filter by name (optional)" hint="applied by a button above; Enter works too">
            <input
              className="input"
              value={eventQuery}
              onChange={(e) => setEventQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadSchedule()}
              placeholder="e.g. league, signature, state"
            />
          </Field>
        </div>

        {!schedule && (
          <span className="small dim">
            Load a list to see every completed and upcoming event in this season, past events included.
          </span>
        )}
        {schedule?.tokenRequired && <Note tone="warn">{schedule.notes?.[0] || 'A RobotEvents token is required.'}</Note>}
        {schedule?.error && <Note tone="bad">{schedule.error}</Note>}
        {schedule && !schedule.tokenRequired && !schedule.error && (
          <>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <Badge tone="good">{schedule.counts?.completed ?? 0} completed</Badge>
              <Badge tone="warn">{schedule.counts?.upcoming ?? 0} upcoming</Badge>
              <span className="tiny dim">
                {schedule.scope === 'team' && schedule.team ? `${schedule.team}'s entries` : 'every event in the season'}
                {schedule.query ? ` · filtered by “${schedule.query}”` : ''}
              </span>
            </div>
            {schedule.notes?.length ? (
              <div style={{ marginBottom: 10 }}>
                <Note tone="warn">{schedule.notes.join(' · ')}</Note>
              </div>
            ) : null}

            <Table head={['Completed', 'Date', 'Divisions', { label: '', cls: 'num' }]} wrap={false}>
              {schedule.completed?.length ? (
                schedule.completed.map((e) => (
                  <tr key={e.sku}>
                    <td>
                      {e.name}
                      <div className="tiny dim mono">{e.sku}</div>
                    </td>
                    <td className="small dim">{shortDate(e.start)}</td>
                    <td className="small dim">{e.divisions?.length ? e.divisions.join(', ') : '—'}</td>
                    <td className="num">
                      <Btn size="sm" onClick={() => submit(null, e.sku)} disabled={busy}>
                        {team.trim() ? 'analyse' : 'open'}
                      </Btn>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="small dim">
                    No completed events match this view.
                  </td>
                </tr>
              )}
            </Table>
            {schedule.counts?.completed > (schedule.completed?.length || 0) && (
              <span className="tiny dim">
                Showing the {schedule.completed.length} most recent of {schedule.counts.completed} completed events — narrow it with the
                name filter.
              </span>
            )}

            <div style={{ height: 16 }} />

            <Table head={['Upcoming', 'Date', 'Location', { label: '', cls: 'num' }]} wrap={false}>
              {schedule.upcoming?.length ? (
                schedule.upcoming.map((e) => (
                  <tr key={e.sku}>
                    <td>
                      {e.name}
                      <div className="tiny dim mono">{e.sku}</div>
                    </td>
                    <td className="small dim">{shortDate(e.start)}</td>
                    <td className="small dim">{[e.city, e.region].filter(Boolean).join(', ') || '—'}</td>
                    <td className="num">
                      <Btn size="sm" onClick={() => submit(null, e.sku)} disabled={busy} title="Loads the roster only — nothing has been played yet">
                        plan
                      </Btn>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="small dim">
                    Nothing ahead in this view.
                  </td>
                </tr>
              )}
            </Table>
            <span className="tiny dim">
              Plan loads an upcoming event's roster without touching matches, rankings or awards, then opens the team lab on
              that team's previous tournaments.
            </span>
          </>
        )}
      </Card>

      {candidates && (
        <Card title="Which competition?" subtitle="several in-season events matched — pick the one you mean">
          <Table head={['Competition', 'Divisions', 'Date', { label: '', cls: 'num' }]} wrap={false}>
            {candidates.map((c) => (
              <tr key={c.sku}>
                <td>
                  <div>{c.name}</div>
                  <div className="tiny dim mono">{c.sku}</div>
                </td>
                <td className="small dim">
                  {c.divisions?.length ? c.divisions.join(', ') : '—'}
                  {c.upcoming ? <Badge tone="warn">upcoming</Badge> : null}
                </td>
                <td className="small dim">{shortDate(c.start)}</td>
                <td className="num">
                  <Btn size="sm" onClick={() => submit(c.sku)} disabled={busy}>
                    use this
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="What this build does with a High School event" subtitle="and what it refuses to invent">
        <div className="grid g2">
          <div className="small">
            <p>
              <strong>Ratings and win probability</strong> come from completed matches: OPR via ridge least squares, Elo with a
              margin-of-victory multiplier and bootstrap confidence bands, then a normal margin model calibrated on the event
              itself.
            </p>
            <p>
              <strong>Attribution</strong> decomposes an alliance's score with Shapley values over shrunk per-team means, capped at
              the event's realistic alliance ceiling, and names the phases that decided a loss.
            </p>
          </div>
          <div className="small">
            <p>
              <strong>Videos</strong> are aligned as <span className="mono">seek = match start − stream start + offset</span>.
              Breaks are where that drifts, so every link carries a confidence score and low-confidence links say so.
            </p>
            <p>
              <strong>In-game win probability</strong> needs a point-by-point timeline. This season's API does not ship one for
              every match, so it stays unavailable unless a tagged timeline exists — never estimated silently.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
