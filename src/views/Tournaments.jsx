import React, { useMemo, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useTeamSeasonEvents, useSeasonSearch } from '../team/data.js'
import { jpost } from '../api.js'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Note, Tabs } from '../components/ui.jsx'
import { navigate } from '../router.js'

const d = (v) => {
  const x = new Date(v || '')
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const where = (e) => [e.city, e.region, e.country].filter(Boolean).join(', ')

function EventRow({ event, favorite, onFavorite, onOpen, busy }) {
  return (
    <article className="event-row">
      <div className="event-date">
        <span>{d(event.start)}</span>
        {event.end && event.end !== event.start && <span className="tiny dim">→ {d(event.end)}</span>}
      </div>
      <div className="event-body">
        <div className="event-name">
          {event.name} {event.sku && <span className="mono tiny dim">{event.sku}</span>}
        </div>
        <div className="tiny dim">
          {where(event) || 'location not listed'}
          {event.divisions?.length ? ` · ${event.divisions.join(', ')}` : ''}
        </div>
      </div>
      <div className="event-actions">
        {event.status && <Badge tone={event.status === 'upcoming' ? 'warn' : ''}>{event.status}</Badge>}
        <button
          type="button"
          className={`star ${favorite ? 'on' : ''}`}
          title={favorite ? 'Remove from favorites' : 'Save to favorites'}
          aria-pressed={favorite}
          onClick={() => onFavorite?.(event)}
        >
          ★
        </button>
        <Btn size="sm" onClick={() => onOpen(event)} disabled={busy}>
          {busy ? 'Opening…' : 'Review'}
        </Btn>
      </div>
    </article>
  )
}

export default function Tournaments() {
  const { active, prefs, setPref } = useTeam()
  const [tab, setTab] = useState('team')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [opening, setOpening] = useState(null)
  const [error, setError] = useState(null)
  const season = useTeamSeasonEvents(active?.number, { enabled: Boolean(active) })
  const discovery = useSeasonSearch()
  const favorites = prefs.favoriteEvents || []

  const toggleFavorite = (event) => {
    if (!event?.sku) return
    const next = favorites.includes(event.sku) ? favorites.filter((s) => s !== event.sku) : [...favorites, event.sku]
    setPref({ favoriteEvents: next })
  }

  const openEvent = async (event) => {
    if (!event) return
    const target = event.sku || event.name
    setOpening(target)
    setError(null)
    try {
      const out = await jpost('/api/resolve', {
        competition: target,
        team: active?.number || undefined,
        pick: event.sku || undefined
      })
      if (out.ambiguous) {
        setError(`“${event.name}” matches several events. Open “Find a competition” to pick one.`)
        return
      }
      try {
        sessionStorage.setItem('vex-live', out.sku)
      } catch {
        /* ignore */
      }
      if (out.teamFound) navigate(`team/${out.sku}/${encodeURIComponent(out.team)}`)
      else navigate(out.rosterOnly ? `team/${out.sku}` : `overview/${out.sku}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setOpening(null)
    }
  }

  const teamEvents = useMemo(() => {
    const rows = [...(season.data?.upcoming || []), ...(season.data?.completed || [])]
    const q = search.trim().toLowerCase()
    return rows
      .filter((e) => (filter === 'all' ? true : e.status === filter))
      .filter((e) => (q ? `${e.name} ${e.sku || ''} ${where(e)}`.toLowerCase().includes(q) : true))
      .filter((e) => (favorites.length && filter === 'favorites' ? favorites.includes(e.sku) : true))
  }, [season.data, filter, search, favorites])

  const discoveryRows = useMemo(() => {
    const rows = [...(discovery.data?.upcoming || []), ...(discovery.data?.completed || [])]
    const q = search.trim().toLowerCase()
    return rows.filter((e) => (q ? `${e.name} ${e.sku || ''} ${where(e)}`.toLowerCase().includes(q) : true))
  }, [discovery.data, search])

  return (
    <div>
      <Card
        title="Tournament command centre"
        subtitle={`${active?.seasonLabel || '2026-27 Override'} · ${active?.number || 'no team'}`}
        right={
          <Btn size="sm" variant="ghost" onClick={() => navigate('start')}>
            Competition finder
          </Btn>
        }
      >
        <Tabs
          tabs={[
            { id: 'team', label: 'My team’s events', count: season.data?.counts?.total },
            { id: 'season', label: 'All Override events' },
            { id: 'favorites', label: 'Favorites', count: favorites.length }
          ]}
          active={tab}
          onChange={(id) => setTab(id)}
        />

        <div className="toolbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'team' ? 'Filter this team’s events' : 'Search the season by name, SKU or city'}
            aria-label="Filter events"
          />
          {tab === 'team' && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Status filter">
              <option value="all">All statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed</option>
            </select>
          )}
          {tab === 'season' && (
            <Btn size="sm" variant="primary" disabled={discovery.loading} onClick={() => discovery.search(search)}>
              {discovery.loading ? 'Searching…' : 'Search season'}
            </Btn>
          )}
        </div>

        {error && <Note tone="warn">{error}</Note>}

        {tab === 'team' && (
          <>
            {season.loading && <Loading label="Reading the team’s season…" />}
            {season.error && <ErrorBox error={season.error} onRetry={season.reload} />}
            {!season.loading && !season.error && !season.data?.counts?.total && (
              <Empty>
                {season.data?.notes?.[0] ||
                  'No events are published for this team in the current season yet. Search the whole season instead.'}
              </Empty>
            )}
            {teamEvents.map((e) => (
              <EventRow key={e.sku} event={e} favorite={favorites.includes(e.sku)} onFavorite={toggleFavorite} onOpen={openEvent} busy={opening === (e.sku || e.name)} />
            ))}
          </>
        )}

        {tab === 'season' && (
          <>
            {!discovery.data && !discovery.loading && (
              <p className="dim small">
                Search the whole {active?.seasonLabel || '2026-27'} season. Results come from RobotEvents and are limited
                to V5RC events in the current season.
              </p>
            )}
            {discovery.error && <ErrorBox error={discovery.error} onRetry={() => discovery.search(search)} />}
            {discoveryRows.map((e) => (
              <EventRow key={e.sku} event={e} favorite={favorites.includes(e.sku)} onFavorite={toggleFavorite} onOpen={openEvent} busy={opening === (e.sku || e.name)} />
            ))}
            {discovery.data && !discoveryRows.length && <Empty>No events matched that search.</Empty>}
          </>
        )}

        {tab === 'favorites' && (
          <>
            {!favorites.length && <Empty>Star an event to keep it here. Favorites are saved for this browser.</Empty>}
            {[...(season.data?.upcoming || []), ...(season.data?.completed || [])]
              .filter((e) => favorites.includes(e.sku))
              .map((e) => (
                <EventRow key={e.sku} event={e} favorite onFavorite={toggleFavorite} onOpen={openEvent} busy={opening === e.sku} />
              ))}
          </>
        )}
      </Card>

      <Card title="How tournament data is scoped">
        <p className="small dim">
          Every event here is checked against the live season before review, so an old event with a similar name cannot
          slip into this year’s numbers. Opening a review loads official matches, rankings, skills and awards; a running
          event can be re-synced while it plays. An upcoming event loads its roster only, because no results exist yet.
        </p>
      </Card>
    </div>
  )
}
