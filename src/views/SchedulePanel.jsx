import React, { useMemo, useState } from 'react'
import { useApi } from '../api.js'
import { Badge, Btn, Card, Empty, Field, Note, Stat, Table } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { useWorkspace } from '../access/workspace.js'

const KINDS = [
  ['official', 'Official event activity'],
  ['fixed', 'Fixed team appointment'],
  ['flexible', 'Flexible team task']
]

const localInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const time = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '—'

export default function SchedulePanel({ sku }) {
  const insight = useApi(sku ? `/api/workspace/schedule/insight?sku=${encodeURIComponent(sku)}` : null)
  const conflicts = useApi(sku ? `/api/workspace/schedule/conflicts?sku=${encodeURIComponent(sku)}` : null)
  const { records, loading, error, add, patch, drop } = useWorkspace('schedule', sku)
  const [form, setForm] = useState({ title: '', kind: 'flexible', startAt: '', durationMin: 20, priority: 'normal' })

  const i = insight.data
  const conflictList = conflicts.data?.conflicts || []
  const proposals = conflicts.data?.proposals || []

  const timeline = useMemo(
    () =>
      records
        .filter((r) => r.startAt)
        .slice()
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    [records]
  )

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.startAt) return
    await add({
      title: form.title.trim(),
      kind: form.kind,
      fixed: form.kind !== 'flexible',
      startAt: new Date(form.startAt).toISOString(),
      durationMin: Number(form.durationMin) || 20,
      priority: form.priority,
      doneAt: null
    })
    setForm({ ...form, title: '', startAt: '' })
    conflicts.reload()
  }

  if (!sku) {
    return <Empty>Choose a tournament to plan around its published schedule.</Empty>
  }

  return (
    <div>
      <div className="stat-grid">
        <Stat
          label="Next match"
          value={i?.available ? `Match ${i.match.number}` : '—'}
          sub={i?.available ? `${i.match.alliance} alliance · field ${i.match.field || 'TBC'}` : i?.reason || 'no schedule'}
          tone={i?.available ? (i.match.alliance === 'red' ? 'var(--red)' : 'var(--blue)') : undefined}
        />
        <Stat
          label="Estimated start"
          value={i?.available ? time(i.projectedStart) : '—'}
          sub={i?.available ? `scheduled ${time(i.scheduledStart)} · confidence ${i.confidence}` : null}
        />
        <Stat
          label="Time from now"
          value={i?.available ? `${i.minutesUntil} min` : '—'}
          sub={i?.available ? `prep by ${time(i.prepDeadline)}` : null}
        />
        <Stat label="Event delay" value={i?.available ? `${i.delayMinutes > 0 ? '+' : ''}${i.delayMinutes} min` : '—'} sub={i?.available ? `${i.queueAhead} matches ahead on ${i.fields} field(s)` : null} />
      </div>

      {i?.available && (
        <Note>
          <strong>How this is estimated.</strong> {i.basis.note} {i.basis.playedResults} published result
          {i.basis.playedResults === 1 ? '' : 's'} were used; the printed schedule supplies the rest. A published result
          can lag the field, so this is a planning estimate, never a claim that a match is on the field now.
        </Note>
      )}
      {!i?.available && i?.reason && <Note tone="warn">{i.reason}</Note>}

      {conflictList.length > 0 && (
        <Card title="Conflicts" subtitle={`${conflictList.length} overlapping`}>
          {conflictList.map((c, idx) => (
            <div className="conflict" key={idx}>
              <Icon name="zap" size={14} />
              <div>
                <strong>{c.a.title}</strong> at {time(c.a.start)} overlaps <strong>{c.b.title}</strong> at {time(c.b.start)}.
                <div className="tiny dim">{c.suggestion}</div>
              </div>
            </div>
          ))}
          <Note tone="warn">
            Fixed appointments are never moved automatically. Reschedule a flexible task yourself, or edit its time below.
          </Note>
        </Card>
      )}

      {proposals.length > 0 && (
        <Card title="Suggested windows" subtitle="gaps before the next official match">
          {proposals.map((p, idx) => (
            <div className="row" key={idx} style={{ justifyContent: 'space-between', padding: '4px 0' }}>
              <span className="small">Before {p.around}: {time(p.start)}–{time(p.end)} ({p.minutes} min free)</span>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => setForm({ ...form, startAt: localInput(p.start), durationMin: Math.min(p.minutes, 30), kind: 'flexible' })}
              >
                Use this gap
              </Btn>
            </div>
          ))}
        </Card>
      )}

      <Card title="Team schedule" subtitle={`${records.length} activities · shared with this team`}>
        <form onSubmit={submit} className="op-form">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Judging interview, skills run, repair…" aria-label="Activity" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Activity type">
            {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} aria-label="Start" />
          <input type="number" min="5" step="5" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} aria-label="Duration in minutes" style={{ maxWidth: 90 }} />
          <Btn type="submit" size="sm" variant="primary">Add</Btn>
        </form>
        {error && <p className="tiny bad">{error}</p>}
        {loading && !records.length && <p className="tiny dim">Loading schedule…</p>}
        {!timeline.length && <Empty>No team activities yet.</Empty>}
        {timeline.length > 0 && (
          <Table head={['Time', 'Activity', 'Type', 'Length', '']}>
            {timeline.map((r) => (
              <tr key={r.id} className={r.doneAt ? 'dim' : ''}>
                <td className="mono">{time(r.startAt)}</td>
                <td>{r.title}</td>
                <td><Badge tone={r.kind === 'official' ? 'warn' : r.kind === 'fixed' ? '' : 'good'}>{r.kind}</Badge></td>
                <td className="tiny">{r.durationMin} min</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <Btn size="sm" variant="ghost" onClick={() => patch(r.id, { doneAt: r.doneAt ? null : new Date().toISOString() })}>
                      {r.doneAt ? 'Reopen' : 'Done'}
                    </Btn>
                    <button type="button" className="icon-btn" aria-label={`Delete ${r.title}`} onClick={() => { drop(r.id); conflicts.reload() }}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Note>
          Scheduling a skills run or judging slot here records your team&apos;s plan. It does not reserve a field or an
          interview with the event organiser.
        </Note>
      </Card>
    </div>
  )
}
