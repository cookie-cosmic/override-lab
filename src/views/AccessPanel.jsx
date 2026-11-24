import React, { useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { Badge, Btn, Card, Note } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'

const normaliseCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')

/**
 * One access field for everyone.
 *
 * A chapter code opens the chapter dashboard. A team code opens that team's workspace from
 * inside the chapter. The owner entry code starts owner verification from the same field — the
 * interface never says so, and a code alone is never enough.
 */
export function AccessForm({ compact = false, onDone, initialMode = 'chapter', initialTeam = '' }) {
  const { loginChapter, loginTeam, ownerBegin, ownerVerify } = useAccess()
  const mode = initialMode
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [team, setTeam] = useState(initialTeam)
  const [challenge, setChallenge] = useState(null)
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  /** Silent owner entry: only ever attempted after an ordinary code is refused. */
  const tryOwner = async (value) => {
    try {
      const started = await ownerBegin(value)
      if (started?.token) {
        onDone && onDone(started.access || started)
        return true
      }
      if (started?.challenge) {
        setChallenge(started.challenge)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'team') {
        if (!pin) throw new Error('Enter the team access code.')
        const out = await loginTeam(team, pin)
        setPin('')
        onDone && onDone(out)
        return
      }
      // Chapter codes are generated in upper case without symbols, so they are normalised. The
      // owner entry code is chosen by the owner and may contain any characters, so it is passed
      // exactly as typed — never upper-cased or stripped.
      try {
        const out = await loginChapter(normaliseCode(code))
        setCode('')
        onDone && onDone(out)
      } catch (err) {
        // A refused or throttled chapter code still gets one quiet owner attempt, so waiting out
        // the chapter limiter never blocks the owner's own entry.
        if ((err.status === 401 || err.status === 429) && (await tryOwner(code.trim()))) {
          setCode('')
          return
        }
        throw err
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitTotp = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const out = await ownerVerify(challenge, totp)
      setChallenge(null)
      setTotp('')
      onDone && onDone(out)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (challenge) {
    return (
      <form onSubmit={submitTotp} className="auth-form">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ol-verify">Verification code</label>
          <input
            id="ol-verify"
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            autoFocus
          />
          <span className="hint">Enter the current code from your authenticator app.</span>
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="row" style={{ gap: 8 }}>
          <Btn type="submit" variant="primary" block disabled={busy || totp.length !== 6}>
            {busy ? 'Verifying…' : 'Verify'}
          </Btn>
          <Btn variant="ghost" onClick={() => { setChallenge(null); setTotp(''); setError(null) }}>
            Cancel
          </Btn>
        </div>
      </form>
    )
  }

  if (mode === 'team') {
    return (
      <form onSubmit={submit} className="auth-form">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ol-team-number">Team number</label>
          <input
            id="ol-team-number"
            value={team}
            onChange={(e) => setTeam(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 32))}
            placeholder="Team number"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ol-team-code">Team access code</label>
          <input
            id="ol-team-code"
            value={pin}
            onChange={(e) => setPin(normaliseCode(e.target.value))}
            placeholder="Team access code"
            autoComplete="off"
            spellCheck={false}
            type="password"
          />
          <span className="hint">Contact your team captain if you need your access code.</span>
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <Btn type="submit" variant="primary" block disabled={busy || !team}>
          {busy ? 'Unlocking…' : 'Unlock workspace'}
        </Btn>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="ol-access-code" className={compact ? 'sr-only' : undefined}>
          Access code
        </label>
        <input
          id="ol-access-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter your access code"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
          aria-label="Access code"
        />
      </div>
      {error && <p className="modal-error" role="alert">{error}</p>}
      <Btn type="submit" variant="primary" block disabled={busy || !code}>
        {busy ? 'Checking…' : 'Continue'}
      </Btn>
    </form>
  )
}

/** A tool the current session may not use, with the one action that would change that. */
export function LockedPanel({ feature, title, note }) {
  const { access, isOwner } = useAccess()
  const [form, setForm] = useState(false)
  return (
    <Card
      title={title || 'Team workspace required'}
      subtitle={feature ? `feature: ${feature}` : null}
      right={<Badge tone="warn">locked</Badge>}
    >
      <p className="small">
        {note || 'This is private competitive intelligence. It is available inside an approved team workspace.'}
      </p>
      {access?.kind === 'chapter' && (
        <Note tone="warn">Select a team on your chapter dashboard and enter that team&apos;s access code.</Note>
      )}
      {access?.kind === 'team' && (
        <Note tone="warn">
          This tool is not enabled for {access.team}. Ask your chapter coordinator to enable it.
        </Note>
      )}
      {isOwner ? (
        <p className="small">Owner sessions see every tool.</p>
      ) : (
        <>
          {!form ? (
            <Btn size="sm" variant="primary" onClick={() => setForm(true)}>
              <Icon name="search" size={14} /> Enter access code
            </Btn>
          ) : (
            <AccessForm compact onDone={() => window.location.reload()} />
          )}
        </>
      )}
    </Card>
  )
}

/** Wraps a view that requires one permission. The server enforces the same rule. */
export function Gate({ feature, children, title, note }) {
  const { can, loading } = useAccess()
  if (loading) return <div className="skeleton-block" aria-busy="true">Checking access…</div>
  if (!can(feature)) return <LockedPanel feature={feature} title={title} note={note} />
  return children
}

/** Only rendered when the session is the platform owner; a hidden route is not the boundary. */
export function OwnerOnly({ children }) {
  const { isOwner, loading } = useAccess()
  if (loading) return null
  if (!isOwner) return <LockedPanel title="Restricted" note="This area is not available." />
  return children
}
