import React from 'react'
import { useAccess } from '../access/AccessContext.jsx'
import Dashboard from './Dashboard.jsx'
import { AccessForm } from './AccessPanel.jsx'
import { Badge, Card, Note } from '../components/ui.jsx'
import { navigate } from '../router.js'

export default function Home() {
  const { access, isTeam, isChapter, isOwner, season } = useAccess()

  return (
    <div>
      {!isTeam && !isOwner && (
        <Card
          title={isChapter ? 'Chapter session' : 'Public statistics'}
          subtitle={isChapter ? access.chapterName || 'Chapter' : 'no private workspace on this device'}
          right={<Badge tone={isChapter ? 'good' : ''}>{isChapter ? 'chapter' : 'public'}</Badge>}
        >
          {isChapter ? (
            <>
              <p className="small">
                You are viewing public statistics. A chapter code does not unlock any team&apos;s private workspace —
                select a team and enter its own PIN.
              </p>
              <button type="button" className="btn primary" onClick={() => navigate('chapter')}>Open chapter dashboard</button>
            </>
          ) : (
            <>
              <p className="small">
                Public visitors can search any V5RC team and read official results. Strategic tools — counters,
                predictions, simulation, scouting and match intelligence — belong to approved team workspaces.
              </p>
              <AccessForm compact onDone={() => window.location.reload()} />
            </>
          )}
        </Card>
      )}

      {isTeam && (
        <Note>
          Signed in to <strong className="mono">{access.team}</strong>
          {access.chapterName ? ` · ${access.chapterName}` : ''} · {(access.features || []).length} features enabled
          {access.season?.end ? ` · season access to ${new Date(access.season.end).toLocaleDateString()}` : ''}
        </Note>
      )}

      <Dashboard />
    </div>
  )
}
