import React, { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons.jsx'
import { navigate } from '../router.js'
import { useTeam } from '../team/TeamContext.jsx'
import { api, endpoints } from '../api.js'
import { isValidTeamNumber, normalizeTeamNumber } from '../team/store.js'

const TOOLS = [
  { label: 'Dashboard', to: 'dashboard', icon: 'dashboard', hint: 'Team overview and season form' },
  { label: 'Tournaments', to: 'tournaments', icon: 'trophy', hint: 'Event discovery and results' },
  { label: 'Competition Day', to: 'competition', icon: 'zap', hint: 'Next match and live standings' },
  { label: 'Scouting', to: 'scouting', icon: 'clipboard', hint: 'Opponent observations and profiles' },
  { label: 'Alliance Strategy', to: 'alliance', icon: 'users', hint: 'Partner fit and 2v2 predictions' },
  { label: 'Field Simulator', to: 'field', icon: 'grid', hint: 'Score an Override end state' },
  { label: 'Robot Testing', to: 'testing', icon: 'wrench', hint: 'Practice sessions and comparisons' },
  { label: 'Rules & Q&A', to: 'rules', icon: 'book', hint: 'Rulebook and official Q&A' },
  { label: 'Settings', to: 'settings', icon: 'settings', hint: 'Appearance, teams and backups' }
]

/**
 * Ctrl/Cmd-K palette. Every row is a real destination: a tool, a saved team, an archived
 * event, or a verified team lookup that adds the team to this browser.
 */
export default function CommandPalette({ open, onClose, events = [] }) {
  const { teams, switchTeam, addTeam } = useTeam()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [lookup, setLookup] = useState({ status: 'idle', record: null, error: null })
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setLookup({ status: 'idle', record: null, error: null })
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  const q = query.trim().toLowerCase()
  const number = normalizeTeamNumber(query)
  const looksLikeTeam = Boolean(number) && isValidTeamNumber(number)

  const toolRows = useMemo(
    () => TOOLS.filter((t) => !q || `${t.label} ${t.hint}`.toLowerCase().includes(q)),
    [q]
  )
  const teamRows = useMemo(
    () => teams.filter((t) => !q || `${t.number} ${t.name || ''} ${t.label || ''}`.toLowerCase().includes(q)),
    [teams, q]
  )
  const eventRows = useMemo(() => (q ? events.filter((e) => `${e.name} ${e.sku || ''}`.toLowerCase().includes(q)).slice(0, 5) : []), [events, q])

  const go = (to) => {
    onClose()
    navigate(to)
  }

  const runLookup = async () => {
    if (!looksLikeTeam) return
    setLookup({ status: 'loading', record: null, error: null })
    try {
      const out = await api(endpoints.teamLookup(number))
      const candidate = out?.candidates?.[0]
      if (out?.tokenRequired) throw new Error(out.notes?.[0] || 'Official team details need a RobotEvents token.')
      if (!candidate) throw new Error('No V5RC team matched that number this season.')
      setLookup({ status: 'ready', record: candidate, error: null })
    } catch (e) {
      setLookup({ status: 'error', record: null, error: e.message })
    }
  }

  const addVerified = () => {
    const c = lookup.record
    if (!c) return
    addTeam({
      number: c.number || number,
      name: c.name || null,
      org: c.org || null,
      city: c.city || null,
      region: c.region || null,
      country: c.country || null,
      program: c.program || null,
      teamId: c.id ?? null,
      verified: true,
      seasonStatus: c.schedule ? (c.schedule.total ? 'active' : 'none') : 'unknown',
      seasonLabel: '2026-27 Override'
    })
    go('dashboard')
  }

  const rows = [
    ...toolRows.map((t) => ({ key: `tool-${t.to}`, icon: t.icon, label: t.label, hint: t.hint, action: () => go(t.to) })),
    ...teamRows.map((t) => ({
      key: `team-${t.number}`,
      icon: 'users',
      label: t.number,
      hint: t.name || 'saved team',
      action: () => {
        switchTeam(t.number)
        go('dashboard')
      }
    })),
    ...eventRows.map((e) => ({
      key: `event-${e.sku}`,
      icon: 'trophy',
      label: e.name,
      hint: e.sku || 'archived event',
      action: () => go(`overview/${e.sku}`)
    }))
  ]
  if (lookup.status === 'ready') {
    rows.unshift({
      key: 'lookup',
      icon: 'plus',
      label: `Add ${lookup.record.number}${lookup.record.name ? ` · ${lookup.record.name}` : ''}`,
      hint: 'verified RobotEvents record',
      action: addVerified
    })
  }

  if (!open) return null

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(rows.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[cursor]) rows[cursor].action()
      else if (looksLikeTeam) runLookup()
    }
  }

  return (
    <div className="cmdk-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search Override Lab">
        <div className="cmdk-input">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
              setLookup({ status: 'idle', record: null, error: null })
            }}
            onKeyDown={onKeyDown}
            placeholder="Search tools, teams, events, or a team number…"
            aria-label="Search tools, teams and events"
            autoComplete="off"
          />
          <kbd>esc</kbd>
        </div>

        <div className="cmdk-list" role="listbox" aria-label="Search results">
          {looksLikeTeam && lookup.status !== 'ready' && (
            <button type="button" className={`cmdk-row ${rows.length === 0 ? 'active' : ''}`} onClick={runLookup}>
              <span className="cmdk-ico"><Icon name="search" size={16} /></span>
              <span>
                <strong>Look up {number}</strong>
                <small>{lookup.status === 'loading' ? 'checking RobotEvents…' : 'verify the official record'}</small>
              </span>
            </button>
          )}
          {lookup.error && <p className="cmdk-note bad">{lookup.error}</p>}
          {rows.length === 0 && lookup.status !== 'loading' && !looksLikeTeam && (
            <p className="cmdk-note dim">No tool, saved team or archived event matches “{query}”.</p>
          )}
          {rows.map((row, i) => (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={i === cursor}
              className={`cmdk-row ${i === cursor ? 'active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={row.action}
            >
              <span className="cmdk-ico"><Icon name={row.icon} size={16} /></span>
              <span>
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </span>
              <Icon name="arrow" size={14} className="cmdk-go" />
            </button>
          ))}
        </div>

        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>ctrl</kbd> <kbd>k</kbd> toggle</span>
          <span className="spacer" />
          <span className="dim">Verified data only · no invented results</span>
        </div>
      </div>
    </div>
  )
}
