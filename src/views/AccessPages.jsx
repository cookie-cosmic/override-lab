import React, { useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { Badge, Btn, Field, Note } from '../components/ui.jsx'
import { BrandMark } from '../components/Brand.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'

/** Where a successful sign-in lands, by the kind of session the server issued. */
export function routeForAccess(result) {
  const kind = result?.access?.kind || result?.kind
  if (kind === 'owner') navigate('owner')
  else if (kind === 'chapter') navigate('chapter')
  else if (kind === 'team') navigate('home')
  else window.location.reload()
}

function AuthShell({ title, subtitle, children, footnote }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark size={30} />
          <span className="brand-lockup-text">
            <strong>Override Lab</strong>
            <span className="brand-lockup-tag">Competition intelligence</span>
          </span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
      </div>
      {footnote && <p className="auth-foot">{footnote}</p>}
    </div>
  )
}

/** A coordinator's chapter code. */
export function ChapterLogin() {
  const { isChapter, access, logout } = useAccess()
  return (
    <AuthShell
      title="Chapter access"
      subtitle="Connect to your robotics chapter."
      footnote="Contact your chapter coordinator if you need access."
    >
      {isChapter ? (
        <>
          <p className="small">
            Signed in to <strong>{access.chapterName || 'your chapter'}</strong>.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="primary" onClick={() => navigate('chapter')}>Open chapter dashboard</Btn>
            <Btn variant="ghost" onClick={() => { logout(); navigate('home') }}>Sign out</Btn>
          </div>
        </>
      ) : (
        <AccessForm initialMode="chapter" onDone={routeForAccess} />
      )}
    </AuthShell>
  )
}

/**
 * Team workspaces open from a chapter session. There is no public path straight into a team:
 * the server requires the chapter authorization before it checks the team code.
 */
export function TeamLogin({ query }) {
  const { isChapter, isTeam, access } = useAccess()
  const prefilled = query?.get('team') || ''
  const allowed = isChapter || (isTeam && access.viaChapter)

  if (!allowed) {
    return (
      <AuthShell
        title="Team workspace"
        subtitle="Open your chapter first."
        footnote="Team workspaces are reached through your chapter dashboard."
      >
        <p className="small">
          Enter your chapter access code, then choose the team you want to open. Each team still needs its own code.
        </p>
        <Btn variant="primary" block onClick={() => navigate('chapter-login')}>
          Continue to chapter access
        </Btn>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Team workspace"
      subtitle={prefilled ? `Team ${prefilled}` : 'Choose a team and enter its code.'}
      footnote="Contact your team captain if you need your access code."
    >
      <AccessForm initialMode="team" initialTeam={prefilled} onDone={routeForAccess} />
    </AuthShell>
  )
}

/**
 * Chapter administration: a separate password from the shared chapter code. Elevation belongs to
 * this device's session and can be revoked independently.
 */
export function ChapterAdmin() {
  const { isChapter, access, loginChapterAdmin, refresh } = useAccess()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!isChapter) {
    return (
      <AuthShell title="Chapter administration" subtitle="Chapter access required.">
        <p className="small">Enter your chapter access code first, then the administrator password.</p>
        <Btn variant="primary" onClick={() => navigate('chapter-login')}>Chapter access</Btn>
      </AuthShell>
    )
  }

  if (access.admin) {
    return (
      <div>
        <header className="chapter-head">
          <div>
            <h1>Administration</h1>
            <div className="meta">{access.chapterName || 'Chapter'} · elevated on this device</div>
          </div>
          <Badge tone="good">administrator</Badge>
        </header>
        <Note>
          Administrators oversee access: which teams belong to the chapter, whether a workspace is enabled, and whether a
          code has been issued. Team codes and private team work stay with the owner and the team captain.
        </Note>
        <Btn variant="primary" onClick={() => navigate('chapter')}>Open chapter dashboard</Btn>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await loginChapterAdmin(password)
      setPassword('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Chapter administration"
      subtitle={access.chapterName || 'Chapter'}
      footnote="Ask your chapter coordinator if you need this password."
    >
      <form onSubmit={submit} className="auth-form">
        <Field label="Administrator password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            aria-label="Chapter administrator password"
          />
        </Field>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <Btn type="submit" variant="primary" block disabled={busy || !password}>
          {busy ? 'Checking…' : 'Continue'}
        </Btn>
        <Btn variant="ghost" block onClick={() => navigate('chapter')}>Back to chapter</Btn>
      </form>
    </AuthShell>
  )
}

/** Compact session summary for settings screens. */
export function SessionSummary() {
  const { access, isTeam, isChapter, isOwner, logout } = useAccess()
  if (!isTeam && !isChapter && !isOwner) return null
  return (
    <div className="card">
      <div className="card-h">
        <h2>This device</h2>
        <span className="sub">
          {isOwner ? 'owner session' : isTeam ? `team ${access.team}` : access.chapterName || 'chapter'}
        </span>
        <div className="right"><Btn size="sm" variant="ghost" onClick={logout}>Sign out</Btn></div>
      </div>
      <div className="card-b">
        <div className="row wrap" style={{ gap: 8 }}>
          {isOwner && <Btn size="sm" variant="primary" onClick={() => navigate('owner')}>Owner console</Btn>}
          {isChapter && <Btn size="sm" variant="primary" onClick={() => navigate('chapter')}>Chapter dashboard</Btn>}
          {isTeam && <Btn size="sm" variant="primary" onClick={() => navigate('home')}>Open workspace</Btn>}
          <Btn size="sm" variant="ghost" onClick={() => navigate('settings?tab=access')}>
            <Icon name="settings" size={14} /> Settings
          </Btn>
        </div>
      </div>
    </div>
  )
}
