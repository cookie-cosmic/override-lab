import React, { useEffect, useRef, useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { Btn } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'

/**
 * Team unlock dialog. The team is already chosen by the chapter dashboard, so the only thing
 * asked for is that team's own access code. Nothing here reveals a code or its format.
 */
export default function UnlockDialog({ team, onClose, onUnlocked }) {
  const { loginTeam } = useAccess()
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const input = useRef(null)

  useEffect(() => {
    input.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const submit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    let ok = false
    try {
      await loginTeam(team.team, code, null, { remember })
      setCode('')
      ok = true
      // Confirm the authorization before moving on, then hand over quickly. Reduced motion
      // skips straight to the workspace.
      setDone(true)
      const reduced = document.documentElement.dataset.motion === 'reduced'
      setTimeout(() => onUnlocked && onUnlocked(), reduced ? 140 : 640)
    } catch (err) {
      setError(err.message || 'That access code was not recognised.')
    } finally {
      if (!ok) setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
        <div className="modal-head">
          <span className={`modal-lock ${done ? 'is-unlocked' : ''}`} aria-hidden="true">
            {done ? <span className="unlock-glyph">✓</span> : <Icon name="lock" size={18} />}
          </span>
          <div>
            <h2 id="unlock-title">Unlock team workspace</h2>
            <div className="sub">
              <strong className="mono">{team.team}</strong>
              {team.name ? ` · ${team.name}` : ''}
            </div>
          </div>
          <Btn size="sm" variant="ghost" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </Btn>
        </div>

        <form onSubmit={submit} className="modal-body">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="team-access-code">Team access code</label>
            <div className="pw-wrap">
              <input
                id="team-access-code"
                ref={input}
                type={show ? 'text' : 'password'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter the team access code"
                disabled={done}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'unlock-error' : undefined}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide access code' : 'Show access code'}
                aria-pressed={show}
              >
                <Icon name={show ? 'eye-off' : 'eye'} size={16} />
              </button>
            </div>
          </div>

          <label className="inline-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember this device
          </label>

          {error && (
            <p className="modal-error" id="unlock-error" role="alert">
              {error}
            </p>
          )}

          <p className="tiny dim" style={{ margin: 0 }}>
            Contact your team captain if you need your access code.
          </p>

          {done && (
            <p className="unlock-success" role="status">✓ Authorized — opening the workspace…</p>
          )}

          <div className="modal-foot">
            <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={busy || done || !code.trim()}>
              {done ? 'Unlocked' : busy ? 'Unlocking…' : 'Unlock workspace'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}
