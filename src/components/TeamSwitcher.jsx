import React, { useEffect, useRef, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { navigate } from '../router.js'

/**
 * The global team switcher. Every tool reads the active team from TeamContext, so choosing a
 * team here changes the whole app without a page reload or a second onboarding.
 */
export default function TeamSwitcher({ className = '' }) {
  const { teams, active, switchTeam } = useTeam()
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!active) {
    return (
      <button className={`team-switcher empty ${className}`} type="button" onClick={() => navigate('welcome')}>
        <span className="ts-label">No team selected</span>
        <span className="ts-number">Choose one →</span>
      </button>
    )
  }

  return (
    <div className={`team-switcher-wrap ${className}`} ref={box}>
      <button
        type="button"
        className={`team-switcher ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ts-mark" aria-hidden="true">
          {active.number.slice(-1)}
        </span>
        <span className="ts-text">
          <span className="ts-label">Currently viewing</span>
          <span className="ts-number">{active.number}</span>
        </span>
        <span className="ts-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="team-menu" role="menu">
          <div className="team-menu-head">
            Saved teams <span className="dim">{teams.length}</span>
          </div>
          {teams.map((t) => (
            <button
              key={t.number}
              type="button"
              role="menuitem"
              className={`team-menu-item ${t.number === active.number ? 'active' : ''}`}
              onClick={() => {
                if (switchTeam(t.number)) setOpen(false)
              }}
            >
              <span className="tm-number">{t.number}</span>
              <span className="tm-name">{t.label || t.name || 'saved team'}</span>
              {t.favorite && (
                <span className="tm-star" title="Favorite">
                  ★
                </span>
              )}
              {t.number === active.number && <span className="tm-current">active</span>}
            </button>
          ))}
          <div className="team-menu-foot">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('teams')
              }}
            >
              Manage teams
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('teams?add=1')
              }}
            >
              + Add team
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
