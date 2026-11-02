import React, { useState } from 'react'
import { api, jdel, jpost, endpoints, useApi, fmt, dateTime } from '../api.js'
import { Card, Stat, Badge, Table, Loading, ErrorBox, Note, Empty, Btn, Field, KV } from '../components/ui.jsx'

export default function DataPage({ sku, navigate }) {
  const { data: eventsData, reload: reloadEvents } = useApi(endpoints.events())
  const { data: summary, reload: reloadSummary } = useApi(sku ? endpoints.summary(sku) : null)
  const { data: rules } = useApi('/api/rules')

  const [ingestSku, setIngestSku] = useState('')
  const [provider, setProvider] = useState('robotevents')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  const [csvSku, setCsvSku] = useState('')
  const [csvName, setCsvName] = useState('')
  const [csv, setCsv] = useState('')

  const [videoUrl, setVideoUrl] = useState('')
  const [videoStart, setVideoStart] = useState('')
  const [videoLabel, setVideoLabel] = useState('')
  const [videoField, setVideoField] = useState('')

  const events = eventsData?.events || []

  const run = async (label, fn) => {
    setBusy(label)
    setMsg(null)
    try {
      const out = await fn()
      setMsg({ tone: 'good', text: typeof out === 'string' ? out : JSON.stringify(out) })
      return out
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message })
      return null
    } finally {
      setBusy(null)
    }
  }

  const doIngest = async () => {
    const out = await run('ingest', () => jpost('/api/ingest', { sku: ingestSku.trim(), provider }))
    if (out) {
      reloadEvents()
      navigate(`overview/${out.sku}`)
    }
  }

  const doCsv = async () => {
    const out = await run('csv', () => jpost('/api/ingest/csv', { sku: csvSku.trim(), name: csvName || csvSku.trim(), csv }))
    if (out) {
      reloadEvents()
      navigate(`overview/${out.sku}`)
    }
  }

  const doAddVideo = async () => {
    if (!sku) return
    const out = await run('video', () =>
      jpost(`/api/events/${encodeURIComponent(sku)}/videos`, {
        url: videoUrl,
        stream_start: videoStart ? new Date(videoStart).toISOString() : null,
        label: videoLabel || null,
        field: videoField || null
      })
    )
    if (out) {
      setVideoUrl('')
      setVideoStart('')
      setVideoLabel('')
      setVideoField('')
      reloadSummary()
    }
  }

  const doAlign = async () => {
    const out = await run('align', () => jpost(`/api/events/${encodeURIComponent(sku)}/align`, { offsets: {} }))
    if (out) reloadSummary()
  }

  const doDelete = async (target) => {
    if (!confirm(`Delete ${target} and everything derived from it?`)) return
    const out = await run('delete', () => jdel(`/api/events/${encodeURIComponent(target)}`))
    if (out) {
      reloadEvents()
      navigate('overview')
    }
  }

  return (
    <div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Events in archive" value={events.length} />
        <Stat label="Videos linked" value={summary?.quality?.videos ?? 0} sub={`${summary?.quality?.aligned ?? 0} matches aligned`} />
        <Stat label="Tagged timelines" value={summary?.quality?.tagged ?? 0} sub="matches with score events" />
        <Stat label="Counter rules" value={rules?.rules?.length ?? '—'} sub={`version ${rules?.version ?? '—'}`} />
      </div>

      {msg && (
        <div style={{ marginBottom: 14 }}>
          <Note tone={msg.tone}>{msg.text}</Note>
        </div>
      )}

      <div className="split">
        <Card title="Ingest an event" subtitle="post-tournament: pull once, archive locally, never re-hit the rate limit">
          <div className="grid g2">
            <Field label="Event SKU" hint="current-season event, e.g. RE-VRC-26-1234">
              <input className="input mono" value={ingestSku} onChange={(e) => setIngestSku(e.target.value)} placeholder="RE-VRC-…" />
            </Field>
            <Field label="Source" hint="only the live season is ingestable">
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="robotevents">RobotEvents v2 (current season)</option>
              </select>
            </Field>
          </div>
          <div className="row">
            <Btn variant="primary" onClick={doIngest} disabled={!ingestSku.trim() || busy === 'ingest'}>
              {busy === 'ingest' ? 'Ingesting…' : 'Ingest'}
            </Btn>
            <span className="tiny dim">
              RobotEvents returns autonomous / driver / penalty splits and per-match video links when the event has them — that unlocks
              phase attribution, which the public archive cannot provide.
            </span>
          </div>
        </Card>

        <Card title="Import Tournament Manager CSV" subtitle="File → Export → Match List">
          <div className="grid g2">
            <Field label="SKU">
              <input className="input mono" value={csvSku} onChange={(e) => setCsvSku(e.target.value)} placeholder="RE-VRC-…" />
            </Field>
            <Field label="Event name">
              <input className="input" value={csvName} onChange={(e) => setCsvName(e.target.value)} placeholder="optional" />
            </Field>
          </div>
          <Field label="CSV" hint="Paste the Match List export. Field assignments and scheduled times from TM are what make multi-field video alignment possible.">
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Match,Field,Red1,Red2,Blue1,Blue2,Red Score,Blue Score,Scheduled" />
          </Field>
          <Btn onClick={doCsv} disabled={!csvSku.trim() || !csv || busy === 'csv'}>
            {busy === 'csv' ? 'Importing…' : 'Import CSV'}
          </Btn>
        </Card>
      </div>

      <Card
        title="Video sources"
        subtitle={sku ? `for ${sku}` : 'select an event'}
        right={
          <Btn size="sm" onClick={doAlign} disabled={!sku || busy === 'align'}>
            {busy === 'align' ? 'Aligning…' : 'Auto-align matches'}
          </Btn>
        }
      >
        <div className="grid g4">
          <Field label="YouTube URL or id">
            <input className="input" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
          </Field>
          <Field label="Stream start (local)" hint="first frame time">
            <input className="input" type="datetime-local" value={videoStart} onChange={(e) => setVideoStart(e.target.value)} />
          </Field>
          <Field label="Label">
            <input className="input" value={videoLabel} onChange={(e) => setVideoLabel(e.target.value)} placeholder="Day 1 main field" />
          </Field>
          <Field label="Field (optional)" hint="match to a TM field name">
            <input className="input" value={videoField} onChange={(e) => setVideoField(e.target.value)} placeholder="Google" />
          </Field>
        </div>
        <Btn onClick={doAddVideo} disabled={!videoUrl || !sku || busy === 'video'}>
          Add video
        </Btn>

        <div style={{ marginTop: 12 }}>
          <Note>
            Alignment is <span className="mono">seek = match start − stream start + manual offset</span>. Long gaps are breaks, and
            breaks are exactly where that formula drifts — so every derived link carries a confidence score, and low-confidence links
            say so on the match page.
          </Note>
        </div>

        {sku && <VideoList sku={sku} onChange={reloadSummary} />}
      </Card>

      <Card title="Archive" subtitle="events stored in the local SQLite archive">
        {!events.length ? (
          <Empty>No events yet.</Empty>
        ) : (
          <Table head={['Event', 'Season', { label: 'Teams', cls: 'num' }, { label: 'Matches', cls: 'num' }, { label: 'Videos', cls: 'num' }, { label: '', cls: 'num' }]} wrap={false}>
            {events.map((e) => (
              <tr key={e.sku}>
                <td>
                  <a href={`#/overview/${e.sku}`} onClick={(ev) => { ev.preventDefault(); navigate(`overview/${e.sku}`) }}>
                    {e.name}
                  </a>
                  <div className="tiny dim mono">{e.sku}</div>
                </td>
                <td className="small dim">{e.season || '—'}</td>
                <td className="num">{e.team_count}</td>
                <td className="num">{e.match_count}</td>
                <td className="num">{e.video_count}</td>
                <td className="num">
                  <Btn size="sm" variant="ghost" onClick={() => doDelete(e.sku)}>
                    delete
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Provenance and limits" subtitle="what this build can and cannot know">
        <div className="grid g2">
          <div>
            <KV
              items={[
                { k: 'Archive', v: 'data/vex.db (SQLite)' },
                { k: 'Scope', v: 'current season only' },
                { k: 'Counter rules', v: 'data/counter-rules.json' },
                { k: 'RobotEvents token', v: 'ROBOTEVENTS_TOKEN in server .env' }
              ]}
            />
          </div>
          <div>
            <KV
              items={[
                { k: 'Ratings', v: 'OPR (ridge LS) + Elo bootstrap' },
                { k: 'Win prob', v: 'Normal margin model' },
                { k: 'Attribution', v: 'Shapley over OPR value' },
                { k: 'Timelines', v: 'tagged or absent — never invented' }
              ]}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Note tone="warn">
            Public archives carry final scores only. Anything that requires a point-by-point timeline — in-game win probability, WPA,
            cycle times — is marked unavailable rather than estimated, unless you tag it against video or ingest a source that ships
            the breakdown. That gap is the honest boundary of this tool.
          </Note>
        </div>
      </Card>
    </div>
  )
}

function VideoList({ sku, onChange }) {
  const { data, loading, reload } = useApi(endpoints.videos(sku))
  const videos = data?.videos || []
  if (loading && !data) return <Loading label="Loading videos…" />
  if (!videos.length) return <div className="empty">No videos for this event yet.</div>
  return (
    <Table head={['Video', 'Stream start', 'Field', { label: '', cls: 'num' }]} wrap={false}>
      {videos.map((v) => (
        <tr key={v.id}>
          <td>
            <div>{v.label || v.youtube_id}</div>
            <div className="tiny dim mono">{v.youtube_id}</div>
          </td>
          <td className="small dim">{dateTime(v.stream_start)}</td>
          <td className="small dim">{v.field || '—'}</td>
          <td className="num">
            <Btn
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!confirm('Remove this video and its alignment?')) return
                await jdel(`/api/video/${v.id}`)
                reload()
                onChange && onChange()
              }}
            >
              remove
            </Btn>
          </td>
        </tr>
      ))}
    </Table>
  )
}
