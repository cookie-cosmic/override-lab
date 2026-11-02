import React, { useEffect, useMemo, useState } from 'react'
import { jdel, jpost, endpoints, useApi, clock, dateTime } from '../api.js'
import { Card, Badge, Table, Loading, ErrorBox, Note, Empty, Btn, Field } from '../components/ui.jsx'

const enc = encodeURIComponent
const seekOf = (s) => Math.max(0, Math.round(Number(s) || 0))

/**
 * Stream analysis, kept apart from the match index on purpose: adding a stream, aligning it
 * to the schedule and checking how much to trust each seek time is its own job, done before
 * or after reviewing matches.
 */
export default function Stream({ sku, matchKey, navigate }) {
  const videosApi = useApi(sku ? endpoints.videos(sku) : null)
  const matchesApi = useApi(sku ? endpoints.matches(sku) : null)

  const [sel, setSel] = useState(matchKey || null)
  const [form, setForm] = useState({ url: '', label: '', field: '', stream_start: '' })
  const [offsets, setOffsets] = useState({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (matchKey) setSel(matchKey)
  }, [matchKey])

  const videos = videosApi.data?.videos || []
  const matches = matchesApi.data?.matches || []
  const byId = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos])

  const rows = useMemo(() => matches.filter((m) => m.scheduled || m.media), [matches])
  const aligned = useMemo(() => rows.filter((m) => m.media), [rows])
  const selected = rows.find((m) => m.key === sel) || null
  const media = selected?.media || null
  const video = media ? byId.get(media.video_id) || null : null

  const countsFor = (videoId) => rows.filter((m) => m.media?.video_id === videoId).length

  if (!sku) return <Empty>No event selected.</Empty>
  if ((videosApi.loading && !videosApi.data) || (matchesApi.loading && !matchesApi.data)) return <Loading label="Loading streams…" />
  if (videosApi.error) return <ErrorBox error={videosApi.error} onRetry={videosApi.reload} />
  if (matchesApi.error) return <ErrorBox error={matchesApi.error} onRetry={matchesApi.reload} />

  const addStream = async () => {
    if (!form.url.trim()) {
      setError('Paste a YouTube URL or an 11-character video id first.')
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await jpost(`/api/events/${enc(sku)}/videos`, {
        url: form.url.trim(),
        label: form.label.trim() || null,
        field: form.field.trim() || null,
        stream_start: form.stream_start ? new Date(form.stream_start).toISOString() : null
      })
      setForm({ url: '', label: '', field: '', stream_start: '' })
      setNote('Stream added. Align its matches to compute a seek time for every match.')
      videosApi.reload()
      matchesApi.reload()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const removeStream = async (id) => {
    setBusy(true)
    setError(null)
    try {
      await jdel(`/api/video/${id}`)
      setNote('Stream removed, along with its alignment rows.')
      videosApi.reload()
      matchesApi.reload()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const realign = async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const out = await jpost(`/api/events/${enc(sku)}/align`, { offsets })
      setNote(
        out.reason
          ? `Nothing aligned: ${out.reason}.`
          : `${out.aligned} match${out.aligned === 1 ? '' : 'es'} aligned across ${out.videos} stream${out.videos === 1 ? '' : 's'}.`
      )
      matchesApi.reload()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const openMatch = (key) => navigate(`matches/${sku}?m=${enc(key)}`)

  return (
    <div>
      <Card
        title="Streams"
        subtitle={`${videos.length} registered · ${aligned.length} of ${rows.length} matches aligned`}
        right={
          <Btn size="sm" onClick={realign} disabled={busy || !videos.length}>
            {busy ? 'Working…' : 'Align matches'}
          </Btn>
        }
      >
        <div className="grid g4">
          <Field label="YouTube stream or video id" hint="the event stream, or one stream per field">
            <input
              className="input"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://youtube.com/watch?v=…"
            />
          </Field>
          <Field label="Label" hint="shown wherever the stream is referenced">
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Field 1 stream" />
          </Field>
          <Field label="Field" hint="leave blank if the stream covers every field">
            <input className="input" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} placeholder="Field 1" />
          </Field>
          <Field label="Stream start (local)" hint="first frame time — the anchor for every seek time">
            <input
              className="input"
              type="datetime-local"
              value={form.stream_start}
              onChange={(e) => setForm({ ...form, stream_start: e.target.value })}
            />
          </Field>
        </div>
        <div className="row">
          <Btn variant="primary" onClick={addStream} disabled={busy}>
            Add stream
          </Btn>
          <span className="tiny dim">
            Seek time is <span className="mono">match start − stream start</span>. Breaks are where that drifts, so confidence drops
            with long gaps between matches.
          </span>
        </div>

        {note && (
          <div style={{ marginTop: 10 }}>
            <Note tone="good">{note}</Note>
          </div>
        )}
        {error && (
          <div style={{ marginTop: 10 }}>
            <Note tone="bad">{error}</Note>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {!videos.length ? (
            <Empty>No stream registered for this event yet. Add one above, then align it to the schedule.</Empty>
          ) : (
            <Table head={['Stream', 'YouTube id', 'Field', 'Stream start', { label: 'Aligned', cls: 'num' }, { label: 'Offset (s)', cls: 'num' }, { label: '', cls: 'num' }]} wrap={false}>
              {videos.map((v) => (
                <tr key={v.id}>
                  <td>{v.label || <span className="dim">untitled</span>}</td>
                  <td className="mono small">
                    <a href={`https://www.youtube.com/watch?v=${v.youtube_id}`} target="_blank" rel="noreferrer">
                      {v.youtube_id}
                    </a>
                  </td>
                  <td className="small dim">{v.field || 'all fields'}</td>
                  <td className="small dim">{v.stream_start ? dateTime(v.stream_start) : '—'}</td>
                  <td className="num">{countsFor(v.id)}</td>
                  <td className="num">
                    <input
                      className="input mono"
                      style={{ width: 74, textAlign: 'right' }}
                      value={offsets[v.id] ?? ''}
                      placeholder="0"
                      onChange={(e) => setOffsets({ ...offsets, [v.id]: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <Btn size="sm" variant="ghost" onClick={() => removeStream(v.id)} disabled={busy}>
                      ✕
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </Card>

      <div className="split">
        <Card title="Match alignment" subtitle="click a row to load it in the player">
          {!rows.length ? (
            <Empty>No scheduled matches in this archive yet.</Empty>
          ) : (
            <Table head={['Match', 'Scheduled', { label: 'Seek', cls: 'num' }, 'Confidence', { label: '', cls: 'num' }]} maxHeight="62vh">
              {rows.map((m) => {
                const conf = m.media?.confidence
                return (
                  <tr
                    key={m.key}
                    onClick={() => setSel(m.key)}
                    style={{ cursor: 'pointer', background: m.key === sel ? 'var(--panel-3)' : undefined }}
                  >
                    <td className="nowrap">
                      <div className="mono" style={{ fontWeight: 600 }}>
                        {m.roundLabel === 'Qualification' ? 'Q' : m.roundLabel === 'Practice' ? 'P' : 'E'}
                        {m.matchnum}
                      </div>
                      <div className="tiny dim">{m.field || '—'}</div>
                    </td>
                    <td className="small dim nowrap">{dateTime(m.scheduled)}</td>
                    <td className="num mono">{m.media ? clock(m.media.seek_s) : '—'}</td>
                    <td>
                      {conf == null ? (
                        <span className="tiny dim">not aligned</span>
                      ) : (
                        <Badge tone={conf >= 0.8 ? 'green' : conf >= 0.6 ? 'amber' : 'red'}>{Math.round(conf * 100)}%</Badge>
                      )}
                    </td>
                    <td className="num">
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          openMatch(m.key)
                        }}
                      >
                        analysis
                      </Btn>
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}
        </Card>

        <div>
          <Card
            title={selected ? `${selected.roundLabel || 'Match'} ${selected.matchnum}` : 'Player'}
            subtitle={video ? video.label || video.youtube_id : 'pick a match or add a stream'}
            right={
              selected && video ? (
                <a
                  className="btn sm"
                  href={`https://www.youtube.com/watch?v=${video.youtube_id}&t=${seekOf(media?.seek_s)}s`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open at time
                </a>
              ) : null
            }
          >
            {selected && video ? (
              <>
                <div className="video-wrap">
                  <iframe
                    src={`https://www.youtube.com/embed/${video.youtube_id}?start=${seekOf(media?.seek_s)}`}
                    title="stream player"
                    allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="tiny dim" style={{ marginTop: 8 }}>
                  seek {clock(media?.seek_s)} · offset {media?.offset_s ?? 0}s · confidence{' '}
                  {Math.round((media?.confidence || 0) * 100)}% · {media?.source}
                </div>
                {media?.confidence != null && media.confidence < 0.6 && (
                  <div style={{ marginTop: 8 }}>
                    <Note tone="warn">
                      Low confidence: this match sits after a break. Check the first frame, then correct the offset for that stream
                      above and align again.
                    </Note>
                  </div>
                )}
              </>
            ) : (
              <Note>
                {videos.length
                  ? 'Select a match in the alignment list to open the stream at its start time.'
                  : 'Add a stream first, then align the schedule to it.'}
              </Note>
            )}
          </Card>

          <Card title="How alignment works" subtitle="and why it is a confidence, not a fact">
            <div className="small muted">
              <p>
                Each match start comes from the RobotEvents schedule; the stream start is the first frame of the video. The offset is
                your correction when the two disagree.
              </p>
              <p>
                Gaps under 10 minutes score 88%, up to 25 minutes 70%, and anything longer 45% — a break is exactly where a naive
                offset drifts. Every value is editable, and the match view shows the same confidence next to the score tagger.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
