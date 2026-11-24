import React, { useEffect, useMemo, useState } from 'react'
import { Badge, Btn, Card, Empty, Field, Note, Stat } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import {
  BATTERY_STATES,
  DEFAULT_EVENT_CHECKLIST,
  DEFAULT_MATCH_CHECKLIST,
  JUDGING_QUESTIONS,
  TASK_PRIORITIES,
  useWorkspace
} from '../access/workspace.js'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const localInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Section({ title, summary, children, defaultOpen = false, right }) {
  return (
    <details className="op-section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {summary && <span className="tiny dim">{summary}</span>}
        {right}
      </summary>
      <div className="op-body">{children}</div>
    </details>
  )
}

// ---- tasks ---------------------------------------------------------------

function Tasks({ sku }) {
  const { records, loading, error, add, patch, drop } = useWorkspace('tasks', sku)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('normal')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState('')

  const open = records.filter((r) => r.status !== 'done')
  const done = records.filter((r) => r.status === 'done')

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    await add({ title: title.trim(), priority, dueAt: due ? new Date(due).toISOString() : null, ownerLabel: owner.trim() || null, status: 'open' })
    setTitle('')
    setDue('')
    setOwner('')
  }

  return (
    <Section title="Team tasks" summary={`${open.length} open`} defaultOpen>
      <form onSubmit={submit} className="op-form">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Check the intake after the last match" aria-label="Task" />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="who (optional)" aria-label="Owner label" />
        <Btn type="submit" size="sm" variant="primary">Add</Btn>
      </form>
      {error && <p className="tiny bad">{error}</p>}
      {loading && !records.length && <p className="tiny dim">Loading tasks…</p>}
      {!open.length && !done.length && <Empty>No tasks yet. They are shared with every device signed in to this team.</Empty>}
      <ul className="task-list">
        {open.map((t) => (
          <li key={t.id}>
            <label className="inline-check">
              <input type="checkbox" checked={false} onChange={() => patch(t.id, { status: 'done', completedAt: new Date().toISOString() })} />
              <span>
                <strong>{t.title}</strong>
                <span className="tiny dim">
                  {' '}
                  {t.priority !== 'normal' ? `· ${t.priority} ` : ''}
                  {t.dueAt ? `· due ${new Date(t.dueAt).toLocaleString()}` : ''}
                  {t.ownerLabel ? ` · ${t.ownerLabel}` : ''}
                </span>
              </span>
            </label>
            <button type="button" className="icon-btn" aria-label={`Delete ${t.title}`} onClick={() => drop(t.id)}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
        {done.map((t) => (
          <li key={t.id} className="done">
            <label className="inline-check">
              <input type="checkbox" checked onChange={() => patch(t.id, { status: 'open', completedAt: null })} />
              <span><s>{t.title}</s> <span className="tiny dim">completed {t.completedAt ? new Date(t.completedAt).toLocaleTimeString() : ''}</span></span>
            </label>
            <button type="button" className="icon-btn" aria-label={`Delete ${t.title}`} onClick={() => drop(t.id)}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {done.length > 0 && <p className="tiny dim">Completed tasks keep a record; deleting one is recoverable server-side.</p>}
    </Section>
  )
}

// ---- batteries -----------------------------------------------------------

function Batteries() {
  const { records, loading, error, add, patch, drop } = useWorkspace('batteries')
  const [label, setLabel] = useState('')
  const ready = records.filter((b) => b.status === 'ready').length
  const charging = records.filter((b) => b.status === 'charging').length
  const inRobot = records.find((b) => b.status === 'in_robot')

  return (
    <Section title="Batteries" summary={`${ready} ready · ${charging} charging`}>
      <div className="stat-row">
        <Stat label="Ready" value={ready} tone={ready ? undefined : 'var(--bad)'} sub={ready ? 'spare available' : 'no spare marked ready'} />
        <Stat label="In robot" value={inRobot?.label || '—'} sub="current battery" />
        <Stat label="Charging" value={charging} />
        <Stat label="Tracked" value={records.length} />
      </div>
      {!ready && records.length > 0 && <Note tone="warn">No battery is marked ready. Mark one before the next match.</Note>}
      <form
        className="op-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!label.trim()) return
          await add({ label: label.trim(), status: 'ready', chargePct: null })
          setLabel('')
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Battery label, e.g. B3" aria-label="Battery label" />
        <Btn type="submit" size="sm" variant="primary">Add battery</Btn>
      </form>
      {error && <p className="tiny bad">{error}</p>}
      {loading && !records.length && <p className="tiny dim">Loading batteries…</p>}
      {!records.length && <Empty>No batteries tracked yet.</Empty>}
      <div className="battery-grid">
        {records.map((b) => (
          <div className={`battery ${b.status}`} key={b.id}>
            <div className="row">
              <strong>{b.label}</strong>
              <button type="button" className="icon-btn" aria-label={`Remove ${b.label}`} onClick={() => drop(b.id)}>
                <Icon name="close" size={13} />
              </button>
            </div>
            <select value={b.status} onChange={(e) => patch(b.id, { status: e.target.value, lastSwapAt: e.target.value === 'in_robot' ? new Date().toISOString() : b.lastSwapAt })} aria-label={`Status of ${b.label}`}>
              {BATTERY_STATES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
            </select>
            <input
              type="number"
              min="0"
              max="100"
              value={b.chargePct ?? ''}
              placeholder="charge %"
              aria-label={`Charge percentage of ${b.label}`}
              onChange={(e) => patch(b.id, { chargePct: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
      <p className="tiny dim">
        Statuses are recorded by hand. There is no VEX battery telemetry integration, so nothing here is presented as a
        live reading.
      </p>
    </Section>
  )
}

// ---- skills --------------------------------------------------------------

function Skills({ sku }) {
  const { records, loading, error, add, drop } = useWorkspace('skills', sku)
  const [kind, setKind] = useState('driver')
  const [score, setScore] = useState('')
  const [official, setOfficial] = useState(false)
  const best = useMemo(() => {
    const by = (k, onlyOfficial) => {
      const rows = records.filter((r) => r.kind === k && (onlyOfficial ? r.official : true))
      return rows.length ? Math.max(...rows.map((r) => Number(r.score) || 0)) : null
    }
    const driver = best_(records, 'driver', false)
    const programming = best_(records, 'programming', false)
    return {
      driver,
      programming,
      combined: driver != null || programming != null ? (driver || 0) + (programming || 0) : null,
      officialDriver: best_(records, 'driver', true),
      officialProgramming: best_(records, 'programming', true)
    }
  }, [records])

  return (
    <Section title="Skills attempts" summary={`${records.length} recorded`}>
      <div className="stat-row">
        <Stat label="Driver best" value={best.driver ?? '—'} />
        <Stat label="Programming best" value={best.programming ?? '—'} />
        <Stat label="Combined" value={best.combined ?? '—'} sub="manual bests" />
        <Stat label="Official bests" value={best.officialDriver != null || best.officialProgramming != null ? `${best.officialDriver ?? '—'} / ${best.officialProgramming ?? '—'}` : '—'} sub="verified from published results" />
      </div>
      <form
        className="op-form"
        onSubmit={async (e) => {
          e.preventDefault()
          const value = Number(score)
          if (!Number.isFinite(value) || value < 0) return
          await add({ kind, score: value, official, recordedAt: new Date().toISOString() })
          setScore('')
          setOfficial(false)
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Skills type">
          <option value="driver">Driver</option>
          <option value="programming">Autonomous coding</option>
        </select>
        <input type="number" min="0" value={score} onChange={(e) => setScore(e.target.value)} placeholder="score" aria-label="Score" />
        <label className="inline-check">
          <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} />
          official result
        </label>
        <Btn type="submit" size="sm" variant="primary">Record</Btn>
      </form>
      {error && <p className="tiny bad">{error}</p>}
      {loading && !records.length && <p className="tiny dim">Loading attempts…</p>}
      {!records.length && <Empty>No attempts recorded.</Empty>}
      <ul className="task-list">
        {records.slice().reverse().map((r) => (
          <li key={r.id}>
            <span>
              <Badge tone={r.official ? 'good' : ''}>{r.official ? 'official' : 'manual'}</Badge> {r.kind === 'driver' ? 'Driver' : 'Autonomous coding'}{' '}
              <strong>{r.score}</strong> <span className="tiny dim">{r.recordedAt ? new Date(r.recordedAt).toLocaleString() : ''}</span>
            </span>
            <button type="button" className="icon-btn" aria-label="Delete attempt" onClick={() => drop(r.id)}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="tiny dim">
        Manual attempts are your own notes. Only published tournament skills results are official, and the API does not
        expose every individual attempt — remaining attempts are not inferred.
      </p>
    </Section>
  )
}

function best_(records, kind, onlyOfficial) {
  const rows = records.filter((r) => r.kind === kind && (onlyOfficial ? r.official : true))
  return rows.length ? Math.max(...rows.map((r) => Number(r.score) || 0)) : null
}

// ---- readiness -----------------------------------------------------------

function Checklist({ kind, title, defaults, sku }) {
  const { records, add, patch, error } = useWorkspace('checklists', sku)
  const record = records.find((r) => r.kind === kind)
  const items = record?.items || defaults.map((label, i) => ({ id: `d${i}`, label, done: false }))
  const doneCount = items.filter((i) => i.done).length

  const toggle = async (item) => {
    const next = items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
    if (!record) await add({ kind, items: next })
    else await patch(record.id, { items: next })
  }

  const reset = async () => {
    const next = items.map((i) => ({ ...i, done: false }))
    if (!record) await add({ kind, items: next })
    else await patch(record.id, { items: next })
  }

  return (
    <div className="checklist">
      <div className="row">
        <strong>{title}</strong>
        <span className="tiny dim">{doneCount}/{items.length}</span>
        <span className="spacer" />
        <Btn size="sm" variant="ghost" onClick={reset}>Reset</Btn>
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }} /></div>
      <ul className="check-items">
        {items.map((i) => (
          <li key={i.id}>
            <label className="inline-check">
              <input type="checkbox" checked={i.done} onChange={() => toggle(i)} />
              <span className={i.done ? 'done' : ''}>{i.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="tiny bad">{error}</p>}
      <p className="tiny dim">A completed checklist is a team record, not official inspection approval.</p>
    </div>
  )
}

function Readiness({ sku }) {
  return (
    <Section title="Readiness" summary="pre-event and pre-match">
      <div className="readiness-grid">
        <Checklist kind="event" title="Before the tournament" defaults={DEFAULT_EVENT_CHECKLIST} sku={sku} />
        <Checklist kind="match" title="Before this match" defaults={DEFAULT_MATCH_CHECKLIST} sku={sku} />
      </div>
    </Section>
  )
}

// ---- judging -------------------------------------------------------------

function Judging() {
  const { records, add, patch, error } = useWorkspace('judging')
  const [seconds, setSeconds] = useState(300)
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [running])

  const note = (question) => records.find((r) => r.question === question)?.answer || ''

  return (
    <Section title="Judging preparation" summary={`${records.length} notes`}>
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="timer mono" aria-live="off">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>
        <Btn size="sm" onClick={() => setRunning((v) => !v)}>{running ? 'Pause' : 'Start'}</Btn>
        <Btn size="sm" variant="ghost" onClick={() => { setRunning(false); setSeconds(300) }}>Reset</Btn>
        <span className="tiny dim">Five minutes per mock interview</span>
      </div>
      <p className="tiny dim">
        These prompts are practice material, not questions official judges are guaranteed to ask. Answer with what your
        team actually did; do not memorise claims you cannot evidence.
      </p>
      <div className="judging-list">
        {JUDGING_QUESTIONS.map(([topic, question], i) => (
          <div className="judging-item" key={topic}>
            <button type="button" className="judging-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
              <strong>{topic}</strong>
              <Icon name="chevron" size={14} />
            </button>
            {open === i && (
              <div>
                <p className="small">{question}</p>
                <textarea
                  rows={3}
                  defaultValue={note(question)}
                  placeholder="Your actual answer, evidence and numbers…"
                  onBlur={async (e) => {
                    const value = e.target.value
                    const existing = records.find((r) => r.question === question)
                    if (existing) {
                      if (existing.answer !== value) await patch(existing.id, { answer: value })
                    } else if (value.trim()) {
                      await add({ question, answer: value })
                    }
                  }}
                  aria-label={`Answer for ${topic}`}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="tiny bad">{error}</p>}
    </Section>
  )
}

export default function Operations({ sku }) {
  return (
    <div className="ops">
      <Note>
        These records belong to this team&apos;s private workspace and are shared with every device signed in to it.
        They are not official results.
      </Note>
      <Tasks sku={sku} />
      <Batteries />
      <Skills sku={sku} />
      <Readiness sku={sku} />
      <Judging />
    </div>
  )
}
