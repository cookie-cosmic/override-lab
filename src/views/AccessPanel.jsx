import React, { useEffect, useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { Badge, Btn, Card, Field, Note } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'

/**
 * One access field for everyone: a chapter code opens the chapter dashboard, a team's PIN opens
 * its private workspace. The platform owner's configured entry code starts the owner
 * verification flow from the same field — the public UI never says so, and knowing a code is
 * never enough on its own.
 */
export function AccessForm({ compact = false, onDone }) {
  const { loginChapter, loginTeam, ownerBegin, ownerVerify } = useAccess()
  const [mode, setMode] = useState('chapter')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [team, setTeam] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const reset = () => setError(null)

  const normaliseCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'chapter') {
        try {
          const out = await loginChapter(code)
          setCode('')
          onDone && onDone(out)
          return
        } catch (err) {
          // The same field also accepts the privately configured owner entry code. A failed
          // chapter lookup is retried once as an owner entry; nothing about the failure says
          // which kind of code was expected.
          if (err.status === 401) {
            try {
              const started = await ownerBegin(code)
              setChallenge(started.challenge)
              setCode('')
              return
            } catch (ownerErr) {
              throw err
            }
          }
          throw err
        }
      }
      const out = await loginTeam(team, pin)
      setPin('')
      onDone && onDone(out)
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
      <form onSubmit={submitTotp} className="access-form">
        <p className="tiny">
          Verify this device with the authenticator registered for this deployment. A code alone
          does not sign in.
        </p>
        <Field label="Authenticator code">
          <input
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            aria-label="Authenticator code"
            autoFocus
          />
        </Field>
        {error && <p className="small bad">{error}</p>}
        <div className="row" style={{ gap: 8 }}>
          <Btn type="submit" variant="primary" disabled={busy || totp.length !== 6}>
            {busy ? 'Verifying…' : 'Verify'}
          </Btn>
          <Btn variant="ghost" onClick={() => { setChallenge(null); setTotp(''); setError(null) }}>
            Cancel
          </Btn>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="access-form">
      {!compact && (
        <div className="seg" role="tablist" aria-label="Access type">
          <button type="button" role="tab" aria-selected={mode === 'chapter'} className={mode === 'chapter' ? 'on' : ''} onClick={() => { setMode('chapter'); reset() }}>
            Chapter
          </button>
          <button type="button" role="tab" aria-selected={mode === 'team'} className={mode === 'team' ? 'on' : ''} onClick={() => { setMode('team'); reset() }}>
            Team workspace
          </button>
        </div>
      )}

      {mode === 'chapter' ? (
        <Field label="Access code" hint="Chapter and workspace codes are issued by your coordinator. Codes are never stored in this browser.">
          <input
            value={code}
            onChange={(e) => setCode(normaliseCode(e.target.value))}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-label="Access code"
          />
        </Field>
      ) : (
        <>
          <Field label="Team number">
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6))}
              placeholder="75019D"
              autoComplete="off"
              aria-label="Team number"
            />
          </Field>
          <Field label="Team PIN" hint="Issued privately to your team captain. It is not your team number.">
            <input
              value={pin}
              onChange={(e) => setPin(normaliseCode(e.target.value))}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              aria-label="Team PIN"
            />
          </Field>
        </>
      )}

      {error && <p className="small bad" role="alert">{error}</p>}

      <Btn type="submit" variant="primary" disabled={busy || (mode === 'chapter' ? !code : !team || !pin)}>
        {busy ? 'Checking…' : mode === 'chapter' ? 'Continue' : 'Unlock workspace'}
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
      title={title || 'Approved team workspace required'}
      subtitle={feature ? `feature: ${feature}` : null}
      right={<Badge tone="warn">locked</Badge>}
    >
      <p className="small">
        {note ||
          'This is private competitive intelligence. It is available to approved team workspaces only — a chapter code alone does not unlock it, and neither does typing a team number.'}
      </p>
      {access?.kind === 'chapter' && (
        <Note tone="warn">
          You are in the chapter dashboard. Select a team and enter that team&apos;s own PIN to open its workspace.
        </Note>
      )}
      {access?.kind === 'team' && (
        <Note tone="warn">
          Your team session is active, but this feature is not enabled for {access.team}. Ask the platform owner to
          enable it — the server refuses the request until then.
        </Note>
      )}
      {isOwner ? (
        <p className="small">Owner sessions see every feature. If you are seeing this, reload the page.</p>
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
