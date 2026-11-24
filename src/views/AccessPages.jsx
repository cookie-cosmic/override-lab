import React, { useState } from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { Badge, Btn, Card, Field, Note } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'

/** Where a successful sign-in lands, by the kind of session the server issued. */
export function routeForAccess(result) {
  const kind = result?.access?.kind || result?.kind
  if (kind === 'owner') navigate('owner')
  else if (kind === 'chapter') navigate('chapter')
  else if (kind === 'team') navigate('match-day')
  else window.location.reload()
}

function AuthShell({ title, subtitle, children, footnote }) {
  return (
    <div className="auth-page">
      <Card title={title} subtitle={subtitle}>
        {children}
      </Card>
      {footnote && <p className="tiny dim auth-foot">{footnote}</p>}
    </div>
  )
}

/** A coordinator's chapter code. The admin code also works in this field. */
export function ChapterLogin() {
  const { isChapter, access, logout } = useAccess()
  return (
    <AuthShell
      title="Chapter sign-in"
      subtitle="2026–2027 · Override Season"
      footnote="Chapter codes are issued by your coordinator. A chapter code opens the chapter dashboard; each team's private workspace still needs that team's own code."
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
 * Team sign-in. The team field also accepts the administrator code, which opens the admin panel
 * with no PIN — the server decides, the page does not compare anything locally.
 */
export function TeamLogin({ query }) {
  const prefilled = query?.get('team') || ''
  return (
    <AuthShell
      title="Team workspace"
      subtitle={prefilled ? `Team ${prefilled}` : 'team number and access code'}
      footnote="Team codes are issued privately to a team's captain. A team number on its own is public information and never unlocks a workspace."
    >
      <AccessForm initialMode="team" initialTeam={prefilled} onDone={routeForAccess} />
      <div className="auth-links">
        <button type="button" className="link tiny" onClick={() => navigate('chapter-login')}>Chapter sign-in</button>
        <button type="button" className="link tiny" onClick={() => navigate('home')}>Back to public statistics</button>
      </div>
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
      <AuthShell title="Chapter administration" subtitle="chapter session required">
        <p className="small">Enter your chapter code first, then the administrator password.</p>
        <Btn variant="primary" onClick={() => navigate('chapter-login')}>Chapter sign-in</Btn>
      </AuthShell>
    )
  }

  if (access.admin) {
    return (
      <div>
        <header className="page-head">
          <div>
            <div className="eyebrow">Chapter administrator</div>
            <h2>{access.chapterName || 'Chapter'}</h2>
            <p className="small dim">Elevated on this device. You can see team access status, never team codes or private work.</p>
          </div>
          <Badge tone="good">administrator</Badge>
        </header>
        <Note>
          Chapter administrators oversee access: which teams are assigned, whether a workspace is enabled and whether a
          code has been issued. Team codes stay with the platform owner and the team captain; private scouting, strategy,
          schedules and PINs are not visible here.
        </Note>
        <Card title="What you can do">
          <ul className="plain-list">
            <li>Review the chapter&apos;s teams and their public results.</li>
            <li>See access status and ask the platform owner to issue or rotate a code.</li>
            <li>Open an individual team&apos;s sign-in page to hand the device to that team.</li>
          </ul>
          <Btn variant="primary" onClick={() => navigate('chapter')}>Open chapter panel</Btn>
        </Card>
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
      subtitle={access.chapterName || 'chapter'}
      footnote="This password is separate from the chapter code and is issued by the platform owner. A wrong password never reveals whether one exists."
    >
      <form onSubmit={submit} className="access-form">
        <Field label="Administrator password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            aria-label="Chapter administrator password"
          />
        </Field>
        {error && <p className="small bad" role="alert">{error}</p>}
        <div className="row" style={{ gap: 8 }}>
          <Btn type="submit" variant="primary" disabled={busy || !password}>{busy ? 'Checking…' : 'Unlock administration'}</Btn>
          <Btn variant="ghost" onClick={() => navigate('chapter')}>Back to chapter</Btn>
        </div>
      </form>
    </AuthShell>
  )
}

/** Small list used by the home screen so returning users can jump straight back in. */
export function SessionSummary() {
  const { access, isTeam, isChapter, isOwner, logout } = useAccess()
  if (!isTeam && !isChapter && !isOwner) return null
  return (
    <Card
      title="Your session on this device"
      subtitle={isOwner ? 'platform owner' : isTeam ? `team ${access.team}` : access.chapterName || 'chapter'}
      right={<Btn size="sm" variant="ghost" onClick={logout}>Sign out</Btn>}
    >
      <div className="row wrap" style={{ gap: 8 }}>
        {isOwner && <Btn size="sm" variant="primary" onClick={() => navigate('owner')}>Admin panel</Btn>}
        {isChapter && <Btn size="sm" variant="primary" onClick={() => navigate('chapter')}>Chapter panel</Btn>}
        {isTeam && <Btn size="sm" variant="primary" onClick={() => navigate('match-day')}>Open Match Day</Btn>}
        <Btn size="sm" variant="ghost" onClick={() => navigate('settings?tab=access')}>Session details</Btn>
      </div>
      {isTeam && (
        <p className="tiny dim" style={{ marginTop: 8 }}>
          {(access.features || []).length} features enabled
          {access.season?.end ? ` · access to ${new Date(access.season.end).toLocaleDateString()}` : ''}
        </p>
      )}
    </Card>
  )
}

